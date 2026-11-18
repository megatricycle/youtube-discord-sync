import clsx from 'clsx';
import { FaSyncAlt } from 'react-icons/fa';
import { DiscordTab } from '../../types';

type DiscordItemProps = {
    tab: DiscordTab;
    syncing: boolean;
    paused: boolean;
    syncingElsewhere: boolean;
    onSync: () => void;
    onUnsync: () => void;
};

export function DiscordItem({
    tab,
    syncing,
    paused,
    syncingElsewhere,
    onSync,
    onUnsync,
}: DiscordItemProps) {
    const disabled = tab.status === 'error' || syncingElsewhere;

    function handleClick() {
        if (disabled) {
            return;
        }

        if (syncing) {
            onUnsync();
        } else {
            onSync();
        }
    }

    return (
        <button
            className="cursor-pointer w-full text-left px-4 py-2 flex justify-between items-center  disabled:cursor-default disabled:hover:bg-transparent disabled:[&>*:first-child]:opacity-50 hover:bg-sky-700/20 text-nowrap overflow-hidden gap-2"
            disabled={disabled}
            onClick={handleClick}
        >
            <div className="overflow-hidden text-ellipsis">
                {tab.channelName}
            </div>
            <div className="w-16 shrink-0 text-right flex justify-end">
                {syncing && (
                    <span
                        className="text-emerald-400 inline-flex items-center"
                        data-syncing="current"
                    >
                        <FaSyncAlt
                            aria-hidden
                            className={clsx(
                                'size-3.5',
                                !paused && 'motion-safe:animate-spin-slow',
                            )}
                        />
                        <span className="sr-only">
                            {paused
                                ? 'Syncing with this tab (paused)'
                                : 'Syncing with this tab'}
                        </span>
                    </span>
                )}
                {syncingElsewhere && (
                    <span
                        className="text-white/50 inline-flex items-center"
                        data-syncing="other"
                    >
                        <FaSyncAlt aria-hidden className="size-3.5" />
                        <span className="sr-only">Syncing in another tab</span>
                    </span>
                )}
            </div>
        </button>
    );
}
