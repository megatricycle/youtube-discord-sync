import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    DiscordTab,
    SyncOptions,
    YouTubeTabInformationInvalid,
    YouTubeTabInformationValid,
} from '../../types';
import {
    getCurrentTab,
    getDiscordTabs,
    getSourceTabInformation,
    startSync,
    stopSync,
    updateSyncOptions,
} from '../utils/chrome';
import { DiscordItem } from './DiscordItem';
import { Loading } from './Loading';
import { SyncWithHeader } from './SyncWithHeader';
import { YouTubeSync } from './YouTubeSync';

const RETRY = { retry: 15, retryDelay: 250 } as const;

const TAB_INFORMATION_REFETCH_MS = 1000;

export function YouTube() {
    const queryClient = useQueryClient();

    const {
        data: tabInformation,
        error: tabInformationError,
        isLoading: tabInformationIsLoading,
    } = useQuery<YouTubeTabInformationValid | YouTubeTabInformationInvalid>({
        queryKey: ['youTubeTabInformation'],
        queryFn: async () => {
            const currentTab = await getCurrentTab();

            return getSourceTabInformation(currentTab.id!);
        },
        ...RETRY,
        refetchInterval: TAB_INFORMATION_REFETCH_MS,
    });

    const { data: discordTabs, isLoading: discordTabsIsLoading } = useQuery<
        DiscordTab[]
    >({
        queryKey: ['discordTabs'],
        queryFn: getDiscordTabs,
        ...RETRY,
    });

    function refresh() {
        queryClient.invalidateQueries({
            queryKey: ['youTubeTabInformation'],
        });
        queryClient.invalidateQueries({ queryKey: ['playbackTimestamp'] });
        queryClient.invalidateQueries({ queryKey: ['discordTabs'] });
    }

    function handleOptionChange(options: Partial<SyncOptions>) {
        if (!tabInformation) {
            return;
        }

        void updateSyncOptions(tabInformation.id, options).then(refresh);
    }

    function handleSync(tabId: number) {
        if (!tabInformation) {
            return;
        }

        void startSync(tabInformation.id, tabId).then(refresh);
    }

    function handleUnsync(tabId: number) {
        if (!tabInformation) {
            return;
        }

        void stopSync(tabInformation.id, tabId).then(refresh);
    }

    if (tabInformationError) {
        // @TODO:
        console.error(tabInformationError);

        return <div>Something went wrong. Please refresh the page.</div>;
    }

    const isLoading = tabInformationIsLoading || discordTabsIsLoading;

    if (
        isLoading ||
        !tabInformation ||
        !discordTabs ||
        tabInformation.status === 'pending'
    ) {
        return <Loading />;
    }

    if (tabInformation.status === 'error') {
        return <div>Something went wrong. Please refresh the page.</div>;
    }

    if (!hasMetadata(tabInformation)) {
        return <div>Go to a YouTube livestream VOD to start syncing</div>;
    }

    return (
        <div>
            <YouTubeSync
                tab={tabInformation}
                onOptionChange={handleOptionChange}
            />
            <hr className="my-4" />
            <SyncWithHeader />
            <div className="font-bold flex flex-col space-y-1 -mx-4">
                {discordTabs.length ? (
                    discordTabs.map((discordTab) => (
                        <DiscordItem
                            key={discordTab.id}
                            tab={discordTab}
                            syncing={
                                tabInformation.syncingDiscordTabIds.includes(
                                    discordTab.id,
                                ) && discordTab.status === 'active'
                            }
                            paused={tabInformation.options.isPaused}
                            syncingElsewhere={
                                discordTab.syncingSourceTabId !== null &&
                                discordTab.syncingSourceTabId !==
                                    tabInformation.id
                            }
                            onSync={() => handleSync(discordTab.id)}
                            onUnsync={() => handleUnsync(discordTab.id)}
                        />
                    ))
                ) : (
                    <div className="pl-4 text-white/50">
                        No Discord tabs open
                    </div>
                )}
            </div>
        </div>
    );
}

function hasMetadata(
    tabInformation: YouTubeTabInformationValid | YouTubeTabInformationInvalid,
): tabInformation is YouTubeTabInformationValid {
    return tabInformation.metadata !== null;
}
