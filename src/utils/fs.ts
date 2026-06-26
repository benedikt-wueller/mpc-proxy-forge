import * as fs from "fs";
import * as os from "node:os";

export async function exists(path: string) {
    try {
        await fs.promises.stat(path);
        return true;
    } catch {
        return false;
    }
}

export async function renameWithRetry(oldPath: string, newPath: string, retries = 10, delayMs = 100) {
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.promises.rename(oldPath, newPath);
            return;
        } catch (err: any) {
            const lockError = err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES');
            if (!lockError || attempt >= retries) throw err;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

export async function grantExecutionPermission(binaryPath: string) {
    if (os.platform() !== 'win32') {
        await fs.promises.chmod(binaryPath, 0o700);
    }
}
