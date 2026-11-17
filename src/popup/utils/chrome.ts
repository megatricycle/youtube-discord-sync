import type {
    DiscordTab,
    DiscordTabInformation,
    PlaybackTimestampResponse,
    PopupRequest,
    SourceTabInformation,
    SyncOptions,
    TabContext,
    YouTubeTabInformationInvalid,
    YouTubeTabInformationValid,
} from '../../types';

export async function getCurrentTab() {
    return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

/**
 * The background is the only messaging endpoint: the popup never talks to a
 * content script directly.
 */
async function sendRequest<T>(request: PopupRequest): Promise<T | null> {
    const response = await chrome.runtime.sendMessage(request);

    return (response ?? null) as T | null;
}

export async function getTabContext(
    tabId: NonNullable<chrome.tabs.Tab['id']>,
): Promise<TabContext> {
    const context = await sendRequest<TabContext>({
        type: 'get_tab_context',
        tabId,
    });

    return context ?? { type: 'other' };
}

/**
 * Throws when the tab is not registered, i.e. the extension cannot reach its
 * content script. Returning `null` instead would render an empty popup that
 * never explains itself.
 */
export async function getSourceTabInformation(
    tabId: NonNullable<chrome.tabs.Tab['id']>,
): Promise<YouTubeTabInformationValid | YouTubeTabInformationInvalid> {
    const tabInformation = await sendRequest<SourceTabInformation>({
        type: 'get_source_tab_information',
        tabId,
    });

    if (!tabInformation) {
        throw new Error('Failed to fetch tab information');
    }

    return tabInformation;
}

export async function getDiscordTabs(): Promise<DiscordTab[]> {
    const tabs = await sendRequest<DiscordTab[]>({ type: 'get_discord_tabs' });

    return tabs ?? [];
}

export async function getDiscordTabInformation(
    tabId: NonNullable<chrome.tabs.Tab['id']>,
): Promise<DiscordTabInformation> {
    const tabInformation = await sendRequest<DiscordTabInformation>({
        type: 'get_discord_tab_information',
        tabId,
    });

    if (!tabInformation) {
        throw new Error('Failed to fetch tab information');
    }

    return tabInformation;
}

export async function getPlaybackTimestamp(
    tabId: NonNullable<chrome.tabs.Tab['id']>,
): Promise<string | null> {
    const response = await sendRequest<PlaybackTimestampResponse>({
        type: 'get_playback_timestamp',
        tabId,
    });

    return response?.timestamp ?? null;
}

export function startSync(
    sourceTabId: number,
    discordTabId: number,
): Promise<unknown> {
    return sendRequest({ type: 'start_sync', sourceTabId, discordTabId });
}

export function stopSync(
    sourceTabId: number,
    discordTabId: number,
): Promise<unknown> {
    return sendRequest({ type: 'stop_sync', sourceTabId, discordTabId });
}

export function updateSyncOptions(
    sourceTabId: number,
    options: Partial<SyncOptions>,
): Promise<PlaybackTimestampResponse | null> {
    return sendRequest({ type: 'update_options', sourceTabId, options });
}
