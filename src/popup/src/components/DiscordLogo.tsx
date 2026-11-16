import { FaDiscord } from 'react-icons/fa';

export function DiscordLogo() {
    return (
        // background color is Discord's hexcode
        <div className="bg-[#5865F2] rounded-full size-4.5 flex justify-center items-center">
            <FaDiscord />
        </div>
    );
}
