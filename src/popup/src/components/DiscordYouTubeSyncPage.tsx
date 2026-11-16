import { FaYoutube } from 'react-icons/fa';
import { GenericMessagePage } from './GenericMessagePage';

type DiscordYouTubeSyncPageProps = {
    onBack?: () => void;
};

export function DiscordYouTubeSyncPage({
    onBack,
}: DiscordYouTubeSyncPageProps) {
    return (
        <GenericMessagePage icon={FaYoutube} onBack={onBack}>
            <p>
                To start, open this extension in a YouTube livestream VOD tab.
            </p>
        </GenericMessagePage>
    );
}
