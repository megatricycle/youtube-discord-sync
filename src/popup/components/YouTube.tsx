import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    DiscordTab,
    YouTubeSyncOptions,
    YouTubeTabInformationInvalid,
    YouTubeTabInformationValid,
} from '../types';
import {
    getCurrentTab,
    getDiscordTabsWithInformation,
    getYouTubeTabInformation,
} from '../utils/chrome';
import { DiscordItem } from './DiscordItem';
import { SyncWithHeader } from './SyncWithHeader';
import { YouTubeSync } from './YouTubeSync';

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

            return getYouTubeTabInformation(currentTab.id!);
        },
    });

    const { data: discordTabs, isLoading: discordTabsIsLoading } = useQuery<
        DiscordTab[]
    >({
        queryKey: ['discordTabs'],
        queryFn: getDiscordTabsWithInformation,
    });

    function handleOptionChange(options: Partial<YouTubeSyncOptions>) {
        if (!tabInformation) return;

        chrome.tabs.sendMessage(tabInformation.id, {
            message: 'sync_option_update',
            options,
        });

        queryClient.invalidateQueries({
            queryKey: ['youTubeTabInformation'],
        });
    }

    function handleSync(tabId: number) {
        if (!tabInformation) {
            return;
        }

        chrome.tabs.sendMessage(tabInformation.id, {
            message: 'sync_start',
            tabId,
        });
        chrome.tabs.sendMessage(tabId, {
            message: 'sync_start',
            tabId: tabInformation.id,
        });

        queryClient.invalidateQueries({
            queryKey: ['youTubeTabInformation'],
        });
    }

    function handleUnsync(tabId: number) {
        if (!tabInformation) {
            return;
        }

        // to youtube tab
        chrome.tabs.sendMessage(tabInformation.id, {
            message: 'sync_stop',
            tabId,
        });

        // to discord tab
        chrome.tabs.sendMessage(tabId, {
            message: 'sync_stop',
            tabId: tabInformation.id,
        });

        // to background
        chrome.runtime.sendMessage({
            message: 'sync_stop',
            tabId,
        });

        queryClient.invalidateQueries({
            queryKey: ['youTubeTabInformation'],
        });
    }

    if (tabInformationError) {
        // @TODO:
        return <div>Something went wrong. Please refresh the page.</div>;
    }

    const isLoading = tabInformationIsLoading || discordTabsIsLoading;

    if (isLoading || !tabInformation || !discordTabs) {
        return <div />;
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
                                tabInformation.activeSyncs.includes(
                                    discordTab.id,
                                ) && discordTab.state === 'active'
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
