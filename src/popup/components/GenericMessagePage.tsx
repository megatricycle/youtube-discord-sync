import { PropsWithChildren, ReactNode } from 'react';
import { IconType } from 'react-icons';
import { Button } from './Button';

type GenericMessagePageProps = PropsWithChildren<{
    icon: IconType | ReactNode;
    onBack?: () => void;
}>;

export function GenericMessagePage({
    icon: Icon,
    onBack,
    children,
}: GenericMessagePageProps) {
    const hasButtons = !!onBack;

    const isReactIcon = typeof Icon === 'function';

    return (
        <div className="flex flex-col justify-center items-center gap-6 py-6">
            {isReactIcon ? <Icon size={64} /> : Icon}
            <div className="text-center">{children}</div>
            {hasButtons && (
                <div className="flex justify-center gap-4">
                    {onBack && <Button onClick={onBack}>Go back</Button>}
                </div>
            )}
        </div>
    );
}
