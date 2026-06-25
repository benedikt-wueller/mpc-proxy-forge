import chalk from 'chalk';

export const ui = {
    // Layout elements
    title: (text: string) => chalk.bold.cyanBright(`\n${text}`),
    subtitle: (text: string) => chalk.bold(`\n${text}`),

    // Status indicators
    information: (text: string) => chalk.blue(`ℹ ${text}`),
    success: (text: string) => chalk.green(`✔ ${text}`),
    attention: (text: string) => chalk.yellow(`⚠ ${text}`),
    error: (text: string) => chalk.red(`✖ ${text}`),

    secondary: (text: string) => chalk.yellow(text),
    subtle: (text: string) => chalk.dim(text),

    // Accents for specific highlights
    highlight: (text: string) => chalk.magenta(text)
};