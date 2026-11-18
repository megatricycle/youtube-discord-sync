/**
 * The cross-tab registry: the single source of truth for which source and
 * Discord tabs the extension can see, what state each is in, and which Discord
 * tabs are following which source tab.
 *
 * A "source" is where a timestamp comes from (ex. YouTube). Discord is always
 * the target. The registry never looks inside a source's payload, so adding a
 * source does not change this file beyond the type union it is handed.
 *
 * Content scripts in different tabs cannot talk to each other, and the popup
 * used to infer a Discord tab's identity from its title. Instead, each content
 * script reports itself here, and everything else - the background's routing
 * and the popup - reads from this state.
 */
import type {
    DiscordTab,
    DiscordTabEntry,
    DiscordTabInformation,
    DiscordTabReport,
    RegistryState,
    SourceTabEntry,
    SourceTabInformation,
    SourceTabReport,
    SyncOptions,
    TabEntry,
    TabStatus,
    YouTubeTabInformationValid,
} from '../types';
import { isSourceId, sourceTabKey } from './sources';

const REGISTRY_KEY = 'tabRegistry';

let state: RegistryState = { tabs: {}, syncSessions: {} };

/**
 * Playback timestamps change about four times a second, so they are kept in
 * memory only. They are intentionally lost on a service-worker restart: the
 * next `timeupdate` re-reports the current value within ~250ms.
 */
const latestTimestamps = new Map<number, string | null>();

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isTabStatus(value: unknown): value is TabStatus {
    return value === 'active' || value === 'invalid' || value === 'error';
}

/** Source tabs also have the `pending` bootstrap state; Discord tabs do not. */
function isSourceTabStatus(value: unknown): boolean {
    return isTabStatus(value) || value === 'pending';
}

function isTabEntry(value: unknown): value is TabEntry {
    if (!isRecord(value) || typeof value.tabId !== 'number') {
        return false;
    }

    if (!isTabStatus(value.status) || typeof value.url !== 'string') {
        return false;
    }

    if (!isNullableString(value.error)) {
        return false;
    }

    if (value.type === 'discord') {
        return (
            isNullableString(value.channelName) &&
            isNullableString(value.serverName)
        );
    }

    if (isSourceId(value.type)) {
        return (
            isSourceTabStatus(value.status) &&
            // Without this, a stored entry that lost its `metadata` key would
            // pass `metadata !== null` in the popup and render undefined.
            (value.metadata === null || isRecord(value.metadata)) &&
            typeof value.offset === 'number' &&
            typeof value.isPaused === 'boolean'
        );
    }

    return false;
}

function isRegistryState(value: unknown): value is RegistryState {
    if (!isRecord(value) || !isRecord(value.tabs)) {
        return false;
    }

    if (!isRecord(value.syncSessions)) {
        return false;
    }

    return (
        Object.values(value.tabs).every(isTabEntry) &&
        Object.values(value.syncSessions).every(
            (tabIds) =>
                Array.isArray(tabIds) &&
                tabIds.every((tabId) => typeof tabId === 'number'),
        )
    );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

async function persist(): Promise<void> {
    await chrome.storage.session.set({ [REGISTRY_KEY]: state });
}

async function tabExists(tabId: number): Promise<boolean> {
    try {
        await chrome.tabs.get(tabId);

        return true;
    } catch {
        return false;
    }
}

/** Drops entries left behind by tabs that closed while the worker was asleep. */
async function pruneDeadTabs(): Promise<void> {
    let changed = false;

    for (const [tabIdKey, entry] of Object.entries(state.tabs)) {
        if (await tabExists(entry.tabId)) {
            continue;
        }

        delete state.tabs[tabIdKey];
        dropSyncSessions(entry.tabId);
        removeDiscordTabFromSessions(entry.tabId);
        latestTimestamps.delete(entry.tabId);
        changed = true;
    }

    if (changed) {
        await persist();
    }
}

/**
 * Resolves once the stored registry has been loaded and pruned. Every read and
 * every mutation waits on it - otherwise the first popup query after a
 * service-worker restart would see an empty registry and report no open tabs.
 */
const ready: Promise<void> = chrome.storage.session
    .get(REGISTRY_KEY)
    .then((storedState) => {
        const stored = storedState[REGISTRY_KEY];

        if (isRegistryState(stored)) {
            state = stored;
        }
    })
    .then(pruneDeadTabs)
    .catch((error: unknown) => {
        console.error('Failed to load the tab registry', error);
    });

let queue: Promise<unknown> = ready;

/** Serializes read-modify-write cycles so concurrent reports cannot be lost. */
async function mutate<T>(update: () => T): Promise<T> {
    await ready;

    let result!: T;
    const operation = queue.then(async () => {
        result = update();
        await persist();
    });

    // Keep the chain alive even if a single write fails.
    queue = operation.catch(() => undefined);
    await operation;

    return result;
}

/* -------------------------------------------------------------------------- */
/* Entry lookups                                                              */
/* -------------------------------------------------------------------------- */

function sourceEntry(tabId: number): SourceTabEntry | null {
    const entry = state.tabs[String(tabId)];

    return entry && entry.type !== 'discord' ? entry : null;
}

function discordEntry(tabId: number): DiscordTabEntry | null {
    const entry = state.tabs[String(tabId)];

    return entry?.type === 'discord' ? entry : null;
}

/** `/channels/{guild}/{channel}` - a thread id is not part of the identity. */
function channelKey(url: string): string {
    try {
        const { pathname } = new URL(url);
        const match = pathname.match(/^\/channels\/([^/]+)\/([^/]+)/);

        return match ? `${match[1]}/${match[2]}` : pathname;
    } catch {
        return url;
    }
}

function findSourceTabIdForDiscordTab(discordTabId: number): number | null {
    for (const [sourceTabIdKey, discordTabIds] of Object.entries(
        state.syncSessions,
    )) {
        if (discordTabIds.includes(discordTabId)) {
            return Number(sourceTabIdKey);
        }
    }

    return null;
}

/* -------------------------------------------------------------------------- */
/* Sync session bookkeeping (in-memory, called inside `mutate`)                */
/* -------------------------------------------------------------------------- */

function dropSyncSessions(sourceTabId: number): void {
    delete state.syncSessions[String(sourceTabId)];
    latestTimestamps.delete(sourceTabId);
}

function removeDiscordTabFromSessions(discordTabId: number): void {
    for (const [sourceTabIdKey, discordTabIds] of Object.entries(
        state.syncSessions,
    )) {
        const remaining = discordTabIds.filter(
            (tabId) => tabId !== discordTabId,
        );

        if (remaining.length === discordTabIds.length) {
            continue;
        }

        if (remaining.length) {
            state.syncSessions[sourceTabIdKey] = remaining;
        } else {
            delete state.syncSessions[sourceTabIdKey];
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* -------------------------------------------------------------------------- */

export async function recordSourceTab(
    tabId: number,
    report: SourceTabReport,
    timestamp: string | null,
): Promise<void> {
    await mutate(() => {
        const existing = sourceEntry(tabId);
        const wasActive = existing?.status === 'active';
        const previousKey =
            existing === null ? null : sourceTabKey(existing.url);
        const nextKey = sourceTabKey(report.url);

        state.tabs[String(tabId)] = {
            ...report,
            tabId,
            isPaused: existing?.isPaused ?? false,
        };

        latestTimestamps.set(tabId, timestamp);

        // Only the active -> unusable edge tears the pairing down. A tab that
        // keeps reporting "invalid" must not drop twice, and `pending` is a
        // bootstrap state: a watch page that is still rendering would
        // otherwise drop its sync on every re-render.
        const leftActive =
            wasActive &&
            (report.status === 'invalid' || report.status === 'error');

        // A tab can also move to another video without ever leaving `active`,
        // and a `pending` report carries no metadata to compare, so identity
        // comes from the URL. Two reports that name no item are not a change.
        const changedVideo =
            previousKey !== null && nextKey !== null && previousKey !== nextKey;

        if (leftActive || changedVideo) {
            dropSyncSessions(tabId);
        }
    });
}

export async function recordDiscordTab(
    tabId: number,
    report: DiscordTabReport,
): Promise<void> {
    await mutate(() => {
        const existing = discordEntry(tabId);

        state.tabs[String(tabId)] = {
            ...report,
            type: 'discord',
            tabId,
        };

        const changedChannel =
            existing !== null &&
            channelKey(existing.url) !== channelKey(report.url);

        if (changedChannel || report.status !== 'active') {
            removeDiscordTabFromSessions(tabId);
        }
    });
}

/** In-memory only, so a report cannot resurrect a dropped session's timestamp. */
export async function recordTimestamp(
    tabId: number,
    timestamp: string | null,
): Promise<void> {
    await ready;

    if (sourceEntry(tabId)?.status !== 'active') {
        return;
    }

    latestTimestamps.set(tabId, timestamp);
}

export async function unregisterTab(tabId: number): Promise<void> {
    await mutate(() => {
        if (!state.tabs[String(tabId)]) {
            return;
        }

        delete state.tabs[String(tabId)];
        latestTimestamps.delete(tabId);
        dropSyncSessions(tabId);
        removeDiscordTabFromSessions(tabId);
    });
}

export async function startSync(
    sourceTabId: number,
    discordTabId: number,
): Promise<boolean> {
    return mutate(() => {
        const source = sourceEntry(sourceTabId);

        if (source?.status !== 'active') {
            return false;
        }

        if (discordEntry(discordTabId)?.status !== 'active') {
            return false;
        }

        const existingSourceTabId = findSourceTabIdForDiscordTab(discordTabId);

        if (
            existingSourceTabId !== null &&
            existingSourceTabId !== sourceTabId
        ) {
            return false;
        }

        removeDiscordTabFromSessions(discordTabId);

        const key = String(sourceTabId);
        const targetTabIds = state.syncSessions[key] ?? [];

        if (!targetTabIds.includes(discordTabId)) {
            targetTabIds.push(discordTabId);
        }

        state.syncSessions[key] = targetTabIds;

        return true;
    });
}

export async function stopSync(
    sourceTabId: number,
    discordTabId: number,
): Promise<void> {
    await mutate(() => {
        const key = String(sourceTabId);
        const targetTabIds = state.syncSessions[key];

        if (!targetTabIds) {
            return;
        }

        const remaining = targetTabIds.filter(
            (tabId) => tabId !== discordTabId,
        );

        if (remaining.length) {
            state.syncSessions[key] = remaining;
        } else {
            delete state.syncSessions[key];
        }
    });
}

/** Returns the offset the content script should be using, if it is known. */
export async function updateOptions(
    sourceTabId: number,
    options: Partial<SyncOptions>,
): Promise<number | null> {
    return mutate(() => {
        const entry = sourceEntry(sourceTabId);

        if (!entry) {
            return null;
        }

        if (options.isPaused !== undefined) {
            entry.isPaused = options.isPaused;
        }

        if (options.offset !== undefined) {
            entry.offset = options.offset;
        }

        return entry.offset;
    });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

function hasMetadata(
    tabInformation: SourceTabInformation,
): tabInformation is YouTubeTabInformationValid {
    return tabInformation.metadata !== null;
}

export async function getSourceTabInformation(
    tabId: number,
): Promise<SourceTabInformation | null> {
    await ready;

    const entry = sourceEntry(tabId);

    if (!entry) {
        return null;
    }

    return {
        id: tabId,
        status: entry.status,
        error: entry.error,
        metadata: entry.metadata,
        syncingDiscordTabIds: [...(state.syncSessions[String(tabId)] ?? [])],
        options: { offset: entry.offset, isPaused: entry.isPaused },
    };
}

export async function getDiscordTabs(): Promise<DiscordTab[]> {
    await ready;

    return Object.values(state.tabs)
        .filter((entry): entry is DiscordTabEntry => entry.type === 'discord')
        .filter((entry) => entry.status === 'active' && entry.channelName)
        .map((entry) => ({
            id: entry.tabId,
            status: 'active',
            error: entry.error,
            channelName: entry.channelName as string,
            serverName: entry.serverName,
            syncingSourceTabId: findSourceTabIdForDiscordTab(entry.tabId),
        }));
}

export async function getDiscordTabInformation(
    tabId: number,
): Promise<DiscordTabInformation | null> {
    await ready;

    if (!discordEntry(tabId)) {
        return null;
    }

    const sourceTabId = findSourceTabIdForDiscordTab(tabId);
    const source = sourceTabId === null ? null : sourceEntry(sourceTabId);

    if (sourceTabId === null || !source) {
        return { id: tabId, currentSync: null };
    }

    const tabInformation = await getSourceTabInformation(sourceTabId);

    if (!tabInformation || !hasMetadata(tabInformation)) {
        return { id: tabId, currentSync: null };
    }

    return {
        id: tabId,
        currentSync: { type: source.type, tabInformation },
    };
}

/** Discord tabs that should follow this source tab right now. */
export async function getActiveSyncTargetTabIds(
    sourceTabId: number,
): Promise<number[]> {
    await ready;

    const entry = sourceEntry(sourceTabId);

    if (entry?.status !== 'active' || entry.isPaused) {
        return [];
    }

    return [...(state.syncSessions[String(sourceTabId)] ?? [])];
}

export async function getPlaybackTimestamp(
    tabId: number,
): Promise<string | null> {
    await ready;

    return latestTimestamps.get(tabId) ?? null;
}
