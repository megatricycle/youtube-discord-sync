import {
    DiscordTab,
    DiscordTabInformation,
    YouTubeTabInformationInvalid,
    YouTubeTabInformationValid,
} from '../types';

export async function getCurrentTab() {
    return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

export async function getYouTubeTabInformation(
    tabId: NonNullable<chrome.tabs.Tab['id']>,
): Promise<YouTubeTabInformationValid | YouTubeTabInformationInvalid> {
    const response = (await chrome.tabs.sendMessage(tabId, {
        message: 'fetch_info',
    })) as Omit<
        YouTubeTabInformationValid | YouTubeTabInformationInvalid,
        'id'
    > | null;

    if (!response) {
        throw new Error('Failed to fetch tab information');
    }

    return { id: tabId, ...response };
}

export async function getDiscordTabs() {
    return await chrome.tabs.query({
        url: 'https://discord.com/*',
    });
}

export async function getDiscordTabsWithInformation() {
    const tabs = await getDiscordTabs();

    const tabsWithInfo: DiscordTab[] = tabs.map((tab) => {
        // check if we can infer the channelName and serverName from the tab's title
        let channelName = null;
        let serverName = null;
        const url = new URL(tab.url!);

        // usual channel urls
        if (/discord\.com\/channels\/\d+\/\d+/.test(url.href)) {
            [, channelName, serverName] = tab.title!.split(' | ');
        }
        // direct message urls
        else if (/discord\.com\/channels\/@me\/\d+/.test(url.href)) {
            [, channelName] = tab.title!.split(' | ');
        }

        if (channelName) {
            return {
                id: tab.id!,
                state: 'active',
                channelName,
                serverName,
                error: null,
            };
        } else {
            return {
                id: tab.id!,
                state: 'invalid',
                channelName: null,
                serverName,
                error: null,
            };
        }
    });
    return tabsWithInfo.filter((tab) => tab.state !== 'invalid');
}

export async function getDiscordTabInformation(
    tabId: NonNullable<chrome.tabs.Tab['id']>,
): Promise<DiscordTabInformation> {
    const response = (await chrome.tabs.sendMessage(tabId, {
        message: 'get_tab_information',
    })) as {
        currentSync: {
            type: 'youtube';
            tabId: number;
        } | null;
    };

    if (!response) {
        throw new Error('Failed to fetch tab information');
    }

    if (!response.currentSync) {
        return {
            id: tabId,
            currentSync: response.currentSync,
        };
    }

    // get tab information from youtube too
    const tabInformation = await getYouTubeTabInformation(
        response.currentSync.tabId,
    );

    if (!tabInformation.metadata) {
        throw new Error('A YouTube syncing tab has no metadata');
    }

    return { id: tabId, currentSync: { type: 'youtube', tabInformation } };
}
