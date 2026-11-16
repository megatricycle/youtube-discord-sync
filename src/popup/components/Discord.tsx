import { useQuery } from '@tanstack/react-query';
import { DiscordTabInformation } from '../../types';
import { getCurrentTab, getDiscordTabInformation } from '../utils/chrome';
import { DiscordSyncSelector } from './DiscordSyncSelector';
import { YouTubeSync } from './YouTubeSync';

export function Discord() {
    const {
        data: tabInformation,
        error: tabInformationError,
        isLoading: tabInformationIsLoading,
    } = useQuery<DiscordTabInformation | null>({
        queryKey: ['discordTabInformation'],
        queryFn: async () => {
            const currentTab = await getCurrentTab();

            return getDiscordTabInformation(currentTab.id!);
        },
    });

    if (tabInformationError) {
        // @TODO:
        console.error(tabInformationError);

        return <div>Something went wrong. Please refresh the page.</div>;
    }

    if (!tabInformation || tabInformationIsLoading) {
        return <div />;
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
