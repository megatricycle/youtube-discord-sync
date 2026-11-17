import type { BackgroundMessage, DiscordMessage } from '../types';

const SYNC_RELATIONSHIPS_KEY = 'syncRelationships';
type SyncRelationships = Record<string, number[]>;

let syncRelationships: SyncRelationships = {};
const syncRelationshipsReady = chrome.storage.session
    .get(SYNC_RELATIONSHIPS_KEY)
    .then((storedState) => {
        const storedRelationships = storedState[SYNC_RELATIONSHIPS_KEY];
        if (isSyncRelationships(storedRelationships)) {
            syncRelationships = storedRelationships;
        }
    });
let syncRelationshipQueue: Promise<unknown> = syncRelationshipsReady;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

async function handleMessage(
    request: unknown,
    sender: chrome.runtime.MessageSender,
) {
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
        } satisfies DiscordMessage);
    }

    if (
        request.message === 'sync_start' &&
        typeof request.targetTabId === 'number'
    ) {
        const sourceTabId = sender.tab?.id;
        if (typeof sourceTabId !== 'number') {
            return;
        }
        const targetTabId = request.targetTabId;
        await updateSyncRelationships((relationships) => {
            const sourceTabKey = String(sourceTabId);
            const targetTabs = relationships[sourceTabKey] ?? [];
            if (!targetTabs.includes(targetTabId)) {
                targetTabs.push(targetTabId);
            }
            relationships[sourceTabKey] = targetTabs;
        });
    }

    if (
        request.message === 'sync_stop' &&
        typeof request.targetTabId === 'number'
    ) {
        const senderTabId = sender.tab?.id;
        if (typeof senderTabId !== 'number') {
            return;
        }

        await unregisterSync(senderTabId, request.targetTabId);
        chrome.tabs.sendMessage(request.targetTabId, {
            message: 'sync_stop',
            targetTabId: senderTabId,
        } satisfies DiscordMessage);
    }
}

function isSyncRelationships(value: unknown): value is SyncRelationships {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every(
        (targetTabs) =>
            Array.isArray(targetTabs) &&
            targetTabs.every((tabId) => typeof tabId === 'number'),
    );
}

async function updateSyncRelationships<T>(
    update: (relationships: SyncRelationships) => T,
): Promise<T> {
    await syncRelationshipsReady;

    let result!: T;
    const operation = syncRelationshipQueue.then(async () => {
        result = update(syncRelationships);
        await chrome.storage.session.set({
            [SYNC_RELATIONSHIPS_KEY]: syncRelationships,
        });
    });
    syncRelationshipQueue = operation;
    await operation;
    return result;
}

async function unregisterSync(
    sourceTabId: number,
    targetTabId: number,
): Promise<void> {
    await updateSyncRelationships((relationships) => {
        const sourceTabKey = String(sourceTabId);
        const targetTabs = relationships[sourceTabKey];
        if (!targetTabs) {
            return;
        }

        const remainingTargets = targetTabs.filter(
            (existingTabId) => existingTabId !== targetTabId,
        );
        if (remainingTargets.length) {
            relationships[sourceTabKey] = remainingTargets;
        } else {
            delete relationships[sourceTabKey];
        }
    });
}

async function clearSourceTab(sourceTabId: number): Promise<void> {
    const targetTabIds = await updateSyncRelationships((relationships) => {
        const targetTabs = relationships[String(sourceTabId)] ?? [];
        delete relationships[String(sourceTabId)];
        return [...targetTabs];
    });

    await Promise.all(
        targetTabIds.map((targetTabId) =>
            sendDiscordSyncStop(targetTabId, sourceTabId),
        ),
    );
}

async function clearTargetTab(targetTabId: number): Promise<void> {
    const sourceTabIds = await updateSyncRelationships((relationships) => {
        const sourceIds: number[] = [];
        for (const [sourceTabKey, targetTabs] of Object.entries(
            relationships,
        )) {
            const remainingTargets = targetTabs.filter(
                (existingTabId) => existingTabId !== targetTabId,
            );
            if (remainingTargets.length !== targetTabs.length) {
                sourceIds.push(Number(sourceTabKey));
                if (remainingTargets.length) {
                    relationships[sourceTabKey] = remainingTargets;
                } else {
                    delete relationships[sourceTabKey];
                }
            }
        }
        return sourceIds;
    });

    await Promise.all(
        sourceTabIds.map((sourceTabId) =>
            chrome.tabs
                .sendMessage(sourceTabId, {
                    message: 'sync_stop',
                    targetTabId,
                })
                .catch(() => undefined),
        ),
    );
}

function sendDiscordSyncStop(
    targetTabId: number,
    sourceTabId: number,
): Promise<void> {
    return chrome.tabs
        .sendMessage(targetTabId, {
            message: 'sync_stop',
            targetTabId: sourceTabId,
        } satisfies DiscordMessage)
        .then(() => undefined)
        .catch(() => undefined);
}

function run() {
    console.log('Discord Time Machine VOD service worker is running.');

    chrome.runtime.onMessage.addListener((request, sender) => {
        void handleMessage(request, sender);

        return true;
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
        void clearSourceTab(tabId);
        void clearTargetTab(tabId);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            void clearSourceTab(tabId);
            void clearTargetTab(tabId);
        }
    });
}

run();
