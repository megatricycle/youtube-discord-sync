import { useEffect, useState } from 'react';

const APPEAR_DELAY_MS = 25;

type LoadingProps = {
    delay?: number; // ms
};

export function Loading({ delay = APPEAR_DELAY_MS }: LoadingProps) {
    const [isVisible, setIsVisible] = useState(delay <= 0);

    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), delay);

        return () => clearTimeout(timer);
    }, [delay]);

    if (!isVisible) {
        return null;
    }

    return (
        <div
            className="flex items-center justify-center gap-1 py-6"
            role="status"
            aria-label="Loading"
        >
            {[0, 150, 300].map((delay) => (
                <span
                    key={delay}
                    className="size-2 rounded-full bg-slate-100 animate-dot"
                    style={{ animationDelay: `${delay}ms` }}
                />
            ))}
        </div>
    );
}
