import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Worker } from 'playwright';
import { afterEach, expect, test } from 'vitest';

type ExtensionChromeApi = {
    tabs: {
        create(properties: { url: string; active: boolean }): Promise<unknown>;
        query(queryInfo: { url: string }): Promise<Array<{ id?: number }>>;
        sendMessage<T>(tabId: number, message: { message: string }): Promise<T>;
    };
    runtime: { getURL(path: string): string };
};

const youtubeFixture = readFileSync(
    new URL('../fixtures/youtube.html', import.meta.url),
    'utf8',
);
const discordFixture = readFileSync(
    new URL('../fixtures/discord.html', import.meta.url),
    'utf8',
);

let context: BrowserContext | undefined;
let userDataDir: string | undefined;

afterEach(async () => {
    await context?.close();
    context = undefined;

    if (userDataDir) {
        rmSync(userDataDir, { recursive: true, force: true });
        userDataDir = undefined;
    }
});

test('syncs a YouTube timestamp to the matching Discord chat entry', async () => {
    const extensionPath = resolve(process.cwd(), 'dist');
    const temporaryUserDataDir = mkdtempSync(
        join(tmpdir(), 'youtube-discord-sync-e2e-'),
    );
    userDataDir = temporaryUserDataDir;
    context = await chromium.launchPersistentContext(temporaryUserDataDir, {
        channel: 'chromium',
        headless: false,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--no-first-run',
        ],
    });

    let serviceWorker: Worker | undefined = context.serviceWorkers()[0];

    if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker');
    }

    expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\//);

    const discordPage = await context.newPage();
    await discordPage.route('https://discord.com/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: discordFixture,
        }),
    );
    await discordPage.goto('https://discord.com/channels/123/456');

    const youtubePage = await context.newPage();
    await youtubePage.route('https://www.youtube.com/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: youtubeFixture,
        }),
    );
    await youtubePage.goto('https://www.youtube.com/watch?v=fixture-video');
    await youtubePage.bringToFront();

    const popupPromise = context.waitForEvent('page');
    await serviceWorker.evaluate(async () => {
        const extensionChrome = globalThis as typeof globalThis & {
            chrome: ExtensionChromeApi;
        };

        await extensionChrome.chrome.tabs.create({
            url: extensionChrome.chrome.runtime.getURL('popup/index.html'),
            active: false,
        });
    });
    const popup = await popupPromise;
    await popup.getByText('Fixture video').waitFor({ state: 'visible' });

    const discordSyncButton = popup.getByRole('button', { name: /general/ });
    await discordSyncButton.click();
    await expect.poll(() => discordSyncButton.innerText()).toContain('Syncing');

    await expect
        .poll(() =>
            serviceWorker.evaluate(async () => {
                const extensionChrome = globalThis as typeof globalThis & {
                    chrome: ExtensionChromeApi;
                };
                const discordTab = (
                    await extensionChrome.chrome.tabs.query({
                        url: 'https://discord.com/*',
                    })
                )[0];

                if (!discordTab?.id) {
                    return false;
                }

                const information =
                    await extensionChrome.chrome.tabs.sendMessage<{
                        currentSync: unknown;
                    }>(discordTab.id, { message: 'get_tab_information' });

                return information?.currentSync !== null;
            }),
        )
        .toBe(true);

    const youtubeTimestamp = await serviceWorker.evaluate(async () => {
        const extensionChrome = globalThis as typeof globalThis & {
            chrome: ExtensionChromeApi;
        };
        const youtubeTab = (
            await extensionChrome.chrome.tabs.query({
                url: 'https://www.youtube.com/*',
            })
        )[0];

        if (!youtubeTab?.id) {
            throw new Error('YouTube fixture tab not found');
        }

        const response = await extensionChrome.chrome.tabs.sendMessage<{
            timestamp: string | null;
        }>(youtubeTab.id, { message: 'fetch_timestamp' });

        return response.timestamp;
    });
    expect(youtubeTimestamp).toBe('2023-12-31T23:59:57.000Z');

    await youtubePage.locator('.video-stream').dispatchEvent('timeupdate');

    await expect
        .poll(() =>
            discordPage
                .locator('main div[class*="scroller"]')
                .evaluate((element) => (element as HTMLElement).scrollTop),
        )
        .toBe(82);
});
