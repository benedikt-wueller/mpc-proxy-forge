import inquirer from "inquirer";
import { ui } from "../ui/theme.js";

export async function confirmDialog(message: string, defaultValue: boolean = false): Promise<boolean> {
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message,
            default: defaultValue
        }
    ]);

    return answer.confirm;
}

export function getSeparator(title?: string) {
    if (title) {
        const leftPad = '─'.repeat(Math.floor((28 - title.length) / 2));
        const rightPad = '─'.repeat(Math.ceil((28 - title.length) / 2));
        return new inquirer.Separator(ui.subtle(` ${leftPad} ${title} ${rightPad}`));
    }

    return new inquirer.Separator(ui.subtle(` ──────────────────────────────`));
}
