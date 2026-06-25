import inquirer from "inquirer";
import { ui } from "../ui/theme.js";
import {
    type ProcessingProfile,
    DefaultProfile,
    deleteProcessingProfile,
    loadProcessingProfiles,
    PlaywrightChannel,
    saveProcessingProfile, type UpscaylSettings
} from "../core/processingProfileManager.js";
import { confirmDialog, getSeparator } from "../utils/dialog.js";
import { downloadUpscaylBinary, downloadUpscaylModels, getUpscaylModels } from "../core/upscaylManager.js";
import * as os from "node:os";
import { Listr } from "listr2";

export async function runProfileMenu() {
    console.clear();
    console.log(ui.title('Processing Profile Management'));
    console.log('Create, update, or delete processing profiles that define your image quality and post-processing preferences.\n');

    await runSelectProfile('What would you like to do?', true, true, true, false);
}

export async function runSelectProfile(
    title: string = 'Select a processing profile:',
    offerCreate: boolean = true,
    offerUpdate: boolean = true,
    offerDelete: boolean = true,
    showProfiles: boolean = true
) {
    const profiles = await loadProcessingProfiles();

    const choices: unknown[] = showProfiles ? profiles.map(c => ({ name: c.name, value: c })) : [];

    if (choices.length > 0) {
        choices.push(getSeparator());
    }

    if (offerCreate) choices.push({ name: ui.secondary('Create a new processing profile'), value: 'create' });
    if (offerUpdate) choices.push({
        name: ui.secondary('Update a processing profile'),
        value: 'update',
        disabled: profiles.length === 0
    });
    if (offerDelete) choices.push({
        name: ui.secondary('Delete a processing profile'),
        value: 'delete',
        disabled: profiles.length === 0
    });

    choices.push({ name: ui.secondary('Cancel'), value: 'cancel' });

    const action = await inquirer.prompt([
        {
            type: 'select',
            name: 'choice',
            message: title,
            choices,
            loop: false
        }
    ]);

    if (action.choice === 'create') {
        console.clear();
        console.log(ui.title('Create Processing Profile'));
        console.log('Configure a new processing profile to customize how your card images are rendered and upscaled.\n');

        await runCreateProfile(profiles);

        console.clear();
        console.log();

        return await runSelectProfile(title, offerCreate, offerUpdate, offerDelete, showProfiles);
    } else if (action.choice === 'update') {
        console.clear();
        console.log(ui.title('Update Processing Profile'));
        console.log('Modify an existing profile to adjust your preferred browser, post-processing effects, or upscaling settings.\n');

        const profileToUpdate = await runSelectProfile('Select a processing profile to update:', false, false, false);

        if (profileToUpdate) {
            await runUpdateProfile(profileToUpdate);
        }

        console.clear();
        console.log();

        return await runSelectProfile(title, offerCreate, offerUpdate, offerDelete, showProfiles);
    } else if (action.choice === 'delete') {
        console.clear();
        console.log(ui.title('Delete Processing Profile'));
        console.log('Select a profile to permanently remove it from your saved configurations.\n');

        const profileToDelete = await runSelectProfile('Select a processing profile to delete:', false, false, false);

        if (profileToDelete) {
            if (await confirmDialog(`Delete processing profile "${profileToDelete.name}"?`)) {
                await deleteProcessingProfile(profileToDelete);
            }

            console.log();
        }

        console.clear();
        console.log();

        return await runSelectProfile(title, offerCreate, offerUpdate, offerDelete, showProfiles);
    } else if (action.choice === 'cancel') {
        return;
    }

    return action.choice as ProcessingProfile;
}

async function runCreateProfile(existingProfiles: ProcessingProfile[]) {
    let defaultProfile = DefaultProfile;

    if (existingProfiles.length > 0) {
        const copy = await confirmDialog('Would you like to copy an existing processing profile?', false);
        if (copy) {
            const existingProfile = await runSelectProfile('Select an existing processing profile to copy:', false, false, false);
            if (existingProfile) defaultProfile = existingProfile;
        }
    }

    const result = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Profile Name:',
            default: existingProfiles.some(c => c.name === defaultProfile.name) ? `${defaultProfile.name} copy` : defaultProfile.name,
            validate: (value) => existingProfiles.some(c => c.name === value) ? 'Profile name already exists' : true
        },
        {
            type: 'input',
            name: 'outputDirectory',
            message: 'Output Directory:',
            default: defaultProfile.outputDirectory
        }
    ]);

    const profile: ProcessingProfile = { ...defaultProfile, name: result.name, outputDirectory: result.outputDirectory };
    await runUpdateProfile(profile);

    return profile;
}

async function runUpdateProfile(profile: ProcessingProfile) {
    console.log(ui.subtitle('Browser Settings'));
    console.log('You will be asked to select a browser for this CLI to use. Please select any browser currently installed.');
    console.log('An instance of the selected browser will briefly be opened during deck processing to fetch the Moxfield deck details.\n');

    const channelSelect = await inquirer.prompt([
        {
            type: 'select',
            name: 'channel',
            message: 'Browser to use:',
            choices: [
                { name: 'Chrome', value: PlaywrightChannel.Chrome },
                { name: 'Microsoft Edge', value: PlaywrightChannel.MicrosoftEdge },
                { name: 'Firefox', value: PlaywrightChannel.Firefox },
                { name: 'WebKit', value: PlaywrightChannel.WebKit }
            ],
            default: profile.playwrightChannel
        }
    ]);

    profile.playwrightChannel = channelSelect.channel;

    console.log(ui.subtitle('Post-Processing'));
    console.log('These values will be used to help make images look better on the proxy.');
    console.log('If unsure, leave these values as-is.\n');

    const postProcessing = await inquirer.prompt([
        {
            type: 'number',
            name: 'dpi',
            message: 'Target DPI:',
            default: profile.postProcessing.dpi,
            validate: (value) => value && value > 0 ? true : 'DPI must be a non-negative number'
        },
        {
            type: 'input',
            name: 'cardWidth',
            message: 'Card width (inches):',
            default: profile.postProcessing.cardWidth,
            validate: (value) => validateNumberFromString(value, 'Card width', 0.1)
        },
        {
            type: 'input',
            name: 'bleedWidth',
            message: 'Bleed width (inches):',
            default: profile.postProcessing.bleedWidth,
            validate: (value) => validateNumberFromString(value, 'Bleed width', 0)
        },
        {
            type: 'input',
            name: 'cornerRadius',
            message: 'Corner radius (fraction):',
            default: profile.postProcessing.cornerRadius,
            validate: (value) => validateNumberFromString(value, 'Corner radius', 0, 1)
        },
        {
            type: 'input',
            name: 'borderCrop',
            message: 'Border crop (fraction):',
            default: profile.postProcessing.borderCrop,
            validate: (value) => validateNumberFromString(value, 'Border crop', 0, 0.5)
        }
    ]);

    profile.postProcessing = {
        ...profile.postProcessing,
        ...{
            dpi: postProcessing.dpi,
            cardWidth: parseFloat(postProcessing.cardWidth),
            bleedWidth: parseFloat(postProcessing.bleedWidth),
            cornerRadius: parseFloat(postProcessing.cornerRadius),
            borderCrop: parseFloat(postProcessing.borderCrop)
        }
    }

    profile.postProcessing.upscaling = await runUpscaylSettings(profile.postProcessing.upscaling);

    console.log(ui.subtitle('Copyright Behavior'));
    console.log('Magic cards contain a copyright notice that might cause issues with some print services.');
    console.log('Choose what to do with the copyright notice on the generated proxies. ' +
        'By default, the notice will be heavily blurred (to preserve background details) and a proxy notice will be added instead.\n');

    console.log(ui.information("Note: post-processing the copyright notice is done on a best-effort basis. Some cards might not be processed correctly.") + '\n');

    const copyrightChoices = await inquirer.prompt([
        {
            type: 'select',
            name: 'copyrightBehavior',
            message: 'Copyright behavior:',
            choices: [
                { name: 'Blur and add proxy notice', value: 'proxy' },
                { name: 'Blur only', value: 'blur' },
                { name: 'Keep copyright notice', value: 'keep' }
            ],
            default: profile.postProcessing.copyrightBehavior
        },
        {
            type: 'number',
            name: 'blurStrength',
            message: 'Blur strength:',
            default: profile.postProcessing.blurStrength
        }
    ]);

    profile.postProcessing.copyrightBehavior = copyrightChoices.copyrightBehavior;
    profile.postProcessing.blurStrength = copyrightChoices.blurStrength || profile.postProcessing.blurStrength;

    await saveProcessingProfile(profile);

    console.log(ui.success('Processing profile setup complete.') + '\n');
}

function validateNumberFromString(value: string, name: string, min?: number, max?: number) {
    const num = parseFloat(value);
    if (isNaN(num)) return `${name} must be a number`;
    if (min !== undefined && num < min) return `${name} must be at least ${min}`;
    if (max !== undefined && num > max) return `${name} must be at most ${max}`;
    return true;
}

async function runUpscaylSettings(settings: UpscaylSettings) {
    console.log(ui.subtitle('Upscayl Settings'));
    console.log('The default post-processing pipeline runs a local upscaler and denoiser to improve proxy image quality.');
    console.log('Upscayl is an open source cross-platform image upscaler and denoiser that runs locally on your machine.');
    console.log('In this section, you can, define the path to your local upscayl-ncnn cli or allow this tool to install it for you.');
    console.log('Repository: https://github.com/upscayl/upscayl-ncnn\n');

    const result = await inquirer.prompt([
        {
            type: 'select',
            name: 'choice',
            message: 'How would you like to configure Upscayl?',
            choices: [
                { name: 'Download to this directory', value: 'install' },
                { name: 'Find existing cli', value: 'local' },
                { name: 'Disable', value: 'disabled' }
            ],
            default: !!settings.binaryFile ? 'local' : (settings.enabled ? 'install' : 'disabled')
        }
    ]);

    if (result.choice === 'disabled') {
        settings.enabled = false;
        return settings;
    }

    const binaryFileName = os.platform() === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin';
    const paths = await inquirer.prompt([
        {
            type: 'input',
            name: 'binaryFile',
            message: 'Enter the path to the upscayl binary file:',
            default: settings.binaryFile || `./upscayl/${binaryFileName}`
        },
        {
            type: 'input',
            name: 'modelsDirectory',
            message: 'Enter the path to the upscayl models directory:',
            default: settings.modelsDirectory || './upscayl/models'
        }
    ]);

    settings.binaryFile = paths.binaryFile;
    settings.modelsDirectory = paths.modelsDirectory;

    if (result.choice === 'install') {
        const tasks = new Listr([
            {
                title: 'Downloading Upscayl Binary',
                task: async () => {
                    await downloadUpscaylBinary(paths.binaryFile);
                }
            },
            {
                title: 'Downloading Upscayl Models',
                task: async () => {
                    await downloadUpscaylModels(paths.modelsDirectory);
                }
            }
        ], { concurrent: true })

        await tasks.run();
    }

    const models = await getUpscaylModels(paths.modelsDirectory);
    if (models.length === 0) throw new Error('No models found in the specified models directory.')

    const model = await inquirer.prompt([
        {
            type: 'select',
            name: 'model',
            message: 'Select a model:',
            choices: models,
            default: models.includes(settings.model) ? settings.model : models[0]
        }
    ]);

    settings.model = model.model;
    return settings;
}
