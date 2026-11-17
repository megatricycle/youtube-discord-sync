import type {
    ContentMessage,
    DiscordContentMessage,
    DiscordTabReport,
    PlaybackTimestampResponse,
    PopupRequest,
    SourceContentMessage,
    SourceOptionsResponse,
    SourceTabReport,
    SyncOptions,
    TabContext,
} from '../types';
import {
    getActiveSyncTargetTabIds,
    getDiscordTabInformation,
    getDiscordTabs,
    getPlaybackTimestamp,
    getSourceTabInformation,
    recordDiscordTab,
    recordSourceTab,
    recordTimestamp,
    startSync,
    stopSync,
    unregisterTab,
    updateOptions,
} from './registry';
import { findSourceForHostname, isSourceId } from './sources';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isTabStatus(value: unknown): boolean {
    return value === 'active' || value === 'invalid' || value === 'error';
}

function isSourceTabReport(value: unknown): value is SourceTabReport {
    return (
        isRecord(value) &&
        isSourceId(value.type) &&
        typeof value.url === 'string' &&
        isTabStatus(value.status) &&
        isNullableString(value.error) &&
        typeof value.offset === 'number' &&
        (value.metadata === null || isRecord(value.metadata))
    );
}

function isDiscordTabReport(value: unknown): value is DiscordTabReport {
    return (
        isRecord(value) &&
        typeof value.url === 'string' &&
        isTabStatus(value.status) &&
        isNullableString(value.error) &&
        isNullableString(value.channelName) &&
        isNullableString(value.serverName)
    );
}

function isContentMessage(request: unknown): request is ContentMessage {
    if (!isRecord(request)) {
        return false;
    }

    switch (request.type) {
        case 'update_source_tab':
            return (
                isSourceTabReport(request.report) &&
                isNullableString(request.timestamp)
            );
        case 'update_discord_tab':
            return isDiscordTabReport(request.report);
        case 'unregister_tab':
            return true;
        case 'video_timeupdate':
            return isNullableString(request.timestamp);
        default:
            return false;
    }
}

function isPopupRequest(request: unknown): request is PopupRequest {
    if (!isRecord(request)) {
        return false;
    }

    switch (request.type) {
        case 'get_tab_context':
        case 'get_source_tab_information':
        case 'get_discord_tab_information':
        case 'get_playback_timestamp':
            return typeof request.tabId === 'number';
        case 'get_discord_tabs':
            return true;
        case 'start_sync':
        case 'stop_sync':
            return (
                typeof request.sourceTabId === 'number' &&
                typeof request.discordTabId === 'number'
            );
        case 'update_options':
            return (
                typeof request.sourceTabId === 'number' &&
                isRecord(request.options)
            );
        default:
            return false;
    }
}

/**
 * Which popup mode a tab should use. Deliberately based on the tab's URL and
 * not on the registry: a tab whose content script never loaded still has to be
 * recognised, so that the popup can report it cannot reach the tab.
 */
async function resolveTabContext(tabId: number): Promise<TabContext> {
    try {
        const { url } = await chrome.tabs.get(tabId);

        if (url) {
            const { hostname } = new URL(url);
            const source = findSourceForHostname(hostname);

            if (source) {
                return { type: source };
            }

            if (
                hostname === 'discord.com' ||
                hostname.endsWith('.discord.com')
            ) {
                return { type: 'discord' };
            }
        }
    } catch {
        // A missing tab or an unparseable URL means "not ours".
    }

    return { type: 'other' };
}

async function forwardTimestamp(
    sourceTabId: number,
    timestamp: string | null,
): Promise<void> {
    if (timestamp === null) {
        return;
    }

    const targetTabIds = await getActiveSyncTargetTabIds(sourceTabId);

    await Promise.all(
        targetTabIds.map((tabId) =>
            chrome.tabs
                .sendMessage(tabId, {
                    type: 'video_timeupdate',
                    timestamp,
                } satisfies DiscordContentMessage)
                .catch(() => undefined),
        ),
    );
}

async function handleContentMessage(
    request: ContentMessage,
    sender: chrome.runtime.MessageSender,
): Promise<void> {
    const tabId = sender.tab?.id;

    if (typeof tabId !== 'number') {
        return;
    }

    switch (request.type) {
        case 'update_source_tab':
            await recordSourceTab(tabId, request.report, request.timestamp);
            return;
        case 'update_discord_tab':
            await recordDiscordTab(tabId, request.report);
            return;
        case 'unregister_tab':
            await unregisterTab(tabId);
            return;
        case 'video_timeupdate':
            await recordTimestamp(tabId, request.timestamp);
            await forwardTimestamp(tabId, request.timestamp);
            return;
    }
}

/**
 * Applies an option change and returns the recalculated timestamp.
 *
 * The content script reports its new timestamp in the response rather than in a
 * follow-up message: an ack and a separate message travel on different
 * channels, so only the response guarantees the cache is current by the time
 * the popup refetches.
 */
async function handleUpdateOptions(
    sourceTabId: number,
    options: Partial<SyncOptions>,
): Promise<PlaybackTimestampResponse> {
    const offset = await updateOptions(sourceTabId, options);

    if (offset === null) {
        return { timestamp: null };
    }

    if (options.offset === undefined) {
        return { timestamp: await getPlaybackTimestamp(sourceTabId) };
    }

    try {
        const response = await chrome.tabs.sendMessage<
            SourceContentMessage,
            SourceOptionsResponse
        >(sourceTabId, { type: 'options_updated', offset });
        const timestamp = response?.timestamp ?? null;

        await recordTimestamp(sourceTabId, timestamp);

        return { timestamp };
    } catch {
        return { timestamp: await getPlaybackTimestamp(sourceTabId) };
    }
}

async function handlePopupRequest(request: PopupRequest): Promise<unknown> {
    switch (request.type) {
        case 'get_tab_context':
            return resolveTabContext(request.tabId);
        case 'get_source_tab_information':
            return getSourceTabInformation(request.tabId);
        case 'get_discord_tabs':
            return getDiscordTabs();
        case 'get_discord_tab_information':
            return getDiscordTabInformation(request.tabId);
        case 'get_playback_timestamp':
            return {
                timestamp: await getPlaybackTimestamp(request.tabId),
            } satisfies PlaybackTimestampResponse;
        case 'start_sync':
            return startSync(request.sourceTabId, request.discordTabId);
        case 'stop_sync':
            await stopSync(request.sourceTabId, request.discordTabId);

            return null;
        case 'update_options':
            return handleUpdateOptions(request.sourceTabId, request.options);
    }
}

function run() {
    console.log('Discord Time Machine VOD service worker is running.');

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Fire-and-forget reports: do not keep the channel open.
        if (isContentMessage(request)) {
            void handleContentMessage(request, sender);

            return false;
        }

        // Requests must always answer, or the caller waits until the port
        // closes on it.
        if (isPopupRequest(request)) {
            void handlePopupRequest(request)
                .then((response) => sendResponse(response ?? null))
                .catch((error: unknown) => {
                    console.error('Failed to handle a popup request', error);
                    sendResponse(null);
                });

            return true;
        }

        return false;
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
        void unregisterTab(tabId);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            void unregisterTab(tabId);
        }
    });
}

run();
