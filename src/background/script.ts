export {};

type BackgroundMessage =
    | { message: 'video_timeupdate'; tabId: number; timestamp: string }
    | { message: 'sync_stop'; tabId: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function handleMessage(request: unknown, sender: chrome.runtime.MessageSender) {
    if (!isRecord(request)) {
        return;
    }

    if (
        request.message === 'video_timeupdate' &&
        typeof request.tabId === 'number' &&
        typeof request.timestamp === 'string'
    ) {
        const message: BackgroundMessage = {
            message: 'video_timeupdate',
            tabId: request.tabId,
            timestamp: request.timestamp,
        };

        chrome.tabs.sendMessage(message.tabId, {
            message: message.message,
            timestamp: message.timestamp,
        });
    }

    // this case happens when youtube content script triggers the stop
    if (request.message === 'sync_stop' && typeof request.tabId === 'number') {
        const senderTabId = sender.tab?.id;

        if (typeof senderTabId !== 'number') {
            return;
        }

        const message: BackgroundMessage = {
            message: 'sync_stop',
            tabId: request.tabId,
        };

        chrome.tabs.sendMessage(message.tabId, {
            message: message.message,
            tabId: senderTabId,
        });
    }
}

function run() {
    console.log('Discord Time Machine VOD service worker is running.');

    chrome.runtime.onMessage.addListener((request, sender) => {
        handleMessage(request, sender);

        return true;
    });
}

run();
