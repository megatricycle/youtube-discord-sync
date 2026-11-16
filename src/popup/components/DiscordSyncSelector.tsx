import { useState } from 'react';
import { IconType } from 'react-icons';
import { FaYoutube } from 'react-icons/fa';
import { SyncOption } from '../../types';
import { DiscordYouTubeSyncPage } from './DiscordYouTubeSyncPage';
import { SyncItem } from './SyncItem';
import { SyncWithHeader } from './SyncWithHeader';

type SyncOptionItem = {
    id: SyncOption;
    label: string;
    icon: IconType;
    disabled?: boolean;
};

const options: SyncOptionItem[] = [
    {
        id: 'youtube',
        label: 'YouTube',
        icon: FaYoutube,
    },
];

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
                {options.map((option) => (
                    <li
                        key={option.id}
                        className="flex justify-center items-center"
                    >
                        <SyncItem
                            icon={option.icon}
                            label={option.label}
                            onClick={() => handleOptionChange(option.id)}
                            disabled={option.disabled}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
