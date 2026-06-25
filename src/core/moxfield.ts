import type { DeckConfig } from "./orderConfigManager.js";
import { PlaywrightChannel } from "./processingProfileManager.js";
import { type Browser, chromium, firefox, webkit } from "playwright";
import Bottleneck from "bottleneck";

export type MoxfieldDeck = {
    name: string,
    publicId: string,
    boards: {
        mainboard: MoxfieldBoard,
        sideboard: MoxfieldBoard,
        maybeboard: MoxfieldBoard,
        commanders: MoxfieldBoard,
        companions: MoxfieldBoard,
        signatureSpells: MoxfieldBoard,
        attractions: MoxfieldBoard,
        stickers: MoxfieldBoard,
        contraptions: MoxfieldBoard,
        planes: MoxfieldBoard,
        schemes: MoxfieldBoard,
        tokens: MoxfieldBoard
    },
    tokens: MoxfieldCardDetails[]
}

export type MoxfieldBoard = {
    count: number,
    cards: Record<string, MoxfieldCard>
}

export type MoxfieldCard = {
    quantity: number,
    card: MoxfieldCardDetails
}

export type MoxfieldCardDetails = {
    id: string,
    name: string,
    set: string,
    cn: string,
    scryfall_id: string,
    isToken: boolean,
    type_line: string,
    card_faces: MoxfieldCardFace[]
};

export type MoxfieldCardFace = {
    type_line: string
};

const moxfieldBottleneck = new Bottleneck({
    maxConcurrent: 1,
    minTime: 1000
});

export async function getMoxfieldDetails(deck: DeckConfig, channel: PlaywrightChannel) {
    return await moxfieldBottleneck.schedule(async () => {
        const deckId = new URL(deck.url).pathname.split('/decks/')[1];
        let browser: Browser | undefined;

        try {
            switch (channel) {
                case PlaywrightChannel.Firefox:
                    browser = await firefox.launch({ headless: false });
                    break;
                case PlaywrightChannel.WebKit:
                    browser = await webkit.launch({ headless: false });
                    break;
                case PlaywrightChannel.Chrome:
                case PlaywrightChannel.MicrosoftEdge:
                    browser = await chromium.launch({
                        channel,
                        headless: false
                    });
                    break;
                default:
                    browser = await chromium.launch({ headless: false });
            }

            const page = await browser.newPage();

            const responsePromise = page.waitForResponse(response =>
                response.url().includes(`https://api2.moxfield.com/v3/decks/all/${deckId}`) &&
                response.status() === 200
            );

            await page.goto(deck.url);

            const response = await responsePromise;
            const data = await response.json();

            await browser.close();

            return data as MoxfieldDeck;
        } catch (err) {
            if (browser) await browser.close();
            throw err;
        }
    });
}