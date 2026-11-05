import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFImage } from "pdf-lib";
import sharp from "sharp";
import type { Order } from "../config/orderConfigManager.js";
import type { PdfLayout } from "../config/processingProfileManager.js";
import type { MoxfieldCardPrintingData } from "../clients/moxfield.js";
import type { CardQueueItem } from "../pipeline/types.js";

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;
const PAGE_SIZE_POINTS = 3.5 * POINTS_PER_INCH;

const mmToPoints = (mm: number) => mm / MM_PER_INCH * POINTS_PER_INCH;

export function getEffectivePdfLayout(order: Order): PdfLayout {
    return { ...order.profile.pdfLayout, ...order.pdfLayoutOverride };
}

/**
 * Writes the order as a set of PDFs (one card face per page). The base card is placed at the configured margins and
 * size, the bleed area extends outwards from there. Front and back faces go into separate PDFs.
 */
export async function createPdfOrder(
    order: Order,
    items: CardQueueItem[],
    cards: MoxfieldCardPrintingData[],
    cardsDir: string,
    outputDir: string
): Promise<string[]> {
    const layout = getEffectivePdfLayout(order);
    const { cardWidth, bleedWidth } = order.profile.postProcessing;

    const fronts: string[] = [];
    const backs: string[] = [];
    for (const printing of cards) {
        const faces = items.filter(item => item.id === printing.card.id);
        const front = faces.find(item => item.face === 'front');
        if (!front) {
            console.error(`No front state found for card ${printing.card.name} (${printing.card.scryfall_id})`);
            continue;
        }

        const back = faces.find(item => item.face === 'back');
        for (let i = 0; i < printing.quantity; i++) {
            fronts.push(front.path);
            if (back) backs.push(back.path);
        }
    }

    await mkdir(outputDir, { recursive: true });

    const pagesPerPdf = Math.max(1, Math.floor(order.pagesPerPdf));
    const files: string[] = [];

    // Fronts and backs are printed independently, so they never share a PDF.
    for (const [kind, pages] of [['front', fronts], ['back', backs]] as const) {
        for (let start = 0; start < pages.length; start += pagesPerPdf) {
            const doc = await PDFDocument.create();
            const embedded = new Map<string, { image: PDFImage, width: number, height: number }>();

            for (const file of pages.slice(start, start + pagesPerPdf)) {
                let entry = embedded.get(file);
                if (!entry) {
                    const filePath = path.join(cardsDir, file);
                    const { width = 0, height = 0 } = await sharp(filePath).metadata();
                    const bytes = await readFile(filePath);
                    const image = /\.png$/i.test(file) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
                    entry = { image, width, height };
                    embedded.set(file, entry);
                }

                // Derive the bleed size in pixels (see applyBleed) to find the dimensions of the base card.
                const bleedRatio = bleedWidth / cardWidth;
                const bleedPx = Math.round(entry.width * bleedRatio / (1 + 2 * bleedRatio));
                const baseWidthPx = entry.width - 2 * bleedPx;
                const baseHeightPx = entry.height - 2 * bleedPx;

                const scaleX = mmToPoints(layout.printWidth) / baseWidthPx;
                const scaleY = mmToPoints(layout.printHeight) / baseHeightPx;

                const drawWidth = entry.width * scaleX;
                const drawHeight = entry.height * scaleY;
                const x = mmToPoints(layout.marginLeft) - bleedPx * scaleX;
                const top = mmToPoints(layout.marginTop) - bleedPx * scaleY;

                const page = doc.addPage([PAGE_SIZE_POINTS, PAGE_SIZE_POINTS]);
                page.drawImage(entry.image, { x, y: PAGE_SIZE_POINTS - top - drawHeight, width: drawWidth, height: drawHeight });
            }

            const fileName = `cards-${kind}-${String(Math.floor(start / pagesPerPdf) + 1).padStart(3, '0')}.pdf`;
            await writeFile(path.join(outputDir, fileName), await doc.save());
            files.push(fileName);
        }
    }
    return files;
}
