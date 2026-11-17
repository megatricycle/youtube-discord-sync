export type YouTubeMetadata = {
    id: string;
    title: string;
    thumbnail: string | null;
    channelTitle: string;
    isLivestream: boolean;
    startDateTime: Date;
    endDateTime: Date;
    isPremiere: boolean;
};

/**
 * The same metadata in a storage-friendly shape. `chrome.storage.session`
 * serializes values as JSON, so `Date` fields have to cross that boundary as
 * ISO strings.
 */
export type SerializedYouTubeMetadata = Omit<
    YouTubeMetadata,
    'startDateTime' | 'endDateTime'
> & {
    startDateTime: string;
    endDateTime: string;
};

/**
 * Where a timestamp comes from. Discord is always the target, never a source.
 * Adding a member here deliberately breaks the source tables that have to be
 * filled in for every source.
 */
export type SourceId = 'youtube';

/**
 * Playback-shift options. Every source uses both: `offset` shifts its timeline
 * when positioning Discord, `isPaused` suspends the fan-out.
 */
export type SyncOptions = {
    offset: number;
    isPaused: boolean;
};

export type TabStatus =
    /** Registered and usable for its role. */
    | 'active'
    /** Registered, but there is nothing syncable in this tab right now. */
    | 'invalid'
    /** Registered, but a step failed (e.g. unparseable metadata). */
    | 'error';

/**
 * What every source tab reports. `offset` is universal: a source with no notion
 * of an offset reports 0 and hides the control in its own popup page.
 *
 * Source-specific payload (metadata, and whatever else a source needs) goes on
 * the per-source report below, never here.
 */
export type SourceTabReportBase = {
    type: SourceId;
    url: string;
    status: TabStatus;
    error: string | null;
    offset: number;
};

/** What a YouTube tab tells the background about itself. */
export type YouTubeTabReport = SourceTabReportBase & {
    type: 'youtube';
    metadata: SerializedYouTubeMetadata | null;
};

/** Grows into a union once a second source is added. */
export type SourceTabReport = YouTubeTabReport;

/** What a Discord tab tells the background about itself. */
export type DiscordTabReport = {
    url: string;
    status: TabStatus;
    error: string | null;
    channelName: string | null;
    serverName: string | null;
};

/**
 * The content script owns `offset` because it needs it to compute timestamps.
 * The background owns `isPaused` because it decides whether to fan a timestamp
 * out to Discord.
 */
export type YouTubeTabEntry = YouTubeTabReport & {
    tabId: number;
    isPaused: boolean;
};

/** Grows into a union once a second source is added. */
export type SourceTabEntry = YouTubeTabEntry;

export type DiscordTabEntry = DiscordTabReport & {
    type: 'discord';
    tabId: number;
};

export type TabEntry = SourceTabEntry | DiscordTabEntry;

/** YouTube tab id -> Discord tab ids it is currently scrolling. */
export type SyncSessions = Record<string, number[]>;

/** The slice of registry state that survives a service worker restart. */
export type RegistryState = {
    tabs: Record<string, TabEntry>;
    syncSessions: SyncSessions;
};

/* -------------------------------------------------------------------------- */
/* Content script -> background                                                */
/* -------------------------------------------------------------------------- */

export type ContentMessage =
    | {
          type: 'update_source_tab';
          report: SourceTabReport;
          timestamp: string | null;
      }
    | { type: 'update_discord_tab'; report: DiscordTabReport }
    | { type: 'unregister_tab' }
    | { type: 'video_timeupdate'; timestamp: string | null };

/* -------------------------------------------------------------------------- */
/* Background -> content script                                                */
/* -------------------------------------------------------------------------- */

export type SourceContentMessage = {
    type: 'options_updated';
    offset: number;
};

export type SourceOptionsResponse = { timestamp: string | null };

export type DiscordContentMessage = {
    type: 'video_timeupdate';
    timestamp: string;
};

/* -------------------------------------------------------------------------- */
/* Popup <-> background                                                        */
/* -------------------------------------------------------------------------- */

export type TabContext = { type: SourceId | 'discord' | 'other' };

export type YouTubeTabInformation = {
    id: number;
    status: TabStatus;
    error: string | null;
    metadata: SerializedYouTubeMetadata | null;
    syncingDiscordTabIds: number[];
    options: SyncOptions;
};

/** Grows into a union once a second source is added. */
export type SourceTabInformation = YouTubeTabInformation;

export type YouTubeTabInformationValid = Omit<
    YouTubeTabInformation,
    'metadata'
> & {
    metadata: SerializedYouTubeMetadata;
};

export type YouTubeTabInformationInvalid = Omit<
    YouTubeTabInformation,
    'metadata'
> & {
    metadata: null;
};

export type DiscordTab = {
    id: number;
    error: string | null;
} & (
    | {
          status: 'active'; // available for syncing, or is already syncing
          serverName: string | null;
          channelName: string;
      }
    | {
          status: 'error';
          serverName: string | null;
          channelName: string | null;
      }
    | {
          status: 'invalid'; // not in a syncable channel page
          serverName: string | null;
          channelName: null;
      }
);

export type SyncOption = SourceId | 'timestamp';

export type DiscordYouTubeSync = {
    type: 'youtube';
    tabInformation: YouTubeTabInformationValid;
};

/** Grows into a union once a second source is added. */
export type DiscordSourceSync = DiscordYouTubeSync;

export type DiscordTabInformation = {
    id: number;
    currentSync: DiscordSourceSync | null;
};

export type PopupRequest =
    | { type: 'get_tab_context'; tabId: number }
    | { type: 'get_source_tab_information'; tabId: number }
    | { type: 'get_discord_tabs' }
    | { type: 'get_discord_tab_information'; tabId: number }
    | { type: 'get_playback_timestamp'; tabId: number }
    | { type: 'start_sync'; sourceTabId: number; discordTabId: number }
    | { type: 'stop_sync'; sourceTabId: number; discordTabId: number }
    | {
          type: 'update_options';
          sourceTabId: number;
          options: Partial<SyncOptions>;
      };

export type PlaybackTimestampResponse = { timestamp: string | null };
