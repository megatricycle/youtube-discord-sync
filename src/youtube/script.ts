import type {
    ContentMessage,
    SerializedYouTubeMetadata,
    SourceContentMessage,
    SourceOptionsResponse,
    SourceTabStatus,
    YouTubeMetadata,
    YouTubeTabReport,
} from '../types';

const DEFAULT_OFFSET = 3;
const INSPECT_DEBOUNCE_MS = 150;
const PENDING_RETRY_MS = 1000;

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

function run(): void {
    let offset = DEFAULT_OFFSET;
    let metadata: YouTubeMetadata | null = null;
    let status: SourceTabStatus = 'pending';
    let error: string | null = null;
    let lastReport: string | null = null;
    let lastReportedTimestamp: string | null = null;

    let videoStreamElement: HTMLVideoElement | null = null;
    const instrumentedVideos = new WeakSet<HTMLVideoElement>();

    let lastInspectedHref: string | null = null;
    let lastInspectedSignature: string | null = null;
    let inspectTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

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

        if (serialized === lastReport && timestamp === lastReportedTimestamp) {
            return;
        }

        lastReport = serialized;
        lastReportedTimestamp = timestamp;

        void chrome.runtime
            .sendMessage({
                type: 'update_source_tab',
                report,
                timestamp,
            } satisfies ContentMessage)
            .catch(() => undefined);
    }

    function sendTimestamp(): void {
        void chrome.runtime
            .sendMessage({
                type: 'video_timeupdate',
                timestamp: getTimestamp(),
            } satisfies ContentMessage)
            .catch(() => undefined);
    }

    function instrumentVideo(element: HTMLVideoElement | null): void {
        if (!element || instrumentedVideos.has(element)) {
            return;
        }

        instrumentedVideos.add(element);
        element.addEventListener('timeupdate', sendTimestamp);
    }

    function stopPendingRetries(): void {
        if (pendingTimer === null) {
            return;
        }

        clearTimeout(pendingTimer);
        pendingTimer = null;
    }

    function retryWhilePending(): void {
        if (pendingTimer !== null) {
            return;
        }

        pendingTimer = setTimeout(() => {
            pendingTimer = null;
            inspect(true);

            if (status === 'pending') {
                retryWhilePending();
            }
        }, PENDING_RETRY_MS);
    }

    /**
     * Recomputes the tab's state from the live DOM. This is the only place that
     * decides `status`, so a page that renders slowly, swaps its microformat or
     * replaces its player converges on the right answer instead of being stuck
     * with whatever the first look found.
     */
    function inspect(force = false): void {
        const href = location.href;
        const source = microformatSource();
        const video = document.querySelector<HTMLVideoElement>('.video-stream');
        const videoReplaced = video !== videoStreamElement;
        const signature = `${href}\n${source ?? ''}`;

        if (!force && !videoReplaced && signature === lastInspectedSignature) {
            return;
        }

        lastInspectedSignature = signature;
        videoStreamElement = video;
        instrumentVideo(video);

        if (href !== lastInspectedHref) {
            lastInspectedHref = href;
            // Reports are deduplicated by content, so a URL change has to be
            // able to produce a new one even when nothing else moved.
            lastReport = null;
        }

        if (!isWatchUrl(location.pathname)) {
            metadata = null;
            status = 'invalid';
            error = null;
            stopPendingRetries();
            report(null);

            return;
        }

        const result = parseMetadata(source);

        switch (result.kind) {
            case 'ready':
                metadata = result.metadata;
                status = 'active';
                error = null;
                stopPendingRetries();
                break;
            case 'not-a-vod':
                metadata = null;
                status = 'invalid';
                error = null;
                stopPendingRetries();
                break;
            case 'not-yet':
                metadata = null;
                status = 'pending';
                error = null;
                retryWhilePending();
                break;
            case 'malformed':
                metadata = null;
                status = 'error';
                error = result.message;
                stopPendingRetries();
                break;
        }

        report(getTimestamp());
    }

    function scheduleInspect(): void {
        if (inspectTimer !== null) {
            return;
        }

        inspectTimer = setTimeout(() => {
            inspectTimer = null;
            inspect();
        }, INSPECT_DEBOUNCE_MS);
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
        stopPendingRetries();

        if (inspectTimer !== null) {
            clearTimeout(inspectTimer);
            inspectTimer = null;
        }

        void chrome.runtime
            .sendMessage({ type: 'unregister_tab' } satisfies ContentMessage)
            .catch(() => undefined);
    });

    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) {
            return;
        }

        // The document was frozen, so every cached decision is stale.
        lastReport = null;
        lastInspectedSignature = null;
        inspect(true);
    });

    // YouTube navigates with `pushState`, which never reaches
    // `chrome.tabs.onUpdated`. These are the signals that a watch page can
    // appear or change without the document reloading.
    window.addEventListener('popstate', scheduleInspect);
    window.addEventListener('yt-navigate-finish', scheduleInspect);

    // A background tab can defer creating its player until it is shown, which
    // is a large part of why this used to fail intermittently.
    document.addEventListener('visibilitychange', scheduleInspect);

    const mutationRoot = document.documentElement;

    if (mutationRoot) {
        const observer = new MutationObserver(scheduleInspect);

        observer.observe(mutationRoot, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    inspect(true);
}

run();

/** The pages that can carry a finished livestream VOD. */
function isWatchUrl(pathname: string): boolean {
    return pathname === '/watch' || pathname.startsWith('/live/');
}

function microformatSource(): string | null {
    const scriptElement = document.querySelector(
        '#microformat script[type="application/ld+json"]',
    );

    return scriptElement?.textContent ?? null;
}

type MetadataParseResult =
    | { kind: 'ready'; metadata: YouTubeMetadata }
    | { kind: 'not-a-vod' }
    | { kind: 'not-yet' }
    | { kind: 'malformed'; message: string };

function parseMetadata(source: string | null): MetadataParseResult {
    if (!source) {
        return { kind: 'not-yet' };
    }

    let parsedMicroformat: unknown;

    try {
        parsedMicroformat = JSON.parse(source);
    } catch (parseError) {
        return {
            kind: 'malformed',
            message:
                parseError instanceof Error
                    ? parseError.message
                    : String(parseError),
        };
    }

    if (!isRecord(parsedMicroformat)) {
        return { kind: 'not-yet' };
    }

    const canonicalUrl = parsedMicroformat['@id'];

    if (typeof canonicalUrl !== 'string') {
        return { kind: 'not-yet' };
    }

    let url: URL;

    try {
        url = new URL(canonicalUrl);
    } catch {
        return { kind: 'malformed', message: 'Unusable YouTube metadata' };
    }

    const id = url.pathname.includes('/live/')
        ? (url.pathname.split('/live/')[1] ?? null)
        : url.searchParams.get('v');

    const title =
        typeof parsedMicroformat.name === 'string'
            ? parsedMicroformat.name
            : '';
    const thumbnailUrls = parsedMicroformat.thumbnailUrl;
    const thumbnail =
        Array.isArray(thumbnailUrls) && typeof thumbnailUrls[0] === 'string'
            ? thumbnailUrls[0]
            : null;
    const channelTitle =
        typeof parsedMicroformat.author === 'string'
            ? parsedMicroformat.author
            : '';

    const firstPublication = Array.isArray(parsedMicroformat.publication)
        ? parsedMicroformat.publication[0]
        : undefined;

    // A watch page always has a publication, so its absence means the page is
    // still rendering rather than that this is something other than a video.
    if (!isRecord(firstPublication)) {
        return { kind: 'not-yet' };
    }

    const publication = firstPublication;
    const endDateValue = publication.endDate;

    if (!endDateValue) {
        return { kind: 'not-a-vod' };
    }

    if (typeof endDateValue !== 'string' && typeof endDateValue !== 'number') {
        return { kind: 'not-a-vod' };
    }

    if (!id || !title || !channelTitle) {
        return { kind: 'malformed', message: 'Incomplete YouTube metadata' };
    }

    const startDateValue = publication.startDate;
    const startDateTime = new Date(
        typeof startDateValue === 'string' || typeof startDateValue === 'number'
            ? startDateValue
            : Number.NaN,
    );
    const endDateTime = new Date(endDateValue);

    if (
        Number.isNaN(startDateTime.getTime()) ||
        Number.isNaN(endDateTime.getTime())
    ) {
        return { kind: 'malformed', message: 'Incomplete YouTube metadata' };
    }

    // To tell a premiere from a regular livestream, look for the "Premiered"
    // keyword somewhere on the page.
    const infoText = document.querySelector(
        '#info-strings yt-formatted-string',
    );
    const isPremiere = infoText?.textContent?.includes('Premiered') ?? false;

    return {
        kind: 'ready',
        metadata: {
            id,
            title,
            channelTitle,
            thumbnail,
            isLivestream:
                typeof publication.isLiveBroadcast === 'boolean'
                    ? publication.isLiveBroadcast
                    : false,
            startDateTime,
            endDateTime,
            isPremiere,
        },
    };
}
