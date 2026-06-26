import { ui } from "../ui/theme.js";
import {
    type DeckConfig,
    DeckData,
    DefaultOrder, deleteOrder,
    loadOrders,
    type Order,
    saveOrder
} from "../config/orderConfigManager.js";
import inquirer from "inquirer";
import { CARD_STOCK_FOIL_POSSIBLE, CARD_STOCKS } from "../output/mpcAutofill.js";
import { processOrder } from "../pipeline/orderProcessing.js";
import { type ProcessingProfile } from "../config/processingProfileManager.js";
import { exists } from "../utils/fs.js";
import path from "node:path";
import { rm } from "node:fs/promises";
import { runSelectProfile } from "./profileMenu.js";
import { confirmDialog, getSeparator } from "../utils/dialog.js";
import { getUniqueName } from "../utils/getUniqueName.js";

export async function runOrderMenu() {
    console.clear();
    console.log(ui.title('Order Management'));
    console.log('Create and manage orders that group Moxfield decks together for batch processing with a selected profile.\n');

    const order = await runSelectOrder('Select an order to process:', true, true, true);
    if (!order) return;

    if (order.states.length) {
        console.log('\n' + ui.attention('This order has already started processing. Choose how to proceed.') + '\n');

        const choice = await inquirer.prompt([
            {
                type: 'select',
                name: 'continue',
                message: 'How to proceed?',
                choices: [
                    { name: 'Continue processing', value: 'continue' },
                    { name: 'Discard previous progress and start over', value: 'start_over' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            }
        ]);

        if (choice.continue === 'cancel') return;

        if (choice.continue === 'start_over') {
            order.states = [];

            const dir = path.join(order.profile.outputDirectory, order.name);
            if (await exists(dir)) {
                await rm(dir, { recursive: true, force: true });
            }

            await saveOrder(order);
        }
    } else {
        const dir = path.join(order.profile.outputDirectory, order.name);
        if (await exists(dir)) {
            await rm(dir, { recursive: true, force: true });
        }
    }

    await processOrder(order);

    console.log(ui.success('Order processing complete.') + '\n');
}

async function runSelectOrder(
    title: string = 'Select an order:',
    offerCreate: boolean = true,
    offerUpdate: boolean = true,
    offerDelete: boolean = true
) {
    const orders = await loadOrders();

    const choices: unknown[] = orders.map(c => ({ name: c.name, value: c }));

    if (orders.length > 0) {
        choices.push(getSeparator());
    }

    if (offerCreate) choices.push({ name: ui.secondary('Create a new order'), value: 'create' });
    if (offerUpdate) choices.push({ name: ui.secondary('Update an order'), value: 'update', disabled: orders.length === 0 });
    if (offerDelete) choices.push({ name: ui.secondary('Delete an order'), value: 'delete', disabled: orders.length === 0 });

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
        console.log(ui.title('Create an Order'));
        console.log('Set up a new order by selecting a processing profile and adding Moxfield deck URLs.\n');

        await runCreateOrder(orders);

        console.clear();
        console.log();

        return await runSelectOrder(title, offerCreate, offerUpdate, offerDelete);
    } else if (action.choice === 'update') {
        console.clear();
        console.log(ui.title('Update an Order'));
        console.log('Adjust settings for an existing order, such as card stock, foil options, or deck configurations.\n');

        const orderToUpdate = await runSelectOrder('Select an order to update:', false, false, false);

        if (orderToUpdate) {
            await runUpdateOrder(orderToUpdate);
        }

        console.clear();
        console.log();

        return await runSelectOrder(title, offerCreate, offerUpdate, offerDelete);
    } else if (action.choice === 'delete') {
        console.clear();
        console.log(ui.title('Delete an Order'));
        console.log('Permanently remove an order configuration and its associated processing state.\n');

        const orderToDelete = await runSelectOrder('Select an order to delete:', false, false, false);

        if (orderToDelete) {
            if (await confirmDialog(`Delete order "${orderToDelete.name}"?`)) {
                await deleteOrder(orderToDelete);
            }

            console.log();
        }

        console.clear();
        console.log();

        return await runSelectOrder(title, offerCreate, offerUpdate, offerDelete);
    } else if (action.choice === 'cancel') {
        return;
    }

    return action.choice as Order;
}

async function runCreateOrder(existingOrders: Order[]) {
    let defaultOrder = {
        ...DefaultOrder,
        name: `order_${new Date().toISOString().replaceAll(':', '-').split('.')[0]}`
    };

    if (existingOrders.length > 0) {
        const copy = await confirmDialog('Would you like to copy an existing order?', false);
        if (copy) {
            const existingOrder = await runSelectOrder('Select an existing order to copy:', false, false, false);
            if (existingOrder) defaultOrder = existingOrder;
        }
    }

    defaultOrder.states = [];

    const result = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Order Name:',
            default: getUniqueName(defaultOrder.name, existingOrders.map(x => x.name)),
            validate: (value) => existingOrders.some(c => c.name === value) ? 'Order name already exists' : true
        }
    ]);

    const order: Order = { ...defaultOrder, name: result.name };
    await runUpdateOrder(order);

    return order;
}

async function runUpdateOrder(order: Order) {
    let processingProfile: ProcessingProfile | undefined;
    do {
        processingProfile = await runSelectProfile('Which processing profile?', false, false, false, true);
    } while (!processingProfile);

    const answers = await inquirer.prompt([
        {
            type: 'select',
            name: 'cardStock',
            message: 'MPC Card Stock:',
            choices: CARD_STOCKS.map(stock => ({ name: stock, value: stock })),
            default: order.cardStock
        },
        {
            type: 'confirm',
            name: 'foil',
            message: 'Foil?',
            when: (answers) => CARD_STOCK_FOIL_POSSIBLE[answers.cardStock as (typeof CARD_STOCKS)[number]],
            default: order.foil
        },
        {
            type: 'input',
            name: 'cardBack',
            message: 'MPC Autofill Card Back ID:',
            default: order.cardBack
        },
        {
            type: 'number',
            name: 'deckCount',
            message: 'How many Moxfield decks?',
            default: Math.max(1, order.decks.length)
        }
    ]);

    const decks: DeckConfig[] = [];

    let previousDeckConfig: DeckConfig | undefined;
    for (let i = 0; i < answers.deckCount; i++) {
        console.log(ui.subtitle(`Deck #${i + 1} Configuration`))
        console.log('Please enter your the deck details below.');

        if (order.decks.length > i) {
            if (!previousDeckConfig) {
                previousDeckConfig = order.decks[i];
            } else {
                previousDeckConfig = {
                    ...previousDeckConfig,
                    ...order.decks[i]
                };
            }
        }

        previousDeckConfig = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Moxfield deck URL:',
                default: previousDeckConfig?.url,
                validate: validateMoxfieldUrl,
            },
            {
                type: 'checkbox',
                name: 'data',
                message: 'What should be included?',
                choices: [
                    createDeckDataItem('Main Board', DeckData.MainBoard, true, previousDeckConfig),
                    createDeckDataItem('Sideboard', DeckData.SideBoard, true, previousDeckConfig),
                    createDeckDataItem('Considering', DeckData.Considering, false, previousDeckConfig),
                    createDeckDataItem('Tokens', DeckData.Tokens, true, previousDeckConfig),
                    createDeckDataItem('Attraction Deck', DeckData.Attractions, false, previousDeckConfig),
                    createDeckDataItem('Contraption Deck', DeckData.Contraptions, false, previousDeckConfig),
                    createDeckDataItem('Sticker Sheets', DeckData.Stickers, false, previousDeckConfig),
                    createDeckDataItem('Planar Deck', DeckData.Planes, false, previousDeckConfig),
                    createDeckDataItem('Schemes', DeckData.Schemes, false, previousDeckConfig)
                ],
                validate: validateAnySelected
            }]);

        // TODO: ask for token quantity if selected

        decks.push(previousDeckConfig);
    }

    // TODO: show warning if largest bracket too small

    order = {
        ...order,
        profile: processingProfile,
        cardStock: answers.cardStock,
        foil: CARD_STOCK_FOIL_POSSIBLE[answers.cardStock as (typeof CARD_STOCKS)[number]] && answers.foil,
        cardBack: answers.cardBack,
        decks
    };

    await saveOrder(order);
    return order;
}

function createDeckDataItem(name: string, data: DeckData, defaultChecked: boolean, previousAnswers?: DeckConfig) {
    return {
        name,
        value: data,
        checked: !!previousAnswers ? previousAnswers?.data?.includes(data) : defaultChecked
    };
}

export function validateAnySelected(answers: any[]) {
    if (answers.length > 0) return true;
    return 'Select at least one item.';
}

function validateMoxfieldUrl(value: string) {
    try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
        if (url.host === 'moxfield.com' && url.pathname.startsWith('/decks/')) return true;
    } catch (_) {
        // Nothing to do.
    }
    return 'Please enter a valid Moxfield deck URL.';
}