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

export async function grantExecutionPermission(binaryPath: string) {
    if (os.platform() !== 'win32') {
        await fs.promises.chmod(binaryPath, 0o700);
    }
}
