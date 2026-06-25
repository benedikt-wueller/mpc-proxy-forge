export interface Oval {
    x: number,
    y: number,
    rx: number,
    ry: number,
}

export interface Triangle {
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number
}

export interface StampOptions {
    fillColor: string,
    strokeColor?: string,
    strokeWidth: number,
    opacity: number
}

export interface BlackoutBox {
    x1: number,
    x2: number,
    y1: number,
    y2: number
}

export interface ProxyNoteBox {
    horizontalAlignment: 'left' | 'center' | 'right',
    verticalAlignment: 'top' | 'center',
    orientation: 'vertical' | 'horizontal'
    x: number,
    y: number,
    size: number,
}

export const STAMP_OVAL = {
    x: 0.5,
    y: 0.936,
    rx: 0.05,
    ry: 0.021,
} as Oval;

export const STAMP_TRIANGLE = {
    x1: 0.4525,
    y1: 0.915,
    x2: 0.5,
    y2: 0.952,
    x3: 0.5475,
    y3: 0.915
} as Triangle;

export const REFERENCE_WIDTH = 745;
export const REFERENCE_HEIGHT = 1040;

export const COPYRIGHT_BOXES = {
    '1993': {
        default: {
            x1: 61 / REFERENCE_WIDTH,
            x2: 466 / REFERENCE_WIDTH,
            y1: 964 / REFERENCE_HEIGHT,
            y2: 988 / REFERENCE_HEIGHT
        } as BlackoutBox
    },
    '1997': {
        default: {
            x1: 70 / REFERENCE_WIDTH,
            x2: 585 / REFERENCE_WIDTH,
            y1: 961 / REFERENCE_HEIGHT,
            y2: 988 / REFERENCE_HEIGHT
        } as BlackoutBox
    },
    '2003': {
        default: {
            x1: 56 / REFERENCE_WIDTH,
            x2: 468 / REFERENCE_WIDTH,
            y1: 979 / REFERENCE_HEIGHT,
            y2: 1002 / REFERENCE_HEIGHT
        } as BlackoutBox,
        planeswalker: {
            x1: 183 / REFERENCE_WIDTH,
            x2: 569 / REFERENCE_WIDTH,
            y1: 986 / REFERENCE_HEIGHT,
            y2: 1016 / REFERENCE_HEIGHT
        } as BlackoutBox,
        planechase: {
            x1: 722 / REFERENCE_WIDTH,
            x2: 740 / REFERENCE_WIDTH,
            y1: 318 / REFERENCE_HEIGHT,
            y2: 714 / REFERENCE_HEIGHT
        } as BlackoutBox
    },
    '2015': {
        default: {
            x1: 430 / REFERENCE_WIDTH,
            x2: 700 / REFERENCE_WIDTH,
            y1: 970 / REFERENCE_HEIGHT,
            y2: 1010 / REFERENCE_HEIGHT,
        } as BlackoutBox,
        creature: {
            x1: 430 / REFERENCE_WIDTH,
            x2: 700 / REFERENCE_WIDTH,
            y1: 990 / REFERENCE_HEIGHT,
            y2: 1010 / REFERENCE_HEIGHT
        } as BlackoutBox,
        creatureUniversesBeyond: {
            x1: 430 / REFERENCE_WIDTH,
            x2: 575 / REFERENCE_WIDTH,
            y1: 970 / REFERENCE_HEIGHT,
            y2: 1010 / REFERENCE_HEIGHT
        } as BlackoutBox,
        planeswalker: {
            x1: 430 / REFERENCE_WIDTH,
            x2: 700 / REFERENCE_WIDTH,
            y1: 990 / REFERENCE_HEIGHT,
            y2: 1010 / REFERENCE_HEIGHT
        } as BlackoutBox,
        planechase: {
            x1: 716 / REFERENCE_WIDTH,
            x2: 736 / REFERENCE_WIDTH,
            y1: 30 / REFERENCE_HEIGHT,
            y2: 371 / REFERENCE_HEIGHT
        } as BlackoutBox
    }
};

export const PROXY_NOTE_POSITIONS = {
    '1993': {
        default: {
            x: 0.09,
            y: 0.935,
            horizontalAlignment: 'left',
            verticalAlignment: 'top',
            orientation: 'horizontal',
            size: 0.012
        } as ProxyNoteBox
    },
    '1997': {
        default: {
            x: 0.08,
            y: 0.935,
            horizontalAlignment: 'left',
            verticalAlignment: 'top',
            orientation: 'horizontal',
            size: 0.012
        } as ProxyNoteBox
    },
    '2003': {
        default: {
            x: 0.08,
            y: 0.945,
            horizontalAlignment: 'left',
            verticalAlignment: 'top',
            orientation: 'horizontal',
            size: 0.012
        } as ProxyNoteBox,
        planeswalker: {
            x: 0.5,
            y: 0.955,
            horizontalAlignment: 'center',
            verticalAlignment: 'top',
            orientation: 'horizontal',
            size: 0.012
        } as ProxyNoteBox,
        planechase: {
            x: 0.975,
            y: 0.5,
            horizontalAlignment: 'left',
            verticalAlignment: 'center',
            orientation: 'vertical',
            size: 0.014
        } as ProxyNoteBox
    },
    '2015': {
        default: {
            x: 0.93,
            y: 0.955,
            horizontalAlignment: 'right',
            verticalAlignment: 'top',
            orientation: 'horizontal',
            size: 0.012
        } as ProxyNoteBox,
        planechase: {
            x: 0.967,
            y: 0.05,
            horizontalAlignment: 'left',
            verticalAlignment: 'top',
            orientation: 'vertical',
            size: 0.014
        } as ProxyNoteBox
    }
}
