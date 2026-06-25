import { type DeckConfig, DeckData, type Order, saveOrder } from "../config/orderConfigManager.js";
import { type CardQueueItem, ProcessingState, type Queue, type Queues } from "./types.js";
import { delay, Listr, type ListrTask } from "listr2";
import { getMoxfieldDetails, type MoxfieldBoard, type MoxfieldCard, type MoxfieldDeck } from "../clients/moxfield.js";
import type { ProcessingProfile } from "../config/processingProfileManager.js";
import { ui } from "../ui/theme.js";
import chalk from "chalk";
import { downloadScryfallImage, findScryfallCard, type ScryfallCard } from "../clients/scryfall.js";
import path from "node:path";
import { upscaleImage } from "./upscayl.js";
import { exists } from "../utils/fs.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { postProcessImage } from "./postProcessing.js";
import { createMpcAutofillOrder } from "../output/mpcAutofill.js";
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

    const context = createContext();

    try {
        const tasks = new Listr([
            loadDeckDetails(order, processingProfile),
            collectCardDetails(),
            runImagePipeline(order, cardsDir, processingProfile),
            writeMpcXml(order, mainDir)
        ]);

        await tasks.run(context);
        console.log('\n' + ui.information(`You can find your order at ${mainDir}`) + '\n');
    } catch (err) {
        console.error('\n' + ui.error('An error occurred:'), err);
    }

    order.states = [];
    Object.values(context.queues).map((x: Queue) => x.cards).reduce((acc, val) => [...acc, ...val], []).forEach(item => {
        order.states.push(item);
    });

    await saveOrder(order);
}

function createContext(): Context {
    return {
        decks: {},
        cards: {},
        queues: {
            [ProcessingState.NotDownloaded]: { cards: [], done: false },
            [ProcessingState.Downloaded]: { cards: [], done: false },
            [ProcessingState.Upscaled]: { cards: [], done: false },
            [ProcessingState.PostProcessed]: { cards: [], done: false },
            [ProcessingState.Converted]: { cards: [], done: false },
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
}

function loadDeckDetails(order: Order, profile: ProcessingProfile): ListrTask {
    return {
        title: `Loading Moxfield deck details`,
        task: async (ctx: Context, task) => {
            const subTasks = order.decks.map((deck) => {
                return {
                    title: `Loading details for ${chalk.green(deck.url)}`,
                    task: async () => {
                        const details = await getMoxfieldDetails(deck, profile.playwrightChannel);
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
    };
}

function collectCardDetails(): ListrTask {
    return {
        title: 'Collecting card details',
        task: async (ctx: Context, task) => {
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
    };
}

function runImagePipeline(order: Order, cardsDir: string, profile: ProcessingProfile): ListrTask {
    return {
        title: 'Processing order images',
        task: async (ctx: Context, task) => {
            enqueueCards(ctx, order);
            return task.newListr(createPipelineTasks(cardsDir, profile), { concurrent: true });
        }
    };
}

function enqueueCards(ctx: Context, order: Order) {
    for (const key of Object.keys(ctx.cards)) {
        const card = ctx.cards[key]!;

        const frontImage = card.scryfallCard.image_uris?.png || card.scryfallCard.card_faces?.at(0)?.image_uris?.png;
        if (!frontImage) {
            console.log(chalk.red(`Front image URL not found: ${card.scryfallCard.name}`));
            return;
        }

        ctx.queues[ProcessingState.NotDownloaded].cards.push({
            id: key,
            face: 'front',
            scryfallUrl: frontImage,
            path: `${card.scryfallCard.id}-front.png`,
            state: ProcessingState.NotDownloaded
        });

        const backImage = card.scryfallCard.card_faces?.find(face => !!face.image_uris && face.image_uris.png.includes('/back/'))?.image_uris?.png;
        if (backImage) {
            ctx.queues[ProcessingState.NotDownloaded].cards.push({
                id: key,
                face: 'back',
                scryfallUrl: backImage,
                path: `${card.scryfallCard.id}-back.png`,
                state: ProcessingState.NotDownloaded
            });
        }
    }

    order.states.forEach(item => {
        if (item.state === ProcessingState.NotDownloaded) return;
        ctx.queues[item.state].cards.push(item);
    });

    const restoredIds = order.states.map(it => it.id);
    ctx.queues[ProcessingState.NotDownloaded].cards = ctx.queues[ProcessingState.NotDownloaded].cards.filter(x => !restoredIds.includes(x.id));

    ctx.stats = {
        total: ctx.queues[ProcessingState.NotDownloaded].cards.length,
        downloaded: 0,
        upscaled: 0,
        postProcessed: 0,
        converted: 0,
    };
}

function createPipelineTasks(cardsDir: string, profile: ProcessingProfile): ListrTask[] {
    return [
        pipelineStage({
            title: 'Downloading card images',
            queueState: ProcessingState.NotDownloaded,
            nextState: ProcessingState.Downloaded,
            statKey: 'downloaded',
            handler: async (_ctx, item) => {
                await downloadScryfallImage(item.scryfallUrl, path.join(cardsDir, item.path));
            }
        }),
        pipelineStage({
            title: 'Post-processing card images',
            previousState: ProcessingState.NotDownloaded,
            queueState: ProcessingState.Downloaded,
            nextState: ProcessingState.PostProcessed,
            statKey: 'postProcessed',
            handler: async (ctx, item) => {
                const card = ctx.cards[item.id]!;
                await postProcessImage(path.join(cardsDir, item.path), card, item.face, profile.postProcessing);
            }
        }),
        pipelineStage({
            title: 'Upscaling card images',
            previousState: ProcessingState.Downloaded,
            queueState: ProcessingState.PostProcessed,
            nextState: ProcessingState.Upscaled,
            statKey: 'upscaled',
            skip: !profile.postProcessing.upscaling.enabled,
            handler: async (_ctx, item) => {
                await upscaleImage(path.join(cardsDir, item.path), profile.postProcessing);
            }
        }),
        pipelineStage({
            title: 'Converting card images to JPEG',
            previousState: ProcessingState.PostProcessed,
            queueState: ProcessingState.Upscaled,
            nextState: ProcessingState.Converted,
            statKey: 'converted',
            handler: async (_ctx, item) => {
                const jpegFileName = toJpegName(item.path);
                const pngPath = path.join(cardsDir, item.path);
                const jpegPath = path.join(cardsDir, jpegFileName);

                await sharp(pngPath).jpeg({ quality: 100 }).toFile(jpegPath);
                await unlink(pngPath);
                item.path = jpegFileName;
            }
        })
    ];
}

interface PipelineStageOptions {
    title: string,
    previousState?: ProcessingState,
    queueState: ProcessingState,
    nextState: ProcessingState,
    statKey: 'downloaded' | 'upscaled' | 'postProcessed' | 'converted',
    handler: (ctx: Context, item: CardQueueItem) => Promise<void>,
    skip?: boolean
}

function pipelineStage(options: PipelineStageOptions): ListrTask {
    return {
        title: options.title,
        task: async (ctx: Context, subtask) => {
            if (options.skip) {
                subtask.title = `${options.title} (skipped)`;
                return;
            }

            const previousQueue = options.previousState ? ctx.queues[options.previousState] : undefined;
            const queue = ctx.queues[options.queueState];
            const nextQueue = ctx.queues[options.nextState];

            while ((previousQueue ? !previousQueue.done : false) || queue.cards.length > 0) {
                while (queue.cards.length === 0) {
                    await delay(100);
                }

                subtask.title = `${options.title} (${ctx.stats[options.statKey] + 1}/${ctx.stats.total})`;

                const item = queue.cards.shift()!;
                await options.handler(ctx, item);

                ctx.stats[options.statKey]++;
                item.state = options.nextState;
                nextQueue.cards.push(item);
            }

            queue.done = true;
        }
    };
}

function toJpegName(fileName: string) {
    return fileName.replace(/\.png$/i, '.jpg');
}

function writeMpcXml(order: Order, mainDir: string): ListrTask {
    return {
        title: 'Creating MPC Autofill XML',
        task: async (ctx: Context) => {
            const cardsToOrder = Object.values(ctx.decks).map(x => x.cards).reduce((acc, val) => [...acc, ...val], []);
            const processedItems = Object.values(ctx.queues).map(x => x.cards).reduce((acc, val) => [...acc, ...val], []);
            const xml = createMpcAutofillOrder(order, processedItems, cardsToOrder);
            await writeFile(path.join(mainDir, 'cards.xml'), xml);
        }
    };
}
