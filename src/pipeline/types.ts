export enum ProcessingState {
    NotDownloaded = "not-downloaded",
    Downloaded = "downloaded",
    Upscaled = "upscaled",
    PostProcessed = "post-processed",
    Converted = "converted",
}

export interface CardQueueItem {
    id: string,
    face: 'front' | 'back',
    scryfallUrl: string,
    path: string,
    state: ProcessingState
}

export interface Queue {
    cards: CardQueueItem[],
    done: boolean
}

export interface Queues {
    [ProcessingState.NotDownloaded]: Queue,
    [ProcessingState.Downloaded]: Queue,
    [ProcessingState.Upscaled]: Queue,
    [ProcessingState.PostProcessed]: Queue,
    [ProcessingState.Converted]: Queue
}
