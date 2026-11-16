import clsx from 'clsx';
import { IconType } from 'react-icons';

type SyncItemProps = {
    icon: IconType;
    label: string;
    disabled?: boolean;
    onClick?: () => void;
};

export function SyncItem({
    icon: Icon,
    label,
    disabled,
    onClick,
}: SyncItemProps) {
    return (
        <button
            className={clsx(
                'flex flex-col justify-center items-center gap-1 size-20 p-1 rounded transition-colors duration-250 ease-out',
                {
                    'opacity-50': disabled,
                    'cursor-pointer hover:bg-black/20': !disabled,
                },
            )}
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
        >
            <Icon size={24} className="mb-1" />
            <span>{label}</span>
        </button>
    );
}
