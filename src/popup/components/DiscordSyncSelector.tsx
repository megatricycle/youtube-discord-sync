import { useState } from 'react';
import type { SyncOption } from '../../types';
import { SOURCE_DESCRIPTORS } from '../utils/sources';
import { DiscordYouTubeSyncPage } from './DiscordYouTubeSyncPage';
import { SyncItem } from './SyncItem';
import { SyncWithHeader } from './SyncWithHeader';

const sourceOptions = (
    Object.keys(SOURCE_DESCRIPTORS) as Array<keyof typeof SOURCE_DESCRIPTORS>
).map((id) => ({ id, ...SOURCE_DESCRIPTORS[id] }));

export function DiscordSyncSelector() {
    const [selectedOption, setSelectedOption] = useState<SyncOption | null>(
        null,
    );

    function handleOptionChange(option: SyncOption) {
        setSelectedOption(option);
    }

    function handlePageBack() {
        setSelectedOption(null);
    }

    if (selectedOption === 'youtube') {
        return <DiscordYouTubeSyncPage onBack={handlePageBack} />;
    }

    if (selectedOption === 'timestamp') {
        // @TODO:
        return (
            <div>
                <p>This feature is not yet implemented.</p>
            </div>
        );
    }

    return (
        <div>
            <SyncWithHeader />
            <ul className="grid grid-cols-3 gap-1 m-auto">
                {sourceOptions.map((option) => (
                    <li
                        key={option.id}
                        className="flex justify-center items-center"
                    >
                        <SyncItem
                            icon={option.icon}
                            label={option.label}
                            onClick={() => handleOptionChange(option.id)}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
