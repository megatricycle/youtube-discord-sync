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

export const SOURCE_IDS = Object.keys(SOURCE_HOSTS) as SourceId[];

export function isSourceId(value: unknown): value is SourceId {
    return typeof value === 'string' && SOURCE_IDS.includes(value as SourceId);
}

/** The source whose hostname matches, if any. */
export function findSourceForHostname(hostname: string): SourceId | null {
    for (const sourceId of SOURCE_IDS) {
        const matches = SOURCE_HOSTS[sourceId].some(
            (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );

        if (matches) {
            return sourceId;
        }
    }

    return null;
}
