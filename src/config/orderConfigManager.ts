import fs from 'node:fs/promises';
import path from 'node:path';
import { exists } from "../utils/fs.js";
import { type CARD_STOCKS, DEFAULT_CARD_STOCK } from "../output/mpcAutofill.js";
import type { CardQueueItem } from "../pipeline/types.js";
import { type ProcessingProfile, DefaultProfile } from "./processingProfileManager.js";

export interface Order {
    name: string;
    profile: ProcessingProfile;
    cardStock: (typeof CARD_STOCKS)[number],
    foil: boolean,
    decks: DeckConfig[];
    cardBack: string;
    states: CardQueueItem[];
}

export interface DeckConfig {
    url: string;
    data: DeckData[];
}

export enum DeckData {
    MainBoard = "mainboard",
    SideBoard = "sideboard",
    Tokens = "tokens",
    Considering = "maybeboard",
    Attractions = "attractions",
    Contraptions = "contraptions",
    Stickers = "stickers",
    Planes = "planes",
    Schemes = "schemes"
}


const ORDER_CONFIG_PATHS = path.join(process.cwd(), 'config', 'orders');

export const DefaultOrder: Order = {
    name: 'unnamed',
    profile: DefaultProfile,
    cardStock: DEFAULT_CARD_STOCK,
    foil: false,
    cardBack: '1LrVX0pUcye9n_0RtaDNVl2xPrQgn7CYf',
    decks: [],
    states: []
};

export async function loadOrders(): Promise<Order[]> {
    const dirExists = await exists(ORDER_CONFIG_PATHS);
    if (!dirExists) return [];

    const files = await fs.readdir(ORDER_CONFIG_PATHS);
    const configs: Order[] = [];

    for (const file of files) {
        const filePath = path.join(ORDER_CONFIG_PATHS, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const config = JSON.parse(data);
        configs.push({ ...DefaultOrder, ...config });
    }

    return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveOrder(config: Order): Promise<void> {
    const filePath = path.join(ORDER_CONFIG_PATHS, `${config.name}.json`);

    const dirExists = await exists(ORDER_CONFIG_PATHS);
    if (!dirExists) {
        await fs.mkdir(ORDER_CONFIG_PATHS, { recursive: true });
    }

    const data = JSON.stringify(config, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
}

export async function deleteOrder(config: Order): Promise<void> {
    const filePath = path.join(ORDER_CONFIG_PATHS, `${config.name}.json`);
    await fs.unlink(filePath);
}
