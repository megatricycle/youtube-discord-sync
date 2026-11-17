import type {
    YouTubeBackgroundMessage,
    YouTubeMessage,
    YouTubeMetadata,
    YouTubeSyncOptions,
    YouTubeTabInformationResponse,
    YouTubeTimestampResponse,
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isYouTubeSyncOptions(
    value: unknown,
): value is Partial<YouTubeSyncOptions> {
    if (!isRecord(value)) {
        return false;
    }

    return (
        (value.offset === undefined || typeof value.offset === 'number') &&
        (value.isPaused === undefined || typeof value.isPaused === 'boolean') &&
        (value.isPremiere === undefined ||
            typeof value.isPremiere === 'boolean')
    );
}

function isYouTubeMessage(request: unknown): request is YouTubeMessage {
    if (!isRecord(request)) {
        return false;
    }

    switch (request.message) {
        case 'fetch_info':
        case 'fetch_timestamp':
            return true;
        case 'sync_start':
        case 'sync_stop':
            return typeof request.targetTabId === 'number';
        case 'sync_option_update':
            return isYouTubeSyncOptions(request.options);
        default:
            return false;
    }
}

async function run(): Promise<void> {
    let tabsToSync: number[] = [];
    let options: YouTubeSyncOptions = {
        offset: 3,
        isPaused: false,
        isPremiere: false,
    };

    const microformatElement =
        await waitForElement<HTMLElement>('#microformat');
    const videoStreamElement =
        await waitForElement<HTMLVideoElement>('.video-stream');

    let metadata = getMetadata();

    function handleMessage(
        request: unknown,
        sendResponse: (response?: unknown) => void,
    ) {
        if (!isYouTubeMessage(request)) {
            return;
        }

        if (request.message === 'fetch_info') {
            sendResponse({
                metadata,
                activeSyncs: tabsToSync,
                options,
            } satisfies YouTubeTabInformationResponse);
        }

        if (request.message === 'sync_start') {
            const { targetTabId } = request;

            syncStart(targetTabId);
            chrome.runtime.sendMessage({
                message: 'sync_start',
                targetTabId,
            } satisfies YouTubeBackgroundMessage);
        }

        if (request.message === 'sync_stop') {
            const { targetTabId } = request;

            syncStop(targetTabId);
            chrome.runtime.sendMessage({
                message: 'sync_stop',
                targetTabId,
            } satisfies YouTubeBackgroundMessage);
        }

        if (request.message === 'sync_option_update') {
            options = { ...options, ...request.options };
        }

        if (request.message === 'fetch_timestamp') {
            if (!videoStreamElement) {
                sendResponse({
                    timestamp: null,
                } satisfies YouTubeTimestampResponse);

                return;
            }

            sendResponse({
                timestamp: getTimestamp(),
            } satisfies YouTubeTimestampResponse);
        }
    }

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        handleMessage(request, sendResponse);
    });

    if (!microformatElement || !videoStreamElement) {
        return;
    }

    function getTimestamp(): string | null {
        if (!videoStreamElement || !metadata) {
            return null;
        }

        const currentTime = videoStreamElement.currentTime;
        const duration = videoStreamElement.duration;

        let startDateTime = metadata.startDateTime;

        if (metadata.isPremiere) {
            // startDateTime does not include the countdown timer
            // Instead, lets figure out the startDateTime by using the video length and endStartDate
            // Why not use that for actual livestreams? I don't know, when I do this for livestreams, there's a noticable delay in chat
            startDateTime = new Date(
                metadata.endDateTime.getTime() - duration * 1000,
            );
        }

        return new Date(
            startDateTime.getTime() + (currentTime - options.offset) * 1000,
        ).toISOString();
    }

    // always send a timestamp update whenever the main video element is played
    function handleTimeUpdate() {
        if (options.isPaused) {
            return;
        }

        const timestamp = getTimestamp();

        tabsToSync.forEach((tabId) => {
            chrome.runtime.sendMessage({
                message: 'video_timeupdate',
                tabId: tabId,
                timestamp,
            } satisfies YouTubeBackgroundMessage);
        });
    }

    videoStreamElement.addEventListener('timeupdate', handleTimeUpdate);

    // everytime the metadata changes, update the metadata internal state
    const microformatObserver = new MutationObserver(() => {
        metadata = getMetadata();
    });

    microformatObserver.observe(microformatElement, {
        childList: true,
        subtree: true,
    });

    // reset the metadata information when navigating away from a video, and close any ongoing syncs
    const videoStreamObserver = new MutationObserver(() => {
        if (!videoStreamElement.hasAttribute('src')) {
            metadata = null;

            clearAllSync();
        }
    });

    videoStreamObserver.observe(videoStreamElement, { attributes: true });

    function syncStart(tabId: number) {
        tabsToSync.push(tabId);
    }

    function syncStop(tabId: number) {
        tabsToSync = tabsToSync.filter((_tabId) => tabId !== _tabId);
    }

    function clearAllSync() {
        tabsToSync.forEach((tabId) => {
            chrome.runtime.sendMessage({
                message: 'sync_stop',
                targetTabId: tabId,
            } satisfies YouTubeBackgroundMessage);
        });

        tabsToSync = [];
    }
}

run();

function getMetadata(): YouTubeMetadata | null {
    const scriptElement = document.querySelector(
        '#microformat script[type="application/ld+json"]',
    );

    if (!scriptElement?.textContent) {
        return null;
    }

    const parsedMicroformat: unknown = JSON.parse(scriptElement.textContent);

    if (!isRecord(parsedMicroformat)) {
        return null;
    }

    const canonicalUrl = parsedMicroformat['@id'];

    if (typeof canonicalUrl !== 'string') {
        return null;
    }

    const microformat = parsedMicroformat;
    const url = new URL(canonicalUrl);

    let id: string | null = null;

    if (url.pathname.includes('/live/')) {
        id = url.pathname.split('/live/')[1] ?? null;
    } else {
        id = url.searchParams.get('v');
    }

    const title = typeof microformat.name === 'string' ? microformat.name : '';
    const thumbnailUrls = microformat.thumbnailUrl;
    const thumbnail =
        Array.isArray(thumbnailUrls) && typeof thumbnailUrls[0] === 'string'
            ? thumbnailUrls[0]
            : null;
    const channelTitle =
        typeof microformat.author === 'string' ? microformat.author : '';

    const firstPublication = Array.isArray(microformat.publication)
        ? microformat.publication[0]
        : undefined;
    const publication = isRecord(firstPublication) ? firstPublication : {};

    const isLivestream =
        typeof publication.isLiveBroadcast === 'boolean'
            ? publication.isLiveBroadcast
            : false;
    const startDateValue = publication.startDate;
    const startDateTime = new Date(
        typeof startDateValue === 'string' || typeof startDateValue === 'number'
            ? startDateValue
            : Number.NaN,
    );

    // to determine whether this is a premiere or a regular livestream, just look for the "Premiered" keyword somewhere in the page

    const infoText = document.querySelector(
        '#info-strings yt-formatted-string',
    );

    const isPremiere = infoText?.textContent?.includes('Premiered') ?? false;

    const endDateValue = publication.endDate;

    if (!endDateValue) {
        // this is an ongoing livestream. do not show this on the list
        return null;
    }

    if (typeof endDateValue !== 'string' && typeof endDateValue !== 'number') {
        return null;
    }

    const endDateTime = new Date(endDateValue);

    if (!id || !title || !channelTitle || !startDateTime) {
        throw new Error('Incomplete YouTube metadata');
    }

    return {
        id,
        title,
        channelTitle,
        thumbnail,
        isLivestream,
        startDateTime,
        endDateTime,
        isPremiere,
    };
}

function waitForElement<T extends Element>(
    selector: string,
): Promise<T | null> {
    const WAIT_FOR_ELEMENT_DURATION = 2000;

    return new Promise((resolve) => {
        const element = document.querySelector<T>(selector);

        if (element) {
            resolve(element);
            return;
        }

        let timeoutCountdown: ReturnType<typeof setTimeout>;
        const observer = new MutationObserver(() => {
            const foundElement = document.querySelector<T>(selector);

            if (!foundElement) {
                return;
            }

            clearTimeout(timeoutCountdown);
            observer.disconnect();
            resolve(foundElement);
        });

        timeoutCountdown = setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, WAIT_FOR_ELEMENT_DURATION);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    });
}
