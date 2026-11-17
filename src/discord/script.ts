import type {
    ContentMessage,
    DiscordContentMessage,
    DiscordTabReport,
    TabStatus,
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDiscordContentMessage(
    request: unknown,
): request is DiscordContentMessage {
    return (
        isRecord(request) &&
        request.type === 'video_timeupdate' &&
        typeof request.timestamp === 'string'
    );
}

/**
 * Derives the channel identity from the tab's own URL and title. Discord titles
 * look like `(1) Discord | #general | My Server`, so the unread badge has to be
 * ignored.
 */
function deriveIdentity(
    href: string,
    title: string,
): { channelName: string | null; serverName: string | null } {
    let pathname: string;

    try {
        pathname = new URL(href).pathname;
    } catch {
        return { channelName: null, serverName: null };
    }

    const match = pathname.match(/^\/channels\/([^/]+)\/(\d+)/);

    if (!match) {
        return { channelName: null, serverName: null };
    }

    const [, guildId] = match;
    const segments = title.split(' | ');
    const channelName = segments[1] ?? null;

    // Direct messages have no server segment.
    if (guildId === '@me') {
        return { channelName, serverName: null };
    }

    if (!/^\d+$/.test(guildId)) {
        return { channelName: null, serverName: null };
    }

    return { channelName, serverName: segments[2] ?? null };
}

function scrollToTimestamp(timestamp: string): void {
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

        return dateTime !== null && new Date(dateTime) <= new Date(timestamp);
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

function run(): void {
    let lastReport: string | null = null;

    function report(): void {
        const identity = deriveIdentity(location.href, document.title);
        const status: TabStatus = identity.channelName ? 'active' : 'invalid';
        const tabReport: DiscordTabReport = {
            url: location.href,
            status,
            error: null,
            ...identity,
        };
        const serialized = JSON.stringify(tabReport);

        // Unread badges mutate the title constantly; only report real changes.
        if (serialized === lastReport) {
            return;
        }

        lastReport = serialized;

        void chrome.runtime
            .sendMessage({
                type: 'update_discord_tab',
                report: tabReport,
            } satisfies ContentMessage)
            .catch(() => undefined);
    }

    report();

    chrome.runtime.onMessage.addListener((request) => {
        if (!isDiscordContentMessage(request)) {
            return false;
        }

        scrollToTimestamp(request.timestamp);

        return false;
    });

    new MutationObserver(report).observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    // Discord is a single-page app, so the URL can change without the title
    // changing and without a navigation event.
    document.addEventListener('visibilitychange', report);

    window.addEventListener('pagehide', () => {
        void chrome.runtime
            .sendMessage({ type: 'unregister_tab' } satisfies ContentMessage)
            .catch(() => undefined);
    });

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            lastReport = null;
            report();
        }
    });
}

run();
