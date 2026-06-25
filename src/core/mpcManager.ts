import { toXML } from "jstoxml";
import type { Order } from "./orderConfigManager.js";
import type { MoxfieldCard } from "./moxfield.js";
import type { CardQueueItem } from "./orderProcessing.js";

export const BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612];

export const S27 = "(S27) Smooth";
export const S30 = "(S30) Standard Smooth";
export const S33 = "(S33) Superior Smooth";
export const M31 = "(M31) Linen";
export const P10 = "(P10) Plastic";

export const CARD_STOCKS = [S27, S30, S33, M31, P10] as const;

export const CARD_STOCK_FOIL_POSSIBLE = {
    [S27]: true,
    [S30]: true,
    [S33]: true,
    [M31]: true,
    [P10]: false
};

export const DEFAULT_CARD_STOCK = S30;

interface MpcAutofillOrder {
    details: {
        quantity: number,
        bracket: typeof BRACKETS[number],
        stock: typeof CARD_STOCKS[number],
        foil: boolean
    },
    fronts: MpcAutofillWrapper[],
    backs: MpcAutofillWrapper[],
    cardback: string,
    filepath: string
}

interface MpcAutofillWrapper {
    card: MpcAutofillCard
}

interface MpcAutofillCard {
    id: string,
    name: string,
    query?: string,
    slots: string,
    sourceType: 'Local File' | undefined
}

export function findBracket(sum: number) {
    return BRACKETS.find(bracket => sum <= bracket);
}

export function createMpcAutofillOrder(order: Order, items: CardQueueItem[], cards: MoxfieldCard[]) {
    const quantity = cards.reduce((acc, card) => acc + card.quantity, 0);
    const bracket = findBracket(quantity) ?? BRACKETS[BRACKETS.length - 1]!;

    const fronts: MpcAutofillWrapper[] = [];
    const backs: MpcAutofillWrapper[] = [];
    const backSlotsUsed: number[] = [];

    let currentSlot = 0;
    cards.forEach(moxfieldCard => {
        const quantity = moxfieldCard.quantity;
        const card = moxfieldCard.card;

        const faces = items.filter(s => s.id === card.id);
        const front = faces.find(s => s.face === 'front');
        const back = faces.find(s => s.face === 'back');

        if (!front) {
            console.error(`No front state found for card ${card.name} (${card.scryfall_id})`);
            return;
        }

        const frontSlots = Array.from({ length: quantity }, (_, i) => currentSlot + i);
        const backSlots = !!back ? Array.from({ length: quantity }, (_, i) => currentSlot + i) : [];

        fronts.push({
            card: {
                id: front.path,
                name: front.path,
                slots: frontSlots.join(','),
                sourceType: 'Local File'
            }
        });

        if (!!back && backSlots.length > 0) {
            backs.push({
                card: {
                    id: back.path,
                    name: back.path,
                    slots: backSlots.join(','),
                    sourceType: 'Local File'
                }
            });

            backSlotsUsed.push(...backSlots);
        }

        currentSlot += moxfieldCard.quantity;
    });

    const remainingBackSlots = Array.from({ length: quantity }, (_, i) => i).filter(slot => !backSlotsUsed.includes(slot));
    if (remainingBackSlots.length > 0) {
        backs.push({
            card: {
                id: order.cardBack,
                name: order.cardBack,
                slots: remainingBackSlots.join(','),
                sourceType: undefined
            }
        });
    }

    const mpcOrder: MpcAutofillOrder = {
        details: {
            quantity: quantity,
            bracket: bracket,
            stock: order.cardStock,
            foil: order.foil
        },
        fronts,
        backs,
        cardback: order.cardBack,
        filepath: `cards`
    }

    return toXML({ order: mpcOrder });
}
