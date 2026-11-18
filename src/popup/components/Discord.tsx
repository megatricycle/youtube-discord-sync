import { useQuery } from '@tanstack/react-query';
import { DiscordTabInformation } from '../../types';
import { getCurrentTab, getDiscordTabInformation } from '../utils/chrome';
import { DiscordSyncSelector } from './DiscordSyncSelector';
import { ErrorPage } from './ErrorPage';
import { Loading } from './Loading';
import { YouTubeSync } from './YouTubeSync';

const RETRY = { retry: 15, retryDelay: 250 } as const;

export function Discord() {
    const {
        data: tabInformation,
        error: tabInformationError,
        isLoading: tabInformationIsLoading,
    } = useQuery<DiscordTabInformation>({
        queryKey: ['discordTabInformation'],
        queryFn: async () => {
            const currentTab = await getCurrentTab();

            return getDiscordTabInformation(currentTab.id!);
        },
        ...RETRY,
    });

    if (tabInformationError) {
        return <ErrorPage />;
    }

    if (!tabInformation || tabInformationIsLoading) {
        return <Loading />;
    }

    if (tabInformation.currentSync?.type === 'youtube') {
        return (
            <div>
                <YouTubeSync tab={tabInformation.currentSync.tabInformation} />
                <hr className="mb-4" />
                <p className="text-center text-xs">
                    To change settings or cancel sync, open this extension in
                    the syncing YouTube tab.
                </p>
            </div>
        );
    }

    return <DiscordSyncSelector />;
}
