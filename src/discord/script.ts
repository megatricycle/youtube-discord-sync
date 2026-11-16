export {};

// as of now any incoming sync requests are assumed to be from a YouTube tab
// this can change in the future once we start supporting other websites
// @TODO: change these to make it clear that these come from a YouTube tab

type DiscordMessage =
    | { message: 'video_timeupdate'; timestamp: string }
    | { message: 'sync_start'; tabId: number }
    | { message: 'sync_stop' }
    | { message: 'get_tab_information' };

type CurrentSync = { type: 'youtube'; tabId: number } | null;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDiscordMessage(request: unknown): request is DiscordMessage {
    if (!isRecord(request)) {
        return false;
    }

    switch (request.message) {
        case 'video_timeupdate':
            return typeof request.timestamp === 'string';
        case 'sync_start':
            return typeof request.tabId === 'number';
        case 'sync_stop':
        case 'get_tab_information':
            return true;
        default:
            return false;
    }
}

let currentSync: CurrentSync = null;

function handleMessage(
    request: unknown,
    sendResponse: (response?: unknown) => void,
) {
    if (!isDiscordMessage(request)) {
        return;
    }

    if (request.message === 'video_timeupdate') {
        const scroller = document.querySelector<HTMLElement>(
            "main div[class*='scroller']",
        );

        if (!scroller) {
            console.warn('Chat scroller not found');
            return;
        }

        const chatElements = Array.from(
            document.querySelectorAll<HTMLTimeElement>(
                `main div[class*='scroller'] time[datetime]`,
            ),
        ).filter((chatElement) => {
            const dateTime = chatElement.getAttribute('datetime');

            return (
                dateTime !== null &&
                new Date(dateTime) < new Date(request.timestamp)
            );
        });

        const closestTimeElement = chatElements[chatElements.length - 1];

        if (!closestTimeElement) {
            scroller.scrollBy({
                behavior: 'instant',
                top: -scroller.clientHeight,
            });

            return;
        }

        const currentChatElement = closestTimeElement.closest('li');

        if (!currentChatElement) {
            return;
        }

        const distance =
            48 +
            scroller.clientHeight -
            currentChatElement.getBoundingClientRect().top -
            currentChatElement.clientHeight;
        const y = -distance + 30;

        scroller.scrollBy({ behavior: 'instant', top: y });
    }

    if (request.message === 'sync_start') {
        syncStart(request.tabId);
    }

    if (request.message === 'sync_stop') {
        syncStop();
    }

    if (request.message === 'get_tab_information') {
        sendResponse({ currentSync });
    }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    handleMessage(request, sendResponse);

    return true;
});

function syncStart(tabId: number) {
    currentSync = {
        type: 'youtube',
        tabId,
    };
}

function syncStop() {
    currentSync = null;
}
