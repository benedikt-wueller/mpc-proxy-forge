import fs from "node:fs/promises";
import AdmZip from 'adm-zip';
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

export async function downloadLatestRelease(owner: string, repo: string, outputDir: string) {
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

export async function downloadGitHubDirectory(owner: string, repo: string, dirPath: string, outputDir: string, branch: string = 'main') {
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
