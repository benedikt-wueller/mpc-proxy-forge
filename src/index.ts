import { runMainMenu } from './menus/mainMenu.js';
import chalk from "chalk";

async function bootstrap() {
    await runMainMenu();
}

bootstrap().catch((err) => {
    console.error('\n' + chalk.red('A critical runtime error occurred:'), err);
    process.exit(1);
});