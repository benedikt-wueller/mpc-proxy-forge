import { type DeckConfig, DeckData, type Order, ProcessingState, saveOrder } from "./orderConfigManager.js";
import { delay, Listr, type ListrTask } from "listr2";
import { getMoxfieldDetails, type MoxfieldBoard, type MoxfieldCard, type MoxfieldDeck } from "./moxfield.js";
import type { ProcessingProfile } from "./processingProfileManager.js";
import { ui } from "../ui/theme.js";
import chalk from "chalk";
import { downloadScryfallImage, findScryfallCard, type ScryfallCard } from "./scryfall.js";
import path from "node:path";
import { upscaleImage } from "./upscaylManager.js";
import { exists } from "../utils/fs.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { postProcessImage } from "./postProcessing.js";
import { createMpcAutofillOrder } from "./mpcManager.js";
import sharp from "sharp";

interface Context {
    decks: {
        [url: string]: {
            config: DeckConfig,
            moxfield: MoxfieldDeck,
            cards: MoxfieldCard[]
        }
    },
    cards: {
        [moxfieldId: string]: {
            scryfallCard: ScryfallCard,
            moxfieldCard: MoxfieldCard
        }
    },
    queues: Queues,
    stats: {
        total: number,
        downloaded: number,
        upscaled: number,
        postProcessed: number,
        converted: number
    },
    missingCards: Record<string, string>
}

export interface Queues {
    [ProcessingState.NotDownloaded]: Queue,
    [ProcessingState.Downloaded]: Queue,
    [ProcessingState.Upscaled]: Queue,
    [ProcessingState.PostProcessed]: Queue,
    [ProcessingState.Converted]: Queue
}

interface Queue {
    cards: CardQueueItem[],
    done: boolean
}

export interface CardQueueItem {
    id: string,
    face: 'front' | 'back',
    scryfallUrl: string,
    path: string,
    state: ProcessingState
}

export async function processOrder(order: Order) {
    console.clear();
    console.log(ui.title(`Processing Order: ${order.name}`));
    console.log('Downloading and post-processing your card images before upscaling and creating the final XML file for MPC Autofill.\n');

    const processingProfile = order.profile;

    const mainDir = path.join(processingProfile.outputDirectory, order.name);
    const cardsDir = path.join(mainDir, `cards`);
    if (!await exists(cardsDir)) {
        await mkdir(cardsDir, { recursive: true });
    }

    const context: Context = {
        decks: {},
        cards: {},
        queues: {
            [ProcessingState.NotDownloaded]: {
                cards: [],
                done: false
            },
            [ProcessingState.Downloaded]: {
                cards: [],
                done: false
            },
            [ProcessingState.Upscaled]: {
                cards: [],
                done: false
            },
            [ProcessingState.PostProcessed]: {
                cards: [],
                done: false
            },
            [ProcessingState.Converted]: {
                cards: [],
                done: false
            },
        },
        stats: {
            total: 0,
            downloaded: 0,
            upscaled: 0,
            postProcessed: 0,
            converted: 0
        },
        missingCards: {}
    };

    try {
        const tasks = new Listr([
            {
                title: `Loading Moxfield deck details`,
                task: async (ctx: Context, task) => {
                    const subTasks = order.decks.map((deck) => {
                        return {
                            title: `Loading details for ${chalk.green(deck.url)}`,
                            task: async () => {
                                const details = await getMoxfieldDetails(deck, processingProfile.playwrightChannel);
                                ctx.decks[deck.url] = {
                                    config: deck,
                                    moxfield: details,
                                    cards: []
                                };
                            }
                        }
                    });

                    return task.newListr(subTasks, { concurrent: true });
                }
            },
            {
                title: 'Collecting card details',
                task: async (ctx, task) => {
                    const subTasks = Object.values(ctx.decks).map(deck => {
                        return {
                            title: `Collecting ${chalk.green(deck.moxfield.name)} card details`,
                            task: async (_, subtask) => {
                                const boardsToInclude = ['commanders', 'companions', ...deck.config.data, 'signatureSpells'];
                                const cards = boardsToInclude.map(board => (deck.moxfield.boards as any)[board]).flatMap((board: MoxfieldBoard) => Object.values(board.cards));

                                if (deck.config.data.includes(DeckData.Tokens)) {
                                    deck.moxfield.tokens.filter(token => token.isToken).forEach(token => {
                                        cards.push({
                                            quantity: 1,
                                            card: token
                                        });
                                    });
                                }

                                deck.cards = cards;

                                subtask.title = `Collecting ${chalk.green(deck.moxfield.name)} card details (0/${cards.length})`;

                                for (let i = 0; i < cards.length; i++) {
                                    subtask.title = `Collecting ${chalk.green(deck.moxfield.name)} card details (${i + 1}/${cards.length})`;

                                    const card = cards[i]!;
                                    if (Object.keys(ctx.cards).includes(card.card.id)) continue;

                                    const scryfallCard = await findScryfallCard(card.card);
                                    if (!scryfallCard) {
                                        ctx.missingCards[card.card.id] = card.card.name;
                                        continue;
                                    }

                                    ctx.cards[card.card.id] = {
                                        scryfallCard: scryfallCard,
                                        moxfieldCard: card
                                    };
                                }
                            }
                        } as ListrTask
                    })

                    return task.newListr(subTasks, { concurrent: false });
                }
            },
            {
                title: 'Processing order images',
                task: async (ctx, task) => {
                    for (const key of Object.keys(ctx.cards)) {
                        const card = ctx.cards[key]!;

                        if (!card.scryfallCard) {
                            console.log(JSON.stringify(card.scryfallCard, null, 2));
                            return;
                        }

                        const frontImage = card.scryfallCard.image_uris?.png || card.scryfallCard.card_faces?.at(0)?.image_uris?.png;
                        if (!frontImage) {
                            console.log(chalk.red(`Front image URL not found: ${card.scryfallCard.name}`));
                            return;
                        }

                        const frontImagePath = `${card.scryfallCard.id}-front.png`
                        if (!frontImagePath) {
                            console.log(chalk.red(`Front image not downloaded: ${card.scryfallCard.name}`));
                            return;
                        }

                        ctx.queues[ProcessingState.NotDownloaded]!.cards.push({
                            id: key,
                            face: 'front',
                            scryfallUrl: frontImage,
                            path: frontImagePath,
                            state: ProcessingState.NotDownloaded
                        });

                        const backImage = card.scryfallCard.card_faces?.find(face => !!face.image_uris && face.image_uris.png.includes('/back/'))?.image_uris?.png;
                        if (backImage) {
                            const backImagePath = `${card.scryfallCard.id}-back.png`;
                            ctx.queues[ProcessingState.NotDownloaded]!.cards.push({
                                id: key,
                                face: 'back',
                                scryfallUrl: backImage,
                                path: backImagePath,
                                state: ProcessingState.NotDownloaded
                            });
                        }
                    }

                    // Restore state.
                    order.states.forEach(item => {
                        if (item.state === ProcessingState.NotDownloaded) return;
                        ctx.queues[item.state]!.cards.push(item);
                    });

                    // Remove items from NotDownloaded queue that are already moved to another queue.
                    ctx.queues[ProcessingState.NotDownloaded]!.cards = ctx.queues[ProcessingState.NotDownloaded]!.cards.filter(x => !Object.values(order.states).map(it => it.id).includes(x.id));

                    ctx.stats = {
                        total: ctx.queues[ProcessingState.NotDownloaded]!.cards.length,
                        downloaded: 0,
                        upscaled: 0,
                        postProcessed: 0,
                        converted: 0,
                    };

                    const subTasks: ListrTask[] = [
                        {
                            title: 'Downloading card images',
                            task: async (_, subtask) => {
                                const queue = ctx.queues[ProcessingState.NotDownloaded]!;
                                const nextQueue = ctx.queues[ProcessingState.Downloaded]!;

                                while (queue.cards.length > 0) {
                                    subtask.title = `Downloading card images (${ctx.stats.downloaded + 1}/${ctx.stats.total})`;

                                    const card = queue.cards.shift()!;
                                    await downloadScryfallImage(card.scryfallUrl, path.join(cardsDir, card.path));

                                    ctx.stats.downloaded++;
                                    card.state = ProcessingState.Downloaded;
                                    nextQueue.cards.push(card);
                                }

                                queue.done = true;
                            }
                        },
                        {
                            title: 'Post-processing card images',
                            task: async (_, subtask) => {
                                const previousQueue = ctx.queues[ProcessingState.NotDownloaded]!;
                                const queue = ctx.queues[ProcessingState.Downloaded]!;
                                const nextQueue = ctx.queues[ProcessingState.PostProcessed]!;

                                while (!previousQueue.done || queue.cards.length > 0) {
                                    while (queue.cards.length === 0) {
                                        await delay(100);
                                    }

                                    subtask.title = `Post-processing card images (${ctx.stats.postProcessed + 1}/${ctx.stats.total})`;

                                    const item = queue.cards.shift()!;
                                    const card = ctx.cards[item.id]!;
                                    await postProcessImage(path.join(cardsDir, item.path), card, item.face, processingProfile.postProcessing);

                                    ctx.stats.postProcessed++;
                                    item.state = ProcessingState.PostProcessed;
                                    nextQueue.cards.push(item);
                                }

                                queue.done = true;
                            }
                        },
                        {
                            title: 'Upscaling card images',
                            task: async (_, subtask) => {
                                if (!processingProfile.postProcessing.upscaling.enabled) {
                                    subtask.title = `Upscaling card images (skipped)`;
                                    return;
                                }

                                const previousQueue = ctx.queues[ProcessingState.Downloaded]!;
                                const queue = ctx.queues[ProcessingState.PostProcessed]!;
                                const nextQueue = ctx.queues[ProcessingState.Upscaled]!;

                                while (!previousQueue.done || queue.cards.length > 0) {
                                    while (queue.cards.length === 0) {
                                        await delay(100);
                                    }

                                    subtask.title = `Upscaling card images (${ctx.stats.upscaled + 1}/${ctx.stats.total})`;

                                    const card = queue.cards.shift()!;
                                    await upscaleImage(path.join(cardsDir, card.path), processingProfile.postProcessing);

                                    ctx.stats.upscaled++;
                                    card.state = ProcessingState.Upscaled;
                                    nextQueue.cards.push(card);
                                }

                                queue.done = true;
                            }
                        },
                        {
                            title: 'Converting card images to JPEG',
                            task: async (_, subtask) => {
                                const previousQueue = ctx.queues[ProcessingState.PostProcessed]!;
                                const queue = ctx.queues[ProcessingState.Upscaled]!;
                                const nextQueue = ctx.queues[ProcessingState.Converted]!;

                                while (!previousQueue.done || queue.cards.length > 0) {
                                    while (queue.cards.length === 0) {
                                        await delay(100);
                                    }

                                    subtask.title = `Converting card images to JPEG (${ctx.stats.converted + 1}/${ctx.stats.total})`;

                                    const card = queue.cards.shift()!;
                                    const jpegFileName = card.path.replace('.png', '.jpg');

                                    const pngPath = path.join(cardsDir, card.path);
                                    const jpegPath = path.join(cardsDir, jpegFileName);

                                    await sharp(pngPath).jpeg({ quality: 100 }).toFile(jpegPath);
                                    await unlink(pngPath);
                                    card.path = jpegFileName;

                                    ctx.stats.converted++;
                                    card.state = ProcessingState.Converted;
                                    nextQueue.cards.push(card);
                                }

                                queue.done = true;
                            }
                        }
                    ];

                    return task.newListr(subTasks, { concurrent: true });
                }
            },
            {
                title: 'Creating MPC Autofill XML',
                task: async (ctx) => {
                    const cardsToOrder = Object.values(ctx.decks).map(x => x.cards).reduce((acc, val) => [...acc, ...val], []);
                    const processedItems = Object.values(ctx.queues).map(x => x.cards).reduce((acc, val) => [...acc, ...val], []);
                    const xml = createMpcAutofillOrder(order, processedItems, cardsToOrder);
                    await writeFile(path.join(mainDir, 'cards.xml'), xml);
                }
            }
        ]);

        try {
            await tasks.run(context);
            console.log('\n' + ui.information(`You can find your order at ${mainDir}`) + '\n');
        } catch (err) {
            console.error('\n' + ui.error('An error occurred:'), err);
        }
    } catch (err) {
        console.error(ui.error('An error occurred while processing the order:'), err);
    }

    order.states = [];
    Object.values(context.queues).map((x: Queue) => x.cards).reduce((acc, val) => [...acc, ...val], []).forEach(item => {
        order.states.push(item);
    });

    await saveOrder(order);
}
