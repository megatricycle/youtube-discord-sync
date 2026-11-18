import { useEffect, useState } from 'react';
import type { SourceId } from '../../types';
import { getCurrentTab, getTabContext } from '../utils/chrome';
import { Default } from './Default';
import { Discord } from './Discord';
import { Loading } from './Loading';
import { YouTube } from './YouTube';

function App() {
    const [mode, setMode] = useState<SourceId | 'discord' | 'default' | null>(
        null,
    );

    function startup() {
        async function run() {
            const tab = await getCurrentTab();

            if (typeof tab?.id !== 'number') {
                setMode('default');

                return;
            }

            // The background decides from the tab's URL, not from whether a
            // content script registered, so an unreachable tab still reaches
            // the page that reports the problem.
            const { type } = await getTabContext(tab.id);

            // A source id routes to that source's own page; everything else is
            // the Discord target or a page the extension does not handle.
            setMode(type === 'other' ? 'default' : type);
        }

        run();
    }

    useEffect(startup, []);

    if (mode === null) {
        return <Loading />;
    }

    if (mode === 'youtube') {
        return <YouTube />;
    }

    if (mode === 'discord') {
        return <Discord />;
    }

    return <Default />;
}

export default App;
