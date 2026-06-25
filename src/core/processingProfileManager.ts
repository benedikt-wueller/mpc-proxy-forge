import fs from 'node:fs/promises';
import path from 'node:path';
import { exists } from "../utils/fs.js";

export interface ProcessingProfile {
    name: string;
    outputDirectory: string;
    playwrightChannel: PlaywrightChannel,
    postProcessing: PostProcessingProfile
}

export interface PostProcessingProfile {
    dpi: number,
    cardWidth: number,
    cornerRadius: number,
    bleedWidth: number,
    borderCrop: number,
    upscaling: UpscaylSettings,
    copyrightBehavior: 'keep' | 'blur' | 'proxy',
    blurStrength: number
}

export interface UpscaylSettings {
    enabled: boolean,
    binaryFile?: string,
    modelsDirectory?: string,
    model: string
}

export enum PlaywrightChannel {
    Chrome = "chrome",
    Firefox = "firefox",
    WebKit = "webkit",
    MicrosoftEdge = "msedge"
}

export const DefaultProfile: ProcessingProfile = {
    name: 'default',
    outputDirectory: './decks',
    playwrightChannel: PlaywrightChannel.Chrome,
    postProcessing: {
        dpi: 800,
        cardWidth: 2.48,
        cornerRadius: 0.06,
        bleedWidth: 0.12,
        borderCrop: 0.005,
        upscaling: {
            enabled: true,
            model: 'upscayl-standard-4x'
        },
        copyrightBehavior: 'proxy',
        blurStrength: 10,
    }
};

const PROCESSING_PROFILE_PATH = path.join(process.cwd(), 'config', 'profiles');

export async function loadProcessingProfiles(): Promise<ProcessingProfile[]> {
    const dirExists = await exists(PROCESSING_PROFILE_PATH);
    if (!dirExists) return [];

    const files = await fs.readdir(PROCESSING_PROFILE_PATH);
    const configs: ProcessingProfile[] = [];

    for (const file of files) {
        const filePath = path.join(PROCESSING_PROFILE_PATH, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const config = JSON.parse(data);
        configs.push({ ...DefaultProfile, ...config });
    }

    return configs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProcessingProfile(config: ProcessingProfile): Promise<void> {
    const filePath = path.join(PROCESSING_PROFILE_PATH, `${config.name}.json`);

    const dirExists = await exists(PROCESSING_PROFILE_PATH);
    if (!dirExists) {
        await fs.mkdir(PROCESSING_PROFILE_PATH, { recursive: true });
    }

    const data = JSON.stringify(config, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
}

export async function deleteProcessingProfile(config: ProcessingProfile): Promise<void> {
    const filePath = path.join(PROCESSING_PROFILE_PATH, `${config.name}.json`);
    await fs.unlink(filePath);
}
