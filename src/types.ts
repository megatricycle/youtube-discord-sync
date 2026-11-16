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

export type YouTubeSyncOptions = {
    offset: number;
    isPaused: boolean;
    isPremiere: boolean;
};

export type YouTubeTabInformation = {
    id: number;
    metadata: YouTubeMetadata | null;
    activeSyncs: number[];
    options: YouTubeSyncOptions;
};

export type YouTubeTabInformationValid = Omit<
    YouTubeTabInformation,
    'metadata'
> & {
    metadata: YouTubeMetadata;
};

export type YouTubeTabInformationInvalid = Omit<
    YouTubeTabInformation,
    'metadata'
> & {
    metadata: null;
};

export type BackgroundMessage =
    | { message: 'video_timeupdate'; tabId: number; timestamp: string }
    | { message: 'sync_stop'; tabId: number }
    | { message: 'popup_opened'; tabId: number };

export type YouTubeBackgroundMessage =
    | { message: 'video_timeupdate'; tabId: number; timestamp: string | null }
    | { message: 'sync_stop'; tabId: number };

export type YouTubeMessage =
    | { message: 'fetch_info' }
    | { message: 'sync_start'; tabId: number }
    | { message: 'sync_stop'; tabId: number }
    | { message: 'sync_option_update'; options: Partial<YouTubeSyncOptions> }
    | { message: 'fetch_timestamp' };

export type DiscordSyncStopMessage = { message: 'sync_stop'; tabId: number };

export type DiscordMessage =
    | { message: 'video_timeupdate'; timestamp: string }
    | { message: 'sync_start'; tabId: number }
    | { message: 'sync_stop'; tabId: number }
    | { message: 'get_tab_information' };

export type CurrentSync = { type: 'youtube'; tabId: number } | null;

export type YouTubeTabInformationResponse = Omit<YouTubeTabInformation, 'id'>;

export type YouTubeTimestampResponse = { timestamp: string | null };

export type DiscordTabInformationResponse = { currentSync: CurrentSync };

export type DiscordTab = {
    id: number;
    error: string | null;
} & (
    | {
          state: 'active'; // available for syncing, or is already syncing
          serverName: string | null;
          channelName: string;
      }
    | {
          state: 'error';
          serverName: string | null;
          channelName: string | null;
      }
    | {
          state: 'invalid'; // not in a syncable channel page
          serverName: string | null;
          channelName: null;
      }
);

export type SyncOption = 'youtube' | 'timestamp';

export type DiscordYouTubeSync = {
    type: 'youtube';
    tabInformation: YouTubeTabInformationValid;
};

export type DiscordTabInformation = {
    id: number;
    currentSync: DiscordYouTubeSync | null;
};
