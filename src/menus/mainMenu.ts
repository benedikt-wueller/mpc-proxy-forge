import inquirer from "inquirer";
import { runProfileMenu } from "./profileMenu.js";
import { ui } from "../ui/theme.js";
import { loadProcessingProfiles } from "../core/processingProfileManager.js";
import { runOrderMenu } from "./orderMenu.js";
import { teen } from "gradient-string";

export async function runMainMenu(): Promise<void> {
    try {
        console.clear();
        console.log(ui.title('Welcome to ' + teen('MPC Proxy Forge') + '!'));
        console.log('This tool is designed to help convert your Moxfield decks into MPC Autofill-ready formats using and post-processing original print scans.\n');

        const profiles = await loadProcessingProfiles();

        const result = await inquirer.prompt([{
            type: 'select',
            name: 'choice',
            message: 'What would you like to do?',
            choices: [
                { name: 'Manage Processing Profiles', value: 'profile' },
                { name: 'Prepare Decks for Printing', value: 'print', disabled: profiles.length === 0 },
                { name: 'Exit', value: 'exit' }
            ],
            default: 'profile'
        }]);

        if (result.choice === 'profile') {
            await runProfileMenu();
            return runMainMenu();
        }

        if (result.choice === 'print') {
            await runOrderMenu();
            return runMainMenu();
        }
    } catch (error) {
        console.log(ui.attention('Operation cancelled.'));
    }

    process.exit(0);
}