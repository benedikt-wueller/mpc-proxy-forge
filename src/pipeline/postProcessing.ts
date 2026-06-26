import { DefaultProfile, type PostProcessingProfile } from "../config/processingProfileManager.js";
import { renameWithRetry } from "../utils/fs.js";
import type { ScryfallCard } from "../clients/scryfall.js";
import sharp, { type Sharp } from "sharp";
import type { MoxfieldCard } from "../clients/moxfield.js";
import { clamp } from "../utils/math.js";
import {
    type BlackoutBox,
    COPYRIGHT_BOXES,
    type Oval,
    PROXY_NOTE_POSITIONS,
    type ProxyNoteBox,
    STAMP_OVAL,
    STAMP_TRIANGLE,
    type StampOptions,
    type Triangle
} from "./cardLayout.js";

sharp.cache(false);

interface CompositeBox {
    top: number,
    left: number,
    width: number,
    height: number
}

export async function postProcessImage(filePath: string, card: {
    scryfallCard: ScryfallCard,
    moxfieldCard: MoxfieldCard
}, face: 'front' | 'back', config: PostProcessingProfile) {
    const tmpFilePath = filePath.replace('.png', '-temp.png');

    let buffer = await sharp(filePath).png().toBuffer();

    // 1. Fix corners to make sure they are filled in.
    buffer = await fixCorners(buffer, config);

    // 2. Crop border slightly and re-extend to fill the card. This helps with uneven scan borders and border artifacts.
    buffer = await borderCrop(buffer, config, card.scryfallCard);

    // 3. Blur copyright details and add a proxy notice.
    buffer = await removeCopyright(buffer, config, card.scryfallCard, card.moxfieldCard, face);
    buffer = await applyProxyNote(buffer, config, card.scryfallCard, card.moxfieldCard, face);

    // 4. Remove holo stamps.
    buffer = await removeStamps(buffer, card.scryfallCard);

    // 5. Extend image to account for bleed area.
    buffer = await applyBleed(buffer, config, card.scryfallCard);

    await sharp(buffer).png().toFile(tmpFilePath);
    await renameWithRetry(tmpFilePath, filePath);
}

async function applyBleed(buffer: Buffer, config: PostProcessingProfile, scryfallCard: ScryfallCard) {
    const img = sharp(buffer);
    const { width, height } = await img.metadata();

    const bleed = Math.round(width / config.cardWidth * config.bleedWidth);

    let bleedCard = await sharp(buffer)
        .extend({
            top: bleed, bottom: Math.floor(bleed * 0.45), left: bleed, right: bleed,
            extendWith: scryfallCard.full_art ? 'mirror' : 'copy'
        })
        .png()
        .toBuffer();

    bleedCard = await sharp(bleedCard)
        .extend({
            top: 0, bottom: Math.ceil(bleed * 0.55), left: 0, right: 0,
            extendWith: scryfallCard.full_art ? 'mirror' : 'copy',
        })
        .png()
        .toBuffer()

    const bottomBorderMask = Buffer.from(`<svg width="${width + bleed * 2}" height="${height + bleed * 2}">
        <rect x="0" y="${height + bleed - 5}" width="${width + bleed * 2}" height="10" fill="white" />
    </svg>`);

    const bottomBorderSmear = await sharp(bleedCard)
        .blur(4)
        .composite([{ input: bottomBorderMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

    return await sharp(bleedCard)
        .composite([{ input: bottomBorderSmear }])
        .png()
        .toBuffer();
}

async function fixCorners(buffer: Buffer, config: PostProcessingProfile) {
    const img = sharp(buffer);
    const { width, height } = await img.metadata();

    const borderRadius = width * config.cornerRadius;

    const mask = Buffer.from(`<svg width="${width}" height="${height}">
      <rect 
        x="0" 
        y="0" 
        width="${width}" 
        height="${height - 2}" 
        rx="${borderRadius}" ry="${borderRadius}" 
        fill="white" 
      />
    </svg>`
    );

    // Take the image, blur it heavily (to "push" the border colors out), then mask it so it only exists in the corner areas.
    const upscaled1 = await resizeAndCrop(buffer, 1.0075, width, height, mask);
    const upscaled2 = await resizeAndCrop(buffer, 1.0125, width, height, mask);
    const upscaled3 = await resizeAndCrop(buffer, 1.02, width, height, mask);
    const upscaled4 = await resizeAndCrop(buffer, 1.0225, width, height, mask);
    const upscaled5 = await resizeAndCrop(buffer, 1.0275, width, height, mask);
    const upscaled6 = await resizeAndCrop(buffer, 1.0325, width, height, mask);

    const combined = await sharp(upscaled6).composite([
        { input: upscaled5 },
        { input: upscaled4 },
        { input: upscaled3 },
        { input: upscaled2 },
        { input: upscaled1 },
        { input: await sharp(buffer).composite([{ input: mask, blend: 'dest-in' }]).toBuffer() }
    ]).png().toBuffer();

    const smearLayer = await sharp(combined)
        .blur(2)
        .composite([{ input: mask, blend: 'dest-out' }])
        .png()
        .toBuffer();

    // Fills the transparent corner cutouts with a smeared version of the pixels exactly at the curve's edge.
    return await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
        .composite([
            { input: buffer, top: 0, left: 0 },
            { input: smearLayer, top: 0, left: 0 }
        ])
        .png()
        .toBuffer();
}

async function borderCrop(buffer: Buffer, config: PostProcessingProfile, scryfallCard: ScryfallCard) {
    const img = sharp(buffer);
    const { width, height } = await img.metadata();

    const cropSize = Math.round(width * config.borderCrop);

    const cropped = await crop(img, width, height, width - cropSize * 2, height - cropSize * 2);

    return await sharp(cropped).extend({
        top: cropSize, bottom: cropSize, left: cropSize, right: cropSize,
        extendWith: scryfallCard.full_art ? 'mirror' : 'copy'
    }).png().toBuffer();
}

async function removeCopyright(buffer: Buffer, config: PostProcessingProfile, scryfallCard: ScryfallCard, moxfieldCard: MoxfieldCard, face: 'front' | 'back') {
    if (config.copyrightBehavior === 'keep') return buffer;

    const img = sharp(buffer);
    const { width, height } = await img.metadata();

    // Find relevant copyright boxes.
    const composites: CompositeBox[] = [];

    const frame = scryfallCard.frame;
    const cardFace = moxfieldCard.card.card_faces && moxfieldCard.card.card_faces[face === 'back' ? 1 : 0];
    const typeLine = cardFace?.type_line || moxfieldCard.card.type_line;
    const promoTypes = scryfallCard.promo_types || [];

    if (frame === '1993') {
        composites.push(getCompositeBox(COPYRIGHT_BOXES[frame].default, width, height));
    } else if (frame === '1997') {
        composites.push(getCompositeBox(COPYRIGHT_BOXES[frame].default, width, height));
    } else if (frame === '2003') {
        composites.push(getFrameCompositeBox(frame, typeLine, width, height));
    } else {
        if (typeLine.includes('Creature') && !promoTypes.includes('sourcematerial')) {
            composites.push(getCompositeBox(COPYRIGHT_BOXES['2015'].creature, width, height));
            composites.push(getCompositeBox(COPYRIGHT_BOXES['2015'].creatureUniversesBeyond, width, height));
        } else {
            composites.push(getFrameCompositeBox('2015', typeLine, width, height));
        }

        // Some 2015+ planes use the 2003 copyright format, so we check for those as well.
        if (typeLine.includes('Plane') || typeLine.includes('Phenomenon')) {
            composites.push(getCompositeBox(COPYRIGHT_BOXES['2003'].planechase, width, height));
        }
    }

    return await applyBlurredBoxes(buffer, composites, config.blurStrength || DefaultProfile.postProcessing.blurStrength);
}

function getFrameCompositeBox(frame: '2003' | '2015', typeLine: string, width: number, height: number) {
    if (typeLine.includes('Planeswalker')) {
        return getCompositeBox(COPYRIGHT_BOXES[frame].planeswalker, width, height);
    } else if (typeLine.includes('Plane') || typeLine.includes('Phenomenon')) {
        return getCompositeBox(COPYRIGHT_BOXES[frame].planechase, width, height);
    } else {
        return getCompositeBox(COPYRIGHT_BOXES[frame].default, width, height);
    }
}

function getCompositeBox({ x1, x2, y1, y2 }: BlackoutBox, width: number, height: number): CompositeBox {
    const top = clamp(Math.round(y1 * height), 0, height - 1);
    const left = clamp(Math.round(x1 * width), 0, width - 1);

    const w = clamp(Math.round((x2 - x1) * width), 1, width - left - 1);
    const h = clamp(Math.round((y2 - y1) * height), 1, height - top - 1);

    return { top, left, width: w, height: h };
}

async function applyBlurredBoxes(buffer: Buffer, boxes: CompositeBox[], strength: number) {
    try {
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height) {
            throw new Error("Could not determine image dimensions");
        }

        // Extract and blur each box
        const individuallyBlurred = await Promise.all(boxes.map(async (box) => {
            const blurredBuffer = await sharp(buffer)
                .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
                .blur(strength)
                .toBuffer();

            return { input: blurredBuffer, top: box.top, left: box.left };
        }));

        const canvas1Buffer = await sharp({
            create: {
                width: metadata.width,
                height: metadata.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
            .composite(individuallyBlurred)
            .png()
            .toBuffer();

        // Apply a second blur to smooth out the overlapping areas
        const canvasBlur = await sharp(canvas1Buffer)
            .blur(strength)
            .png()
            .toBuffer();

        const combinedLayersBuffer = await sharp(canvas1Buffer)
            .composite([{ input: canvasBlur, blend: 'over' }])
            .png()
            .toBuffer();

        const svgRects = boxes.map(box =>
            `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="white"/>`
        ).join('');

        const maskSvg = Buffer.from(`
            <svg width="${metadata.width}" height="${metadata.height}">
                ${svgRects}
            </svg>
        `);

        const finalBlurredOverlay = await sharp(combinedLayersBuffer)
            .composite([{ input: maskSvg, blend: 'dest-in' }])
            .png()
            .toBuffer();

        return await sharp(buffer)
            .composite([{ input: finalBlurredOverlay }])
            .png()
            .toBuffer();

    } catch (error) {
        console.error('Error processing image:', error);
        return buffer;
    }
}

async function applyProxyNote(buffer: Buffer, config: PostProcessingProfile, scryfallCard: ScryfallCard, moxfieldCard: MoxfieldCard, face: 'front' | 'back') {
    if (config.copyrightBehavior !== 'proxy') return buffer;

    const img = sharp(buffer);
    const { width, height } = await img.metadata();

    const frame = scryfallCard.frame;
    const cardFace = moxfieldCard.card.card_faces && moxfieldCard.card.card_faces[face === 'back' ? 1 : 0];
    const typeLine = cardFace?.type_line || moxfieldCard.card.type_line;

    let proxyBox: ProxyNoteBox;
    if (frame === '1993') {
        proxyBox = PROXY_NOTE_POSITIONS[frame].default;
    } else if (frame === '1997') {
        proxyBox = PROXY_NOTE_POSITIONS[frame].default;
    } else if (frame === '2003') {
        if (typeLine.includes('Planeswalker')) {
            proxyBox = PROXY_NOTE_POSITIONS[frame].planeswalker;
        } else if (typeLine.includes('Plane') || typeLine.includes('Phenomenon')) {
            proxyBox = PROXY_NOTE_POSITIONS[frame].planechase;
        } else {
            proxyBox = PROXY_NOTE_POSITIONS[frame].default;
        }
    } else {
        if (typeLine.includes('Plane') || typeLine.includes('Phenomenon')) {
            proxyBox = PROXY_NOTE_POSITIONS['2015'].planechase;
        } else {
            proxyBox = PROXY_NOTE_POSITIONS['2015'].default;
        }
    }

    const compositeBuffer = getProxyNoteCompositeBuffer(proxyBox, width, height);

    return await sharp(buffer)
        .composite([{ input: compositeBuffer }])
        .png()
        .toBuffer();
}

function getProxyNoteCompositeBuffer(box: ProxyNoteBox, width: number, height: number) {
    const x = Math.round(box.x * width);
    const y = Math.round(box.y * height);

    let targetHeight: number;
    let targetWidth: number;

    if (box.orientation === 'horizontal') {
        const aspectRatio = 522 / 33;
        targetHeight = Math.round(box.size * height);
        targetWidth = Math.round(aspectRatio * targetHeight);
    } else {
        const aspectRatio = 33 / 522;
        targetWidth = Math.round(box.size * width);
        targetHeight = Math.round(targetWidth / aspectRatio);
    }

    let positionX: number;
    if (box.horizontalAlignment === 'right') {
        positionX = x - targetWidth;
    } else if (box.horizontalAlignment === 'center') {
        positionX = x - targetWidth / 2;
    } else {
        positionX = x;
    }

    let positionY: number;
    if (box.verticalAlignment === 'center') {
        positionY = y - targetHeight / 2;
    } else {
        positionY = y;
    }

    if (box.orientation === 'horizontal') {
        return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
            <svg x="${positionX}" y="${positionY}" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 522 33" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0.421875C2.17188 0.140625 4.39844 0 6.67969 0C10.9297 0 14.1562 1 16.3594 3C18.5781 4.98438 19.6875 7.96094 19.6875 11.9297C19.6875 15.4766 18.4766 18.2812 16.0547 20.3438C13.7891 22.2812 10.875 23.25 7.3125 23.25C6.90625 23.25 6.46094 23.2266 5.97656 23.1797V31.7578H0V0.421875ZM7.38281 5.64844C6.91406 5.64844 6.44531 5.66406 5.97656 5.69531V18.0234C6.47656 18.0859 7.08594 18.1172 7.80469 18.1172C8.52344 18.1172 9.27344 17.9688 10.0547 17.6719C10.8359 17.3594 11.4922 16.9297 12.0234 16.3828C13.1328 15.2422 13.6875 13.7422 13.6875 11.8828C13.6875 7.72656 11.5859 5.64844 7.38281 5.64844Z" fill="white"/>
                <path d="M34.5703 19.6406C34.1016 19.6719 33.6016 19.6875 33.0703 19.6875C32.5391 19.6875 31.75 19.6484 30.7031 19.5703V31.7578H24.4922V0.421875C26.6797 0.140625 29.3672 0 32.5547 0C36.8984 0 40.1328 0.804688 42.2578 2.41406C44.3984 4.00781 45.4688 6.47656 45.4688 9.82031C45.4688 12.4141 44.4922 14.6328 42.5391 16.4766C41.8984 17.0703 41.1641 17.5859 40.3359 18.0234L45.1172 28.1016C46.0547 30.1797 46.7734 31.4141 47.2734 31.8047L47.1562 31.9219C45.6406 31.6719 43.2578 31.6797 40.0078 31.9453L34.5703 19.6406ZM33 5.53125C32.2031 5.53125 31.4375 5.57031 30.7031 5.64844V14.6016C31.4688 14.7109 32.3672 14.7656 33.3984 14.7656C34.4297 14.7656 35.2969 14.6797 36 14.5078C36.7031 14.3203 37.3125 14.0391 37.8281 13.6641C38.9375 12.8359 39.4922 11.5938 39.4922 9.9375C39.4922 8.28125 38.9141 7.11719 37.7578 6.44531C36.6797 5.83594 35.0938 5.53125 33 5.53125Z" fill="white"/>
                <path d="M55.0312 28.0547C53.6094 26.6953 52.4844 25.0625 51.6562 23.1562C50.8438 21.25 50.4375 19.1641 50.4375 16.8984C50.4375 14.6172 50.8203 12.4609 51.5859 10.4297C52.3516 8.39844 53.4453 6.60938 54.8672 5.0625C56.2891 3.51562 58.0078 2.28906 60.0234 1.38281C62.0391 0.460938 64.2969 0 66.7969 0C71.1094 0 74.7422 1.35938 77.6953 4.07812C80.8516 6.98438 82.4297 10.9062 82.4297 15.8438C82.4297 20.625 80.8047 24.6016 77.5547 27.7734C75.5547 29.7266 73.1719 31.0703 70.4062 31.8047C69.0469 32.1641 67.4531 32.3438 65.625 32.3438C63.8125 32.3438 61.9453 31.9688 60.0234 31.2188C58.1172 30.4688 56.4531 29.4141 55.0312 28.0547ZM56.9531 16.5703C56.9531 18.0234 57.1953 19.3594 57.6797 20.5781C58.1641 21.7969 58.8359 22.8438 59.6953 23.7188C61.5234 25.5625 63.875 26.4844 66.75 26.4844C69.4844 26.4844 71.6797 25.6016 73.3359 23.8359C75.0234 22.0078 75.8672 19.5156 75.8672 16.3594C75.8672 13.3906 75.0625 10.9141 73.4531 8.92969C71.7188 6.80469 69.3438 5.74219 66.3281 5.74219C63.4062 5.74219 61.0859 6.82031 59.3672 8.97656C57.7578 10.9922 56.9531 13.5234 56.9531 16.5703Z" fill="white"/>
                <path d="M102.703 2.85938C103.031 2.17188 103.195 1.66406 103.195 1.33594C103.195 0.992188 103.164 0.742188 103.102 0.585938H111.539C111.367 0.773438 111.148 1 110.883 1.26562C110.617 1.51562 110.32 1.82031 109.992 2.17969C109.211 3.05469 108.492 4.07031 107.836 5.22656L102.188 15.5391L107.461 25.4531L108.094 26.7422C109.281 29.2109 110.289 30.8828 111.117 31.7578H103.477C103.414 31.2109 103.148 30.4766 102.68 29.5547L98.0859 20.7422C94.8516 27.2891 93.1953 30.6641 93.1172 30.8672C93.0391 31.1328 92.9766 31.4297 92.9297 31.7578H85.2891C85.8672 31.1641 86.4609 30.3281 87.0703 29.25L89.8828 24.2578L94.875 15.7969L88.3125 3.44531C87.6094 2.11719 86.9922 1.16406 86.4609 0.585938H94.3359C94.2734 0.742188 94.2422 0.914062 94.2422 1.10156C94.2422 1.52344 94.4375 2.10938 94.8281 2.85938L98.7422 10.6875L102.703 2.85938Z" fill="white"/>
                <path d="M123 31.7578C123.203 31.1484 123.305 29.7266 123.305 27.4922V20.9766C120.602 15.0234 118.875 11.3125 118.125 9.84375C117.375 8.35938 116.742 7.1875 116.227 6.32812C114.602 3.57812 113.617 2 113.273 1.59375C112.945 1.1875 112.609 0.851562 112.266 0.585938H120.352C120.523 0.898438 120.758 1.35938 121.055 1.96875L126.727 13.9453C126.992 13.2891 127.305 12.5547 127.664 11.7422C131.07 4.41406 132.797 0.695312 132.844 0.585938H140.578C139.781 1.22656 138.805 2.57031 137.648 4.61719C137.289 5.22656 136.93 5.92188 136.57 6.70312L131.273 17.7422C130.68 19.0703 130.172 20.2656 129.75 21.3281V28.0547C129.75 29.6172 129.844 30.8516 130.031 31.7578H123Z" fill="white"/>
                <path d="M163.055 20.0391C161.867 20.0391 160.898 20.0781 160.148 20.1562L160.219 14.3672C160.578 14.4609 161.609 14.5078 163.312 14.5078H189.047C190.75 14.5078 191.781 14.4609 192.141 14.3672L192.211 20.1562C191.461 20.0781 190.492 20.0391 189.305 20.0391H163.055Z" fill="white"/>
                <path d="M216.281 31.7578C216.375 31.2266 216.422 30.6484 216.422 30.0234V0.585938H221.109L233.531 20.1328V2.17969C233.531 1.32031 233.453 0.789062 233.297 0.585938H239.625C239.547 1.21094 239.508 1.89844 239.508 2.64844V31.7578H234.633L222.398 12.9844V31.7578H216.281Z" fill="white"/>
                <path d="M250.5 28.0547C249.078 26.6953 247.953 25.0625 247.125 23.1562C246.312 21.25 245.906 19.1641 245.906 16.8984C245.906 14.6172 246.289 12.4609 247.055 10.4297C247.82 8.39844 248.914 6.60938 250.336 5.0625C251.758 3.51562 253.477 2.28906 255.492 1.38281C257.508 0.460938 259.766 0 262.266 0C266.578 0 270.211 1.35938 273.164 4.07812C276.32 6.98438 277.898 10.9062 277.898 15.8438C277.898 20.625 276.273 24.6016 273.023 27.7734C271.023 29.7266 268.641 31.0703 265.875 31.8047C264.516 32.1641 262.922 32.3438 261.094 32.3438C259.281 32.3438 257.414 31.9688 255.492 31.2188C253.586 30.4688 251.922 29.4141 250.5 28.0547ZM252.422 16.5703C252.422 18.0234 252.664 19.3594 253.148 20.5781C253.633 21.7969 254.305 22.8438 255.164 23.7188C256.992 25.5625 259.344 26.4844 262.219 26.4844C264.953 26.4844 267.148 25.6016 268.805 23.8359C270.492 22.0078 271.336 19.5156 271.336 16.3594C271.336 13.3906 270.531 10.9141 268.922 8.92969C267.188 6.80469 264.812 5.74219 261.797 5.74219C258.875 5.74219 256.555 6.82031 254.836 8.97656C253.227 10.9922 252.422 13.5234 252.422 16.5703Z" fill="white"/>
                <path d="M295.195 31.8984C294.445 31.8047 292.516 31.7578 289.406 31.7578H288.656V5.83594H284.016C282.641 5.83594 281.828 5.90625 281.578 6.04688C281.328 6.1875 281.133 6.3125 280.992 6.42188L280.922 6.39844V0.398438L280.992 0.328125C281.508 0.5 282.898 0.585938 285.164 0.585938H299.859C301.234 0.585938 302.047 0.515625 302.297 0.375C302.547 0.234375 302.742 0.109375 302.883 0L302.953 0.0234375V6.02344L302.883 6.09375C302.367 5.92188 300.977 5.83594 298.711 5.83594H295.195V31.8984Z" fill="white"/>
                <path d="M340.359 18.2812C339.609 18.2031 338.641 18.1641 337.453 18.1641H330.352V31.7578H323.93V0.421875C324.352 0.453125 324.836 0.476562 325.383 0.492188L327.117 0.539062C328.305 0.570312 329.539 0.585938 330.82 0.585938C334.664 0.585938 338.336 0.523438 341.836 0.398438C341.664 1.77344 341.578 3.60938 341.578 5.90625C341.578 6.15625 341.594 6.34375 341.625 6.46875L341.578 6.53906C340.75 6.30469 339.594 6.1875 338.109 6.1875H330.352V12.6328H337.195C338.914 12.6328 339.945 12.5859 340.289 12.4922L340.359 18.2812Z" fill="white"/>
                <path d="M350.438 28.0547C349.016 26.6953 347.891 25.0625 347.062 23.1562C346.25 21.25 345.844 19.1641 345.844 16.8984C345.844 14.6172 346.227 12.4609 346.992 10.4297C347.758 8.39844 348.852 6.60938 350.273 5.0625C351.695 3.51562 353.414 2.28906 355.43 1.38281C357.445 0.460938 359.703 0 362.203 0C366.516 0 370.148 1.35938 373.102 4.07812C376.258 6.98438 377.836 10.9062 377.836 15.8438C377.836 20.625 376.211 24.6016 372.961 27.7734C370.961 29.7266 368.578 31.0703 365.812 31.8047C364.453 32.1641 362.859 32.3438 361.031 32.3438C359.219 32.3438 357.352 31.9688 355.43 31.2188C353.523 30.4688 351.859 29.4141 350.438 28.0547ZM352.359 16.5703C352.359 18.0234 352.602 19.3594 353.086 20.5781C353.57 21.7969 354.242 22.8438 355.102 23.7188C356.93 25.5625 359.281 26.4844 362.156 26.4844C364.891 26.4844 367.086 25.6016 368.742 23.8359C370.43 22.0078 371.273 19.5156 371.273 16.3594C371.273 13.3906 370.469 10.9141 368.859 8.92969C367.125 6.80469 364.75 5.74219 361.734 5.74219C358.812 5.74219 356.492 6.82031 354.773 8.97656C353.164 10.9922 352.359 13.5234 352.359 16.5703Z" fill="white"/>
                <path d="M393.961 19.6406C393.492 19.6719 392.992 19.6875 392.461 19.6875C391.93 19.6875 391.141 19.6484 390.094 19.5703V31.7578H383.883V0.421875C386.07 0.140625 388.758 0 391.945 0C396.289 0 399.523 0.804688 401.648 2.41406C403.789 4.00781 404.859 6.47656 404.859 9.82031C404.859 12.4141 403.883 14.6328 401.93 16.4766C401.289 17.0703 400.555 17.5859 399.727 18.0234L404.508 28.1016C405.445 30.1797 406.164 31.4141 406.664 31.8047L406.547 31.9219C405.031 31.6719 402.648 31.6797 399.398 31.9453L393.961 19.6406ZM392.391 5.53125C391.594 5.53125 390.828 5.57031 390.094 5.64844V14.6016C390.859 14.7109 391.758 14.7656 392.789 14.7656C393.82 14.7656 394.688 14.6797 395.391 14.5078C396.094 14.3203 396.703 14.0391 397.219 13.6641C398.328 12.8359 398.883 11.5938 398.883 9.9375C398.883 8.28125 398.305 7.11719 397.148 6.44531C396.07 5.83594 394.484 5.53125 392.391 5.53125Z" fill="white"/>
                <path d="M446.625 2.32031L446.18 9.21094L446.016 9.25781C444.859 7.52344 442.891 6.39844 440.109 5.88281C439.234 5.71094 438.391 5.625 437.578 5.625C436.781 5.625 436.094 5.69531 435.516 5.83594C434.953 5.97656 434.469 6.17969 434.062 6.44531C433.203 7.00781 432.773 7.74219 432.773 8.64844C432.773 9.83594 433.148 10.7266 433.898 11.3203C434.836 12.0391 436.391 12.5469 438.562 12.8438C440.734 13.125 442.477 13.5156 443.789 14.0156C445.102 14.5156 446.18 15.1484 447.023 15.9141C448.617 17.3516 449.414 19.3828 449.414 22.0078C449.414 25.4453 448.117 28.0938 445.523 29.9531C443.305 31.5469 440.508 32.3438 437.133 32.3438C434.414 32.3438 431.727 31.8281 429.07 30.7969C428.195 30.4531 427.43 30.0547 426.773 29.6016L427.031 21.7734L427.125 21.7031C429.062 25.0469 432.242 26.7188 436.664 26.7188C439.805 26.7188 441.883 25.9609 442.898 24.4453C443.242 23.9297 443.414 23.3594 443.414 22.7344C443.414 22.0938 443.312 21.5703 443.109 21.1641C442.906 20.7422 442.57 20.3828 442.102 20.0859C441.195 19.4922 439.672 19.0938 437.531 18.8906C435.391 18.6875 433.641 18.3047 432.281 17.7422C430.922 17.1797 429.836 16.4844 429.023 15.6562C427.555 14.1562 426.82 12.0625 426.82 9.375C426.82 6.59375 427.797 4.34375 429.75 2.625C431.734 0.875 434.406 0 437.766 0C441.141 0 444.094 0.773438 446.625 2.32031Z" fill="white"/>
                <path d="M458.062 31.9453C456.719 31.8203 455.148 31.7578 453.352 31.7578H451.5L461.695 3.1875C462.148 1.90625 462.375 1.16406 462.375 0.960938C462.375 0.742188 462.367 0.609375 462.352 0.5625L462.375 0.515625C463.391 0.5625 464.469 0.585938 465.609 0.585938C466.547 0.585938 467.672 0.570312 468.984 0.539062L469.008 0.585938C468.977 0.648438 468.961 0.734375 468.961 0.84375C468.961 1.14062 469.195 1.92969 469.664 3.21094L480.07 31.8281C479.758 31.8125 479.391 31.8047 478.969 31.8047C478.969 31.8047 478.562 31.7891 477.75 31.7578C477.359 31.7578 477.008 31.7578 476.695 31.7578H473.062L470.859 25.0078H460.266L458.062 31.9453ZM469.031 19.3828L465.492 8.48438L462.047 19.3828H469.031Z" fill="white"/>
                <path d="M488.438 31.7578C486.141 31.7578 484.617 31.8047 483.867 31.8984V0.445312C484.242 0.539062 485.016 0.585938 486.188 0.585938C487.375 0.585938 488.75 0.554688 490.312 0.492188V26.1328H495.164C496.57 26.1328 497.695 26.0859 498.539 25.9922C498.43 29.6484 498.375 31.5469 498.375 31.6875V31.9219C496.844 31.8125 494.273 31.7578 490.664 31.7578H488.438Z" fill="white"/>
                <path d="M519.609 26.1328C520.578 26.1328 521.25 26.0391 521.625 25.8516L521.719 25.875L521.484 31.7578H503.93V0.421875C504.352 0.453125 504.82 0.476562 505.336 0.492188L506.977 0.539062C508.07 0.570312 509.258 0.585938 510.539 0.585938C514.117 0.585938 517.656 0.523438 521.156 0.398438C520.984 1.77344 520.898 3.60938 520.898 5.90625C520.898 6.15625 520.914 6.34375 520.945 6.46875L520.898 6.53906C520.086 6.30469 518.93 6.1875 517.43 6.1875H510.047V12.1641H515.602C517.32 12.1641 518.352 12.1172 518.695 12.0234L518.766 17.8125C518.016 17.7344 517.047 17.6953 515.859 17.6953H510.047V26.1328H519.609Z" fill="white"/>
            </svg>
        </svg>`);
    }

    return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
        <svg x="${positionX}" y="${positionY}" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 33 522" fill="none">
            <path d="M0.421875 521.719C0.140625 519.547 -1.92262e-07 517.32 -2.91978e-07 515.039C-4.77752e-07 510.789 0.999999 507.562 3 505.359C4.98437 503.141 7.96094 502.031 11.9297 502.031C15.4766 502.031 18.2812 503.242 20.3437 505.664C22.2812 507.93 23.25 510.844 23.25 514.406C23.25 514.812 23.2266 515.258 23.1797 515.742L31.7578 515.742L31.7578 521.719L0.421875 521.719ZM5.64844 514.336C5.64844 514.805 5.66406 515.273 5.69531 515.742L18.0234 515.742C18.0859 515.242 18.1172 514.633 18.1172 513.914C18.1172 513.195 17.9687 512.445 17.6719 511.664C17.3594 510.883 16.9297 510.227 16.3828 509.695C15.2422 508.586 13.7422 508.031 11.8828 508.031C7.72656 508.031 5.64844 510.133 5.64844 514.336Z" fill="white"/>
            <path d="M19.6406 487.148C19.6719 487.617 19.6875 488.117 19.6875 488.648C19.6875 489.18 19.6484 489.969 19.5703 491.016L31.7578 491.016L31.7578 497.227L0.421874 497.227C0.140624 495.039 -1.28368e-06 492.352 -1.42301e-06 489.164C-1.61288e-06 484.82 0.804686 481.586 2.41406 479.461C4.00781 477.32 6.47656 476.25 9.82031 476.25C12.4141 476.25 14.6328 477.227 16.4766 479.18C17.0703 479.82 17.5859 480.555 18.0234 481.383L28.1016 476.602C30.1797 475.664 31.4141 474.945 31.8047 474.445L31.9219 474.562C31.6719 476.078 31.6797 478.461 31.9453 481.711L19.6406 487.148ZM5.53125 488.719C5.53125 489.516 5.57031 490.281 5.64844 491.016L14.6016 491.016C14.7109 490.25 14.7656 489.352 14.7656 488.32C14.7656 487.289 14.6797 486.422 14.5078 485.719C14.3203 485.016 14.0391 484.406 13.6641 483.891C12.8359 482.781 11.5937 482.227 9.9375 482.227C8.28125 482.227 7.11719 482.805 6.44531 483.961C5.83594 485.039 5.53125 486.625 5.53125 488.719Z" fill="white"/>
            <path d="M28.0547 466.687C26.6953 468.109 25.0625 469.234 23.1562 470.062C21.25 470.875 19.1641 471.281 16.8984 471.281C14.6172 471.281 12.4609 470.898 10.4297 470.133C8.39844 469.367 6.60937 468.273 5.0625 466.852C3.51562 465.43 2.28906 463.711 1.38281 461.695C0.460935 459.68 -2.81051e-06 457.422 -2.91978e-06 454.922C-3.10829e-06 450.609 1.35937 446.977 4.07812 444.023C6.98437 440.867 10.9062 439.289 15.8437 439.289C20.625 439.289 24.6016 440.914 27.7734 444.164C29.7266 446.164 31.0703 448.547 31.8047 451.312C32.1641 452.672 32.3437 454.266 32.3437 456.094C32.3437 457.906 31.9687 459.773 31.2187 461.695C30.4687 463.602 29.4141 465.266 28.0547 466.687ZM16.5703 464.766C18.0234 464.766 19.3594 464.523 20.5781 464.039C21.7969 463.555 22.8437 462.883 23.7187 462.023C25.5625 460.195 26.4844 457.844 26.4844 454.969C26.4844 452.234 25.6016 450.039 23.8359 448.383C22.0078 446.695 19.5156 445.852 16.3594 445.852C13.3906 445.852 10.9141 446.656 8.92968 448.266C6.80468 450 5.74218 452.375 5.74218 455.391C5.74218 458.312 6.82031 460.633 8.97656 462.352C10.9922 463.961 13.5234 464.766 16.5703 464.766Z" fill="white"/>
            <path d="M2.85937 419.016C2.17187 418.687 1.66406 418.523 1.33593 418.523C0.992183 418.523 0.742183 418.555 0.585933 418.617L0.585933 410.18C0.773433 410.352 0.999995 410.57 1.26562 410.836C1.51562 411.102 1.82031 411.398 2.17968 411.727C3.05468 412.508 4.07031 413.227 5.22656 413.883L15.5391 419.531L25.4531 414.258L26.7422 413.625C29.2109 412.437 30.8828 411.43 31.7578 410.602L31.7578 418.242C31.2109 418.305 30.4766 418.57 29.5547 419.039L20.7422 423.633C27.2891 426.867 30.6641 428.523 30.8672 428.602C31.1328 428.68 31.4297 428.742 31.7578 428.789L31.7578 436.43C31.1641 435.852 30.3281 435.258 29.25 434.648L24.2578 431.836L15.7969 426.844L3.44531 433.406C2.11718 434.109 1.16406 434.727 0.585934 435.258L0.585933 427.383C0.742183 427.445 0.914058 427.477 1.10156 427.477C1.52343 427.477 2.10937 427.281 2.85937 426.891L10.6875 422.977L2.85937 419.016Z" fill="white"/>
            <path d="M31.7578 398.719C31.1484 398.516 29.7266 398.414 27.4922 398.414L20.9766 398.414C15.0234 401.117 11.3125 402.844 9.84374 403.594C8.35937 404.344 7.18749 404.977 6.32812 405.492C3.57812 407.117 2 408.102 1.59375 408.445C1.1875 408.773 0.851558 409.109 0.585933 409.453L0.585932 401.367C0.898432 401.195 1.35937 400.961 1.96874 400.664L13.9453 394.992C13.2891 394.727 12.5547 394.414 11.7422 394.055C4.41406 390.648 0.695307 388.922 0.585932 388.875L0.585931 381.141C1.22656 381.937 2.57031 382.914 4.61718 384.07C5.22656 384.43 5.92187 384.789 6.70312 385.148L17.7422 390.445C19.0703 391.039 20.2656 391.547 21.3281 391.969L28.0547 391.969C29.6172 391.969 30.8516 391.875 31.7578 391.687L31.7578 398.719Z" fill="white"/>
            <path d="M20.0391 358.664C20.0391 359.852 20.0781 360.82 20.1562 361.57L14.3672 361.5C14.4609 361.141 14.5078 360.109 14.5078 358.406L14.5078 332.672C14.5078 330.969 14.4609 329.937 14.3672 329.578L20.1562 329.508C20.0781 330.258 20.0391 331.227 20.0391 332.414L20.0391 358.664Z" fill="white"/>
            <path d="M31.7578 305.437C31.2266 305.344 30.6484 305.297 30.0234 305.297L0.585928 305.297L0.585928 300.609L20.1328 288.187L2.17968 288.187C1.3203 288.187 0.789052 288.266 0.585927 288.422L0.585927 282.094C1.21093 282.172 1.89843 282.211 2.64843 282.211L31.7578 282.211L31.7578 287.086L12.9844 299.32L31.7578 299.32L31.7578 305.437Z" fill="white"/>
            <path d="M28.0547 271.219C26.6953 272.641 25.0625 273.766 23.1562 274.594C21.25 275.406 19.1641 275.812 16.8984 275.812C14.6172 275.812 12.4609 275.43 10.4297 274.664C8.39843 273.898 6.60936 272.805 5.06249 271.383C3.51561 269.961 2.28905 268.242 1.3828 266.227C0.460926 264.211 -1.13547e-05 261.953 -1.1464e-05 259.453C-1.16525e-05 255.141 1.35936 251.508 4.07811 248.555C6.98436 245.398 10.9062 243.82 15.8437 243.82C20.625 243.82 24.6016 245.445 27.7734 248.695C29.7266 250.695 31.0703 253.078 31.8047 255.844C32.1641 257.203 32.3437 258.797 32.3437 260.625C32.3437 262.437 31.9687 264.305 31.2187 266.227C30.4687 268.133 29.4141 269.797 28.0547 271.219ZM16.5703 269.297C18.0234 269.297 19.3594 269.055 20.5781 268.57C21.7969 268.086 22.8437 267.414 23.7187 266.555C25.5625 264.727 26.4844 262.375 26.4844 259.5C26.4844 256.766 25.6016 254.57 23.8359 252.914C22.0078 251.227 19.5156 250.383 16.3594 250.383C13.3906 250.383 10.9141 251.187 8.92968 252.797C6.80468 254.531 5.74218 256.906 5.74218 259.922C5.74218 262.844 6.8203 265.164 8.97655 266.883C10.9922 268.492 13.5234 269.297 16.5703 269.297Z" fill="white"/>
            <path d="M31.8984 226.523C31.8047 227.273 31.7578 229.203 31.7578 232.312L31.7578 233.062L5.83592 233.062L5.83593 237.703C5.83593 239.078 5.90624 239.891 6.04686 240.141C6.18749 240.391 6.31249 240.586 6.42186 240.727L6.39843 240.797L0.398425 240.797L0.328113 240.727C0.499988 240.211 0.585925 238.82 0.585925 236.555L0.585924 221.859C0.585924 220.484 0.515612 219.672 0.374987 219.422C0.234362 219.172 0.109362 218.977 -1.32394e-05 218.836L0.0234243 218.766L6.02342 218.766L6.09374 218.836C5.92186 219.352 5.83592 220.742 5.83592 223.008L5.83592 226.523L31.8984 226.523Z" fill="white"/>
            <path d="M18.2812 181.359C18.2031 182.109 18.164 183.078 18.164 184.266L18.164 191.367L31.7578 191.367L31.7578 197.789L0.421861 197.789C0.453111 197.367 0.476548 196.883 0.492173 196.336L0.539048 194.602C0.570298 193.414 0.585923 192.18 0.585923 190.898C0.585923 187.055 0.523423 183.383 0.398423 179.883C1.77342 180.055 3.60936 180.141 5.90624 180.141C6.15624 180.141 6.34374 180.125 6.46874 180.094L6.53905 180.141C6.30467 180.969 6.18749 182.125 6.18749 183.609L6.18749 191.367L12.6328 191.367L12.6328 184.523C12.6328 182.805 12.5859 181.773 12.4922 181.43L18.2812 181.359Z" fill="white"/>
            <path d="M28.0547 171.281C26.6953 172.703 25.0625 173.828 23.1562 174.656C21.25 175.469 19.164 175.875 16.8984 175.875C14.6172 175.875 12.4609 175.492 10.4297 174.727C8.39842 173.961 6.60936 172.867 5.06248 171.445C3.51561 170.023 2.28905 168.305 1.3828 166.289C0.460922 164.273 -1.57231e-05 162.016 -1.58324e-05 159.516C-1.60209e-05 155.203 1.35936 151.57 4.07811 148.617C6.98436 145.461 10.9062 143.883 15.8437 143.883C20.625 143.883 24.6015 145.508 27.7734 148.758C29.7265 150.758 31.0703 153.141 31.8047 155.906C32.164 157.266 32.3437 158.859 32.3437 160.687C32.3437 162.5 31.9687 164.367 31.2187 166.289C30.4687 168.195 29.414 169.859 28.0547 171.281ZM16.5703 169.359C18.0234 169.359 19.3594 169.117 20.5781 168.633C21.7969 168.148 22.8437 167.477 23.7187 166.617C25.5625 164.789 26.4844 162.437 26.4844 159.562C26.4844 156.828 25.6015 154.633 23.8359 152.977C22.0078 151.289 19.5156 150.445 16.3594 150.445C13.3906 150.445 10.914 151.25 8.92967 152.859C6.80467 154.594 5.74217 156.969 5.74217 159.984C5.74217 162.906 6.8203 165.227 8.97655 166.945C10.9922 168.555 13.5234 169.359 16.5703 169.359Z" fill="white"/>
            <path d="M19.6406 127.758C19.6719 128.227 19.6875 128.727 19.6875 129.258C19.6875 129.789 19.6484 130.578 19.5703 131.625L31.7578 131.625L31.7578 137.836L0.421858 137.836C0.140608 135.648 -1.69931e-05 132.961 -1.71325e-05 129.773C-1.73223e-05 125.43 0.80467 122.195 2.41404 120.07C4.00779 117.93 6.47654 116.859 9.82029 116.859C12.414 116.859 14.6328 117.836 16.4765 119.789C17.0703 120.43 17.5859 121.164 18.0234 121.992L28.1015 117.211C30.1797 116.273 31.414 115.555 31.8047 115.055L31.9219 115.172C31.6719 116.687 31.6797 119.07 31.9453 122.32L19.6406 127.758ZM5.53123 129.328C5.53123 130.125 5.5703 130.891 5.64842 131.625L14.6015 131.625C14.7109 130.859 14.7656 129.961 14.7656 128.93C14.7656 127.898 14.6797 127.031 14.5078 126.328C14.3203 125.625 14.039 125.016 13.664 124.5C12.8359 123.391 11.5937 122.836 9.93748 122.836C8.28123 122.836 7.11717 123.414 6.4453 124.57C5.83592 125.648 5.53123 127.234 5.53123 129.328Z" fill="white"/>
            <path d="M2.32029 75.0937L9.21092 75.5391L9.25779 75.7031C7.52342 76.8594 6.39842 78.8281 5.88279 81.6094C5.71092 82.4844 5.62498 83.3281 5.62498 84.1406C5.62498 84.9375 5.69529 85.625 5.83592 86.2031C5.97654 86.7656 6.17967 87.25 6.44529 87.6562C7.00779 88.5156 7.74217 88.9453 8.64842 88.9453C9.83592 88.9453 10.7265 88.5703 11.3203 87.8203C12.039 86.8828 12.5469 85.3281 12.8437 83.1562C13.125 80.9844 13.5156 79.2422 14.0156 77.9297C14.5156 76.6172 15.1484 75.5391 15.914 74.6953C17.3515 73.1016 19.3828 72.3047 22.0078 72.3047C25.4453 72.3047 28.0937 73.6016 29.9531 76.1953C31.5469 78.4141 32.3437 81.2109 32.3437 84.5859C32.3437 87.3047 31.8281 89.9922 30.7969 92.6484C30.4531 93.5234 30.0547 94.2891 29.6015 94.9453L21.7734 94.6875L21.7031 94.5937C25.0469 92.6562 26.7187 89.4766 26.7187 85.0547C26.7187 81.9141 25.9609 79.8359 24.4453 78.8203C23.9297 78.4766 23.3594 78.3047 22.7344 78.3047C22.0937 78.3047 21.5703 78.4062 21.164 78.6094C20.7422 78.8125 20.3828 79.1484 20.0859 79.6172C19.4922 80.5234 19.0937 82.0469 18.8906 84.1875C18.6875 86.3281 18.3047 88.0781 17.7422 89.4375C17.1797 90.7969 16.4844 91.8828 15.6562 92.6953C14.1562 94.1641 12.0625 94.8984 9.37498 94.8984C6.59373 94.8984 4.34373 93.9219 2.62498 91.9687C0.874981 89.9844 -1.89885e-05 87.3125 -1.91353e-05 83.9531C-1.92829e-05 80.5781 0.773418 77.625 2.32029 75.0937Z" fill="white"/>
            <path d="M31.9453 63.6562C31.8203 65 31.7578 66.5703 31.7578 68.3672L31.7578 70.2187L3.18748 60.0234C1.90623 59.5703 1.16404 59.3437 0.960917 59.3437C0.742167 59.3437 0.609355 59.3516 0.56248 59.3672L0.515605 59.3437C0.56248 58.3281 0.585917 57.25 0.585917 56.1094C0.585917 55.1719 0.570292 54.0469 0.539042 52.7344L0.585917 52.7109C0.648417 52.7422 0.734355 52.7578 0.84373 52.7578C1.1406 52.7578 1.92967 52.5234 3.21092 52.0547L31.8281 41.6484C31.8125 41.9609 31.8047 42.3281 31.8047 42.75C31.8047 42.75 31.789 43.1562 31.7578 43.9687C31.7578 44.3594 31.7578 44.7109 31.7578 45.0234L31.7578 48.6562L25.0078 50.8594L25.0078 61.4531L31.9453 63.6562ZM19.3828 52.6875L8.48435 56.2266L19.3828 59.6719L19.3828 52.6875Z" fill="white"/>
            <path d="M31.7578 33.2812C31.7578 35.5781 31.8047 37.1016 31.8984 37.8516L0.445291 37.8516C0.539041 37.4766 0.585916 36.7031 0.585916 35.5312C0.585916 34.3437 0.554666 32.9687 0.492166 31.4062L26.1328 31.4062L26.1328 26.5547C26.1328 25.1484 26.0859 24.0234 25.9922 23.1797C29.6484 23.2891 31.5469 23.3437 31.6875 23.3437L31.9219 23.3437C31.8125 24.875 31.7578 27.4453 31.7578 31.0547L31.7578 33.2812Z" fill="white"/>
            <path d="M26.1328 2.10937C26.1328 1.14062 26.039 0.468749 25.8515 0.0937489L25.875 -1.13103e-06L31.7578 0.234374L31.7578 17.7891L0.421853 17.7891C0.453103 17.3672 0.47654 16.8984 0.492165 16.3828L0.53904 14.7422C0.57029 13.6484 0.585915 12.4609 0.585915 11.1797C0.585915 7.60156 0.523415 4.0625 0.398415 0.5625C1.77341 0.734375 3.60935 0.820312 5.90623 0.820312C6.15623 0.820312 6.34373 0.804687 6.46873 0.773437L6.53904 0.820312C6.30466 1.63281 6.18748 2.78906 6.18748 4.28906L6.18748 11.6719L12.164 11.6719L12.164 6.11719C12.164 4.39844 12.1172 3.36719 12.0234 3.02344L17.8125 2.95312C17.7344 3.70312 17.6953 4.67187 17.6953 5.85937L17.6953 11.6719L26.1328 11.6719L26.1328 2.10937Z" fill="white"/>
        </svg>
    </svg>`);
}

async function removeStamps(buffer: Buffer, scryfallCard: ScryfallCard) {
    if (scryfallCard.frame === 'planar') return buffer;

    const img = sharp(buffer);
    const { width, height } = await img.metadata();

    if (scryfallCard.frame === '2015' && scryfallCard.security_stamp === 'oval') {
        return await img
            .composite([
                getOvalComposite(width, height, {
                    x: STAMP_OVAL.x * width,
                    y: STAMP_OVAL.y * height,
                    rx: STAMP_OVAL.rx * width,
                    ry: STAMP_OVAL.ry * height,
                }, {
                    fillColor: '#5f5f5f',
                    strokeColor: '#6c6a6b',
                    strokeWidth: 1,
                    opacity: 1
                })
            ])
            .png()
            .toBuffer();
    } else if (scryfallCard.frame === '2015' && scryfallCard.security_stamp === 'triangle') {
        return await img
            .composite([
                getTriangleComposite(width, height, {
                    x1: STAMP_TRIANGLE.x1 * width,
                    y1: STAMP_TRIANGLE.y1 * height,
                    x2: STAMP_TRIANGLE.x2 * width,
                    y2: STAMP_TRIANGLE.y2 * height,
                    x3: STAMP_TRIANGLE.x3 * width,
                    y3: STAMP_TRIANGLE.y3 * height,
                }, {
                    fillColor: '#5f5f5f',
                    strokeColor: '#6c6a6b',
                    strokeWidth: 1,
                    opacity: 1
                })
            ])
            .png()
            .toBuffer();
    }

    return buffer;
}

function getOvalComposite(width: number, height: number, oval: Oval, options: StampOptions) {
    const { x, y, rx, ry } = oval;
    const { strokeColor, fillColor, strokeWidth, opacity } = options;

    const svgOval = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <ellipse 
              cx="${x}" 
              cy="${y}" 
              rx="${rx}" 
              ry="${ry}" 
              fill="${fillColor}" 
              stroke="${strokeColor || fillColor}"
              stroke-width="${strokeWidth}"
              fill-opacity="${opacity}"
              stroke-opacity="${opacity}"
          />
      </svg>`;

    return { input: Buffer.from(svgOval), top: 0, left: 0 };
}

function getTriangleComposite(width: number, height: number, triangle: Triangle, options: StampOptions) {
    const { x1, y1, x2, y2, x3, y3 } = triangle;
    const { strokeColor, fillColor, strokeWidth, opacity } = options;

    const svgTriangle = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <polygon 
          points="${x1},${y1} ${x2},${y2} ${x3},${y3}" 
          fill="${fillColor}" 
          stroke="${strokeColor || fillColor}"
          stroke-width="${strokeWidth}"
          fill-opacity="${opacity}"
          stroke-opacity="${opacity}" />
      </svg>`;

    return { input: Buffer.from(svgTriangle), top: 0, left: 0 };
}

async function resizeAndCrop(buffer: Buffer, scale: number, width: number, height: number, mask: any) {
    const newWidth = Math.round(width * scale);
    const newHeight = Math.round(height / width * newWidth);

    const newBuffer = await sharp(buffer).composite([{
        input: mask, blend: 'dest-in'
    }]).toBuffer();

    return await crop(sharp(newBuffer).resize(newWidth), newWidth, newHeight, width, height);
}

async function crop(image: Sharp, width: number, height: number, targetWidth: number, targetHeight: number) {
    return await image.extract({
        left: Math.round((width - targetWidth) / 2),
        top: Math.round((height - targetHeight) / 2),
        width: targetWidth,
        height: targetHeight
    }).png().toBuffer();
}
