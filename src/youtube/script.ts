import type {
    ContentMessage,
    SerializedYouTubeMetadata,
    SourceContentMessage,
    SourceOptionsResponse,
    TabStatus,
    YouTubeMetadata,
    YouTubeTabReport,
} from '../types';

const DEFAULT_OFFSET = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isSourceContentMessage(
    request: unknown,
): request is SourceContentMessage {
    return (
        isRecord(request) &&
        request.type === 'options_updated' &&
        typeof request.offset === 'number'
    );
}

function serializeMetadata(
    metadata: YouTubeMetadata | null,
): SerializedYouTubeMetadata | null {
    if (!metadata) {
        return null;
    }

    return {
        ...metadata,
        startDateTime: metadata.startDateTime.toISOString(),
        endDateTime: metadata.endDateTime.toISOString(),
    };
}

async function run(): Promise<void> {
    let offset = DEFAULT_OFFSET;
    let metadata: YouTubeMetadata | null = null;
    let status: TabStatus = 'invalid';
    let error: string | null = null;
    let lastReport: string | null = null;

    // Assigned once the page has been inspected.
    let videoStreamElement: HTMLVideoElement | null = null;

    function getTimestamp(): string | null {
        if (!videoStreamElement || !metadata) {
            return null;
        }

        const { currentTime, duration } = videoStreamElement;

        let startDateTime = metadata.startDateTime;

        if (metadata.isPremiere) {
            // startDateTime does not include the countdown timer, so derive it
            // from the video length and the end date instead. Doing this for
            // real livestreams adds a noticeable delay to chat.
            if (!Number.isFinite(duration)) {
                return null;
            }

            startDateTime = new Date(
                metadata.endDateTime.getTime() - duration * 1000,
            );
        }

        const timestamp = new Date(
            startDateTime.getTime() + (currentTime - offset) * 1000,
        );

        if (Number.isNaN(timestamp.getTime())) {
            return null;
        }

        return timestamp.toISOString();
    }

    function report(timestamp: string | null): void {
        const report: YouTubeTabReport = {
            type: 'youtube',
            url: location.href,
            status,
            error,
            metadata: serializeMetadata(metadata),
            offset,
        };
        const serialized = JSON.stringify(report);

        if (serialized === lastReport) {
            return;
        }

        lastReport = serialized;

        void chrome.runtime
            .sendMessage({
                type: 'update_source_tab',
                report,
                timestamp,
            } satisfies ContentMessage)
            .catch(() => undefined);
    }

    function refreshMetadata(): void {
        try {
            metadata = getMetadata();
            status = metadata ? 'active' : 'invalid';
            error = null;
        } catch (metadataError) {
            metadata = null;
            status = 'error';
            error =
                metadataError instanceof Error
                    ? metadataError.message
                    : String(metadataError);
        }
    }

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (!isSourceContentMessage(request)) {
            return false;
        }

        offset = request.offset;

        // The response carries the recalculated timestamp so the background can
        // cache it before the popup refetches.
        sendResponse({
            timestamp: getTimestamp(),
        } satisfies SourceOptionsResponse);

        return false;
    });

    window.addEventListener('pagehide', () => {
        void chrome.runtime
            .sendMessage({ type: 'unregister_tab' } satisfies ContentMessage)
            .catch(() => undefined);
    });

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            lastReport = null;
            report(getTimestamp());
        }
    });

    const microformatElement =
        await waitForElement<HTMLElement>('#microformat');
    videoStreamElement =
        await waitForElement<HTMLVideoElement>('.video-stream');

    refreshMetadata();
    report(getTimestamp());

    if (!microformatElement || !videoStreamElement) {
        // Not a watch page: stay registered as invalid so the popup can show
        // the "open a VOD" guidance.
        return;
    }

    // Report on every tick. The background decides whether an update is
    // forwarded to Discord, so a paused video still keeps the popup clock live.
    videoStreamElement.addEventListener('timeupdate', () => {
        void chrome.runtime
            .sendMessage({
                type: 'video_timeupdate',
                timestamp: getTimestamp(),
            } satisfies ContentMessage)
            .catch(() => undefined);
    });

    // YouTube swaps the microformat out when the video changes.
    const microformatObserver = new MutationObserver(() => {
        refreshMetadata();
        report(getTimestamp());
    });

    microformatObserver.observe(microformatElement, {
        childList: true,
        subtree: true,
    });

    // Navigating away from a video clears the `src` attribute. Reporting the
    // tab as invalid is what tears the sync sessions down.
    const videoStreamObserver = new MutationObserver(() => {
        if (videoStreamElement?.hasAttribute('src')) {
            if (status === 'active') {
                return;
            }

            refreshMetadata();
            report(getTimestamp());

            return;
        }

        metadata = null;
        status = 'invalid';
        error = null;
        report(null);
    });

    videoStreamObserver.observe(videoStreamElement, { attributes: true });
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
