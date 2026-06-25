import type { MoxfieldCardDetails } from "./moxfield.js";
import chalk from "chalk";
import Bottleneck from "bottleneck";
import { exists } from "../utils/fs.js";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";

export type ScryfallCard = {
    id: string,
    name: string,
    set: string,
    collector_number: string
    lang: string,
    image_uris?: ScryfallImageUris,
    card_faces?: ScryfallCardFace[],
    full_art: boolean,
    frame: string,
    security_stamp: string,
    promo_types?: string[],
    type_line: string,
    layout: string,
};

export type ScryfallCardFace = {
    name: string,
    type_line: string,
    image_uris?: ScryfallImageUris
};

export type ScryfallImageUris = {
    small: string,
    normal: string,
    large: string,
    png: string,
    art_crop: string,
    border_crop: string
};

const scryfallBottleneck = new Bottleneck({
    maxConcurrent: 5,
    minTime: 200
});

const scryfallImageBottleneck = new Bottleneck({
    maxConcurrent: 10,
    minTime: 100
})

export async function findScryfallCard(card: MoxfieldCardDetails) {
    let headers = new Headers({
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "MoxfieldMPCAutofillConverter/1.0"
    });

    let response = await scryfallBottleneck.schedule(() => fetch(`https://api.scryfall.com/cards/${card.scryfall_id}`, { headers }));

    if (response.status === 404) {
        response = await scryfallBottleneck.schedule(() => fetch(`https://scryfall.com/docs/api/cards/named?exact=${card.name}&set=${card.set}`, { headers }));
        if (response.status === 404) return;
    }

    if (response.status !== 200) {
        console.log(chalk.red(`Error retrieving scryfall card: ${response.status}; ${JSON.stringify(response.json())}`));
        return;
    }

    return await response.json() as ScryfallCard;
}

export async function downloadScryfallImage(url: string, path: string): Promise<string | undefined> {
    // Don't download the same image multiple times.
    if (await exists(path)) return Promise.resolve(path);

    const resp = await scryfallImageBottleneck.schedule(() => fetch(url));
    if (resp.ok && resp.body) {
        const writer = createWriteStream(path)
        Readable.fromWeb(resp.body as any).pipe(writer);

        return await new Promise((resolve) => {
            writer.on("finish", () => {
                writer.close();
                resolve(path);
            });
        });
    }

    console.log(chalk.red(`Error downloading image: ${resp.status}; ${JSON.stringify(resp.body)}`));
    return Promise.resolve(undefined);
}