import { DiscordLogo } from './DiscordLogo';

export function SyncWithHeader() {
    return (
        <div className="font-bold mb-4 flex items-center gap-x-2">
            <DiscordLogo />
            <span>Sync with</span>
        </div>
    );
}
