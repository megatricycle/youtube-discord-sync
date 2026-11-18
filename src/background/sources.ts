import type { SourceId } from '../types';

/**
 * The hostnames each source content script runs on.
 *
 * This is the single place to register a new source in the background: adding a
 * member to `SourceId` breaks this table until the new source is listed, which
 * keeps the host matching and the message validation in step.
 */
const SOURCE_HOSTS: Record<SourceId, readonly string[]> = {
    youtube: ['youtube.com'],
};

/**
 * How each source names the item a tab is showing. Two reports with the same
 * key describe the same syncable item, which lets the registry tell a page
 * that merely re-rendered from a tab that moved on to another video - the
 * latter has to tear an existing sync down. `null` means the URL names no
 * item (a source page that is not showing a syncable video).
 *
 * This lives here, next to `SOURCE_HOSTS`, so the registry stays free of
 * source-specific URL knowledge.
 */
const SOURCE_TAB_KEYS: Record<SourceId, (url: URL) => string | null> = {
    youtube: (url) => {
        const liveMatch = url.pathname.match(/^\/live\/([^/]+)/);

        return liveMatch?.[1] ?? url.searchParams.get('v');
    },
};

export const SOURCE_IDS = Object.keys(SOURCE_HOSTS) as SourceId[];

export function isSourceId(value: unknown): value is SourceId {
    return typeof value === 'string' && SOURCE_IDS.includes(value as SourceId);
}

function matchesHost(hostname: string, sourceId: SourceId): boolean {
    return SOURCE_HOSTS[sourceId].some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
}

/** The source whose hostname matches, if any. */
export function findSourceForHostname(hostname: string): SourceId | null {
    return (
        SOURCE_IDS.find((sourceId) => matchesHost(hostname, sourceId)) ?? null
    );
}

/** The item a source tab URL points at, or `null` if it names no item. */
export function sourceTabKey(rawUrl: string): string | null {
    try {
        const url = new URL(rawUrl);
        const sourceId = findSourceForHostname(url.hostname);

        return sourceId === null ? null : SOURCE_TAB_KEYS[sourceId](url);
    } catch {
        return null;
    }
}
