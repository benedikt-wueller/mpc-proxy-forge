import fs, { rename, unlink } from "node:fs/promises";
import AdmZip from 'adm-zip';
import path, { dirname } from "node:path";
import { exists, grantExecutionPermission } from "../utils/fs.js";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import type { PostProcessingProfile } from "./processingProfileManager.js";
import { exec } from "node:child_process";
import sharp from 'sharp';

export const UPSCAYL_RECOMMENDED_MODELS = {
    'upscayl-standard-4x': 'recommended all-purpose',
    'upscayl-lite-4x': 'recommended for speed',
    'high-fidelity-4x': 'recommended for fine details',
} as const;

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

async function downloadLatestRelease(owner: string, repo: string, outputDir: string) {
    const platformMap: Record<string, string> = {
        win32: 'windows',
        darwin: 'macos',
        linux: 'linux'
    };

    const keyword = platformMap[process.platform];
    if (!keyword) {
        throw new Error(`Unsupported OS platform: ${process.platform}`);
    }

    const apiResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'node-cli-downloader' }
    });

    if (!apiResponse.ok) {
        throw new Error(`GitHub API error: ${apiResponse.statusText}`);
    }

    const releaseData: any = await apiResponse.json();

    const asset = releaseData.assets.find((a: any) =>
        a.name.toLowerCase().includes(keyword) && a.name.endsWith('.zip')
    );

    if (!asset) {
        throw new Error(`No .zip asset found matching keyword "${keyword}"`);
    }

    const fileResponse = await fetch(asset.browser_download_url);
    if (!fileResponse.ok) {
        throw new Error(`Failed to download asset: ${fileResponse.statusText}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.mkdir(outputDir, { recursive: true });

    const zip = new AdmZip(buffer);
    zip.extractAllTo(outputDir, true);
}

async function downloadGitHubDirectory(owner: string, repo: string, dirPath: string, outputDir: string, branch: string = 'main') {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`;

    const apiResponse = await fetch(apiUrl, {
        headers: { 'User-Agent': 'node-cli-downloader' }
    });

    if (!apiResponse.ok) {
        throw new Error(`GitHub API error: ${apiResponse.statusText}`);
    }

    const items: any = await apiResponse.json();

    await fs.mkdir(outputDir, { recursive: true });

    for (const item of items) {
        if (item.type === 'file') {
            const fileResponse = await fetch(item.download_url);
            if (!fileResponse.ok) {
                console.error(`Failed to download ${item.name}`);
                continue;
            }

            const destPath = path.join(outputDir, item.name);
            const destStream = createWriteStream(destPath);

            await pipeline(fileResponse.body as any, destStream);
        } else if (item.type === 'dir') {
            const subOutputDir = path.join(outputDir, item.name);
            await downloadGitHubDirectory(owner, repo, item.path, subOutputDir, branch);
        }
    }
}
