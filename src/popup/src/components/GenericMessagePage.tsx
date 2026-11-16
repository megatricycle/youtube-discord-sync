import { PropsWithChildren } from 'react';
import { IconType } from 'react-icons';
import { Button } from './Button';

type GenericMessagePageProps = PropsWithChildren<{
    icon: IconType;
    onBack?: () => void;
}>;

export function GenericMessagePage({
    icon: Icon,
    onBack,
    children,
}: GenericMessagePageProps) {
    const hasButtons = !!onBack;

    return (
        <div className="flex flex-col justify-center items-center gap-6 py-6">
            {<Icon size={64} />}
            <div className="text-center">{children}</div>
            {hasButtons && (
                <div className="flex justify-center gap-4">
                    {onBack && <Button onClick={onBack}>Go back</Button>}
                </div>
            )}
        </div>
    );
}
