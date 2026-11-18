import { useQuery } from '@tanstack/react-query';
import { FaPause, FaPlay } from 'react-icons/fa';
import type { SyncOptions, YouTubeTabInformationValid } from '../../types';
import { getPlaybackTimestamp } from '../utils/chrome';
import { ClearButton } from './ClearButton';

type YouTubeSyncProps = {
    tab: YouTubeTabInformationValid;
    onOptionChange?: (option: Partial<SyncOptions>) => void;
};

export function YouTubeSync({ tab, onOptionChange }: YouTubeSyncProps) {
    // The background caches the timestamp reported by the content script, so
    // this is a registry read rather than a message to another tab.
    const { data: timestamp } = useQuery({
        queryKey: ['playbackTimestamp', tab.id],
        queryFn: () => getPlaybackTimestamp(tab.id),
        refetchInterval: 500,
        retry: false,
    });

    const currentTimestamp = timestamp ? new Date(timestamp) : null;

    function handleTogglePause() {
        if (!onOptionChange) {
            return;
        }

        onOptionChange({ isPaused: !tab.options.isPaused });
    }

    function handleOffsetChange(offset: number) {
        if (!onOptionChange) {
            return;
        }

        onOptionChange({ offset });
    }

    const readonly = !onOptionChange;

    return (
        <div>
            <div
                className="-mx-4 -mt-4 w-[calc(100%+2rem)] h-40 bg-gray-700 bg-cover bg-center relative mb-4"
                style={{
                    backgroundImage: `url(${tab.metadata.thumbnail})`,
                }}
            >
                <div className="w-full h-full bg-[rgba(0,0,0,0.75)] absolute top-0 left-0 p-4 flex flex-col justify-between pb-4">
                    <div className="mb-2 text-xs">
                        <p className="font-bold mb-1 line-clamp-2">
                            {tab.metadata.title}
                        </p>
                        <p className="line-clamp-2">
                            {tab.metadata.channelTitle}
                        </p>
                    </div>
                    <div className="flex justify-between items-center">
                        <div>
                            {currentTimestamp && (
                                <div className="text-xs">
                                    {currentTimestamp.toLocaleString()}
                                </div>
                            )}
                        </div>
                        {!readonly && (
                            <ClearButton
                                className="text-xl"
                                aria-label={
                                    tab.options.isPaused
                                        ? 'Resume syncing'
                                        : 'Pause syncing'
                                }
                                onClick={handleTogglePause}
                            >
                                {tab.options.isPaused ? (
                                    <FaPlay />
                                ) : (
                                    <FaPause />
                                )}
                            </ClearButton>
                        )}
                    </div>
                </div>
            </div>
            <div className="mb-4">
                <div className="flex items-center">
                    <span className="mr-2">Offset:</span>
                    {readonly ? (
                        <span>{tab.options.offset} seconds</span>
                    ) : (
                        <>
                            <input
                                className="w-15 py-1 px-2 mr-2 bg-[rgba(0,0,0,0.3)]"
                                type="number"
                                value={tab.options.offset}
                                onChange={(e) =>
                                    handleOffsetChange(parseInt(e.target.value))
                                }
                            />
                            <span> seconds</span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
