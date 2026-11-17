import type { IconType } from 'react-icons';
import { FaYoutube } from 'react-icons/fa';
import type { SourceId } from '../../types';

export type SourceDescriptor = {
    label: string;
    icon: IconType;
};

/**
 * Presentational details for each source in the popup. Adding a member to
 * `SourceId` breaks this table until the new source is described here.
 */
export const SOURCE_DESCRIPTORS: Record<SourceId, SourceDescriptor> = {
    youtube: {
        label: 'YouTube',
        icon: FaYoutube,
    },
};
