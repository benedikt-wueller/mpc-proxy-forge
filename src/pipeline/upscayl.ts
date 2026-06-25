import fs, { rename } from "node:fs/promises";
import path from "node:path";
import { exists, grantExecutionPermission } from "../utils/fs.js";
import type { PostProcessingProfile } from "../config/processingProfileManager.js";
import { exec } from "node:child_process";
import sharp from 'sharp';
import { downloadGitHubDirectory, downloadLatestRelease } from "./githubDownloader.js";

export async function upscaleImage(filePath: string, config: PostProcessingProfile) {
    if (!config.upscaling.enabled) return;

    const upscaylBinary = path.join(config.upscaling.binaryFile!);

    const temporaryPath = filePath.replace('.png', '-temp.png');

    const imageMetadata = await sharp(filePath).metadata();
    const width = imageMetadata.width;
    const targetWidth = Math.round(config.cardWidth * config.dpi);

    let scale = Math.ceil(targetWidth / width);
    if (scale < 1) scale = 1;
    if (scale > 4) scale = 4;

    await new Promise((resolve, reject) => {
        exec(`${upscaylBinary} -i "${filePath}" -o "${temporaryPath}" -n ${config.upscaling.model} -s ${scale}`, (err) => {
            if (err) {
                console.error(err);
                reject(err);
                return;
            }

            resolve(undefined);
        })
    });

    await rename(temporaryPath, filePath);
}

export async function downloadUpscaylBinary(targetPath: string) {
    if (await exists(targetPath)) return;

    const tempDir = await fs.mkdtemp('upscayl-')
    await downloadLatestRelease('upscayl', 'upscayl-ncnn', tempDir);

    const targetDir = path.dirname(targetPath);
    if (!await exists(targetDir)) {
        await fs.mkdir(targetDir, { recursive: true });
    }

    const contents = await fs.readdir(tempDir);

    const upscaylDirectory = contents[0]!;
    const binaryName = process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    const binaryPath = path.join(tempDir, upscaylDirectory, binaryName);

    await fs.rename(binaryPath, targetPath);
    await grantExecutionPermission(targetPath);

    await fs.rm(tempDir, { recursive: true, force: true });
}

export async function downloadUpscaylModels(targetPath: string) {
    if (!await exists(targetPath)) {
        await fs.mkdir(targetPath, { recursive: true });
    }

    await downloadGitHubDirectory('upscayl', 'upscayl', 'resources/models', targetPath);
}

export async function getUpscaylModels(path: string) {
    const files = await fs.readdir(path);
    const models = files.filter(file => file.endsWith('.param')).map(file => file.replace('.param', ''));
    models.sort();
    return models;
}
