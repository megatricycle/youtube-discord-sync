/**
 * Shared harness for the browser-level end-to-end tests.
 *
 * Goal: keep these tests as close to real usage as possible. Every test starts
 * a real Chromium with the built extension loaded, serves real fixture pages at
 * the real YouTube/Discord URLs, and drives the extension through the same
 * public surfaces a user touches. In particular, the popup is opened with
 * `chrome.action.openPopup()` — the same entry point as clicking the toolbar
 * icon — instead of navigating directly to `popup/index.html`.
 *
 * Chrome does not expose its native action popup to Playwright as a normal
 * page, so a small test-only popup wrapper
 * (see `tests/fixtures/popup_test_harness.*`) embeds the real popup in an
 * iframe and forwards locator-style operations to that real popup DOM.
 * Everything the tests click, read, or fill is still the production popup UI;
 * the wrapper only bridges the parts Playwright cannot reach.
 */
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    chromium,
    type BrowserContext,
    type Page,
    type Worker,
} from 'playwright';
import { expect } from 'vitest';

type ExtensionChromeApi = {
    tabs: {
        query(queryInfo: {
            url: string;
        }): Promise<Array<{ id?: number; url?: string }>>;
        sendMessage<T>(
            tabId: number,
            message: { message: string; tabId?: number },
        ): Promise<T>;
    };
    runtime: {
        getURL(path: string): string;
        sendMessage<T>(message: PopupBridgeRequest): Promise<T>;
    };
    action: { openPopup(): Promise<void> };
    scripting: {
        executeScript(options: {
            target: { tabId: number };
            world: 'ISOLATED';
            func: (durationSeconds: number) => void;
            args: number[];
        }): Promise<unknown[]>;
    };
};

type PopupLocatorQuery =
    | {
          kind: 'text';
          value?: string;
          pattern?: { source: string; flags: string };
      }
    | {
          kind: 'role';
          role: 'button' | 'spinbutton';
          name?: { source: string; flags: string };
      }
    | { kind: 'selector'; selector: string; last?: boolean };

type PopupElementSnapshot = { text: string; value: string | null };

type PopupBridgeRequest = {
    message: '__e2e_popup_bridge';
    action: 'ready' | 'query' | 'click' | 'fill';
    query?: PopupLocatorQuery;
    value?: string;
};

type PopupBridgeResponse = {
    ready: boolean;
    elements?: PopupElementSnapshot[];
    changed?: boolean;
};

type PopupLocator = {
    waitFor(options?: { state?: 'visible' }): Promise<void>;
    innerText(): Promise<string>;
    count(): Promise<number>;
    click(): Promise<void>;
    fill(value: string): Promise<void>;
    inputValue(): Promise<string>;
    last(): PopupLocator;
};

export type PopupPage = {
    getByText(text: string | RegExp): PopupLocator;
    getByRole(
        role: 'button' | 'spinbutton',
        options?: { name?: RegExp },
    ): PopupLocator;
    locator(selector: string): PopupLocator;
    waitForTimeout(timeout: number): Promise<void>;
    ensureOpen(): Promise<void>;
};

export const youtubeFinishedFixture = readFixture(
    'youtube_finished_livestream.html',
);
export const youtubeOngoingFixture = readFixture(
    'youtube_ongoing_livestream.html',
);
export const youtubeHomepageFixture = readFixture('youtube_homepage.html');
export const youtubeMalformedFixture = readFixture(
    'youtube_malformed_metadata.html',
);
export const youtubePremiereFixture = readFixture('youtube_premiere.html');
export const discordFixture = readFixture('discord_channel.html');
export const discordInvalidPageFixture = readFixture(
    'discord_invalid_page.html',
);
export const randomWebpageFixture = readFixture('random_webpage.html');
const popupHarnessHtml = readFixture('popup_test_harness.html');
const popupHarnessScript = readFixture('popup_test_harness.js');

let context: BrowserContext | undefined;
let userDataDir: string | undefined;
let temporaryExtensionDir: string | undefined;

/** Closes the browser and removes the temporary profile/extension copies. */
export async function cleanupExtensionTest(): Promise<void> {
    await context?.close();
    context = undefined;

    if (userDataDir) {
        rmSync(userDataDir, { recursive: true, force: true });
        userDataDir = undefined;
    }

    if (temporaryExtensionDir) {
        rmSync(temporaryExtensionDir, { recursive: true, force: true });
        temporaryExtensionDir = undefined;
    }
}

/**
 * Launches real Chromium with the built extension installed, mirroring how a
 * user loads the unpacked extension during development. Returns the extension
 * service worker so tests can observe message traffic between the real tabs.
 */
export async function launchExtension(extensionPath?: string): Promise<Worker> {
    const loadedExtensionPath = extensionPath ?? (await createTestExtension());
    const temporaryUserDataDir = mkdtempSync(
        join(tmpdir(), 'youtube-discord-sync-e2e-'),
    );
    userDataDir = temporaryUserDataDir;
    context = await chromium.launchPersistentContext(temporaryUserDataDir, {
        channel: 'chromium',
        headless: false,
        slowMo: Number(process.env.PLAYWRIGHT_SLOWMO ?? 0),
        args: [
            `--disable-extensions-except=${loadedExtensionPath}`,
            `--load-extension=${loadedExtensionPath}`,
            '--no-first-run',
        ],
    });

    let serviceWorker = context.serviceWorkers()[0];

    if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker');
    }

    expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\//);
    return serviceWorker;
}

/**
 * Opens the extension popup through `chrome.action.openPopup()`, the same
 * entry point Chrome uses when the user clicks the toolbar icon. Returns a
 * `PopupPage` whose locators read and drive the real popup DOM via the test
 * bridge rather than a synthetic page.
 */
export async function openPopup(serviceWorker: Worker): Promise<PopupPage> {
    const popup = createPopupPage(serviceWorker);
    await popup.ensureOpen();
    return popup;
}

/**
 * Opens a real Discord tab and serves the Discord channel fixture at a real
 * `discord.com` channel URL, so the extension's content script and tab-title
 * parsing see exactly what they would in production. The fixture is a template:
 * its `{channelName}` and `{serverName}` title placeholders are filled in here.
 */
export async function createDiscordChannelPage(
    channelName: string,
    channelId: number,
    serverName: string,
): Promise<Page> {
    const page = await getContext().newPage();
    const body = discordFixture
        .replace('{channelName}', () => channelName)
        .replace('{serverName}', () => serverName);
    await page.route('https://discord.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body }),
    );
    await page.goto(`https://discord.com/channels/123/${channelId}`);
    return page;
}

/**
 * Opens a real Discord tab that is not a channel page, so the extension has to
 * ignore it when listing the Discord tabs it can sync with. The URL keeps a
 * non-numeric channel segment on purpose: a numeric one would make the tab a
 * valid channel instead.
 */
export async function createDiscordInvalidPage(): Promise<Page> {
    const page = await getContext().newPage();
    await page.route('https://discord.com/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: discordInvalidPageFixture,
        }),
    );
    await page.goto('https://discord.com/channels/123/not-a-channel');
    return page;
}

/**
 * Opens a real YouTube tab and serves a fixture at a real `youtube.com` URL,
 * so the extension's content script parses metadata from the same page shape
 * it encounters in production.
 */
export async function createYouTubePage(
    fixture: string,
    url = 'https://www.youtube.com/watch?v=fixture-video',
): Promise<Page> {
    const page = await getContext().newPage();
    await page.route('https://www.youtube.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: fixture }),
    );
    await page.goto(url);
    return page;
}

/** Opens a non-YouTube/non-Discord page for the popup's fallback mode. */
export async function createRandomWebpagePage(): Promise<Page> {
    const page = await getContext().newPage();
    await page.route('https://example.test/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: randomWebpageFixture,
        }),
    );
    await page.goto('https://example.test/random');
    return page;
}

/**
 * Waits until a page's real content script answers a message. This keeps the
 * tests on the same footing as the app: they can only proceed once the
 * extension has actually injected and registered its listener, rather than
 * assuming a fixed timing.
 */
export async function waitForContentScript(
    serviceWorker: Worker,
    page: Page,
    message: string,
): Promise<void> {
    const tabId = await getTabId(serviceWorker, page.url());

    await expect
        .poll(
            async () => {
                try {
                    return await serviceWorker.evaluate(
                        async ({ tabId, message }) => {
                            const extensionChrome =
                                globalThis as typeof globalThis & {
                                    chrome: ExtensionChromeApi;
                                };

                            await extensionChrome.chrome.tabs.sendMessage(
                                tabId,
                                { message },
                            );
                            return true;
                        },
                        { tabId, message },
                    );
                } catch {
                    return false;
                }
            },
            { timeout: 10_000 },
        )
        .toBe(true);
}

/**
 * Asks the real YouTube content script for its current computed timestamp,
 * the same value the app uses to position Discord chat.
 */
export async function getYoutubeTimestamp(
    serviceWorker: Worker,
    youtubePage: Page,
): Promise<string> {
    const tabId = await getTabId(serviceWorker, youtubePage.url());
    const response = await serviceWorker.evaluate(async (tabId) => {
        const extensionChrome = globalThis as typeof globalThis & {
            chrome: ExtensionChromeApi;
        };
        return extensionChrome.chrome.tabs.sendMessage<{
            timestamp: string | null;
        }>(tabId, { message: 'fetch_timestamp' });
    }, tabId);

    if (!response.timestamp) {
        throw new Error('YouTube fixture did not produce a timestamp');
    }

    return response.timestamp;
}

/**
 * Advances the fixture video by one second and dispatches a real
 * `timeupdate`, which is the same event the extension listens for during
 * playback. This deliberately avoids calling any extension API directly.
 */
export async function dispatchTimeUpdate(youtubePage: Page): Promise<void> {
    await youtubePage.locator('.video-stream').evaluate((element) => {
        const video = element as HTMLVideoElement;
        video.currentTime += 1;
        video.dispatchEvent(new Event('timeupdate'));
    });
}

/**
 * Gives a source-less fixture video a deterministic duration. The override is
 * injected into the content script's isolated world so the real extension code
 * reads the value — the only test-only seam required to make the premiere
 * timestamp calculation predictable.
 */
export async function setVideoDuration(
    serviceWorker: Worker,
    youtubePage: Page,
    durationSeconds: number,
): Promise<void> {
    const tabId = await getTabId(serviceWorker, youtubePage.url());
    await serviceWorker.evaluate(
        async ({ tabId, durationSeconds }) => {
            const extensionChrome = globalThis as typeof globalThis & {
                chrome: ExtensionChromeApi;
            };
            await extensionChrome.chrome.scripting.executeScript({
                target: { tabId },
                world: 'ISOLATED',
                func: (duration) => {
                    const video = document.querySelector('video');
                    if (!video) {
                        return;
                    }
                    Object.defineProperty(video, 'duration', {
                        configurable: true,
                        value: duration,
                    });
                },
                args: [durationSeconds],
            });
        },
        { tabId, durationSeconds },
    );
}

/**
 * Determines whether the latest chat message at or before a timestamp
 * intersects the Discord scroller viewport. This mirrors the user-visible
 * result of syncing without inspecting scroll offsets or internal state.
 */
export async function isLatestChatVisible(
    page: Page,
    timestamp: string,
): Promise<boolean> {
    return page
        .locator('main div[class*="scroller"]')
        .evaluate(async (scroller, eventTimestamp) => {
            const chats = Array.from(
                scroller.querySelectorAll<HTMLTimeElement>('time[datetime]'),
            ).filter((chat) => {
                const chatTimestamp = chat.getAttribute('datetime');
                return (
                    chatTimestamp !== null &&
                    new Date(chatTimestamp).getTime() <=
                        new Date(eventTimestamp).getTime()
                );
            });
            const latestChat = chats[chats.length - 1]?.closest('li');

            if (!latestChat) {
                return false;
            }

            return new Promise<boolean>((resolve) => {
                const observer = new IntersectionObserver(
                    ([entry]) => {
                        observer.disconnect();
                        resolve(entry.isIntersecting);
                    },
                    { root: scroller },
                );
                observer.observe(latestChat);
            });
        }, timestamp);
}

/** Polls `isLatestChatVisible` until it reaches the expected state. */
export async function expectLatestChatVisibility(
    page: Page,
    timestamp: string,
    expectedVisible: boolean,
): Promise<void> {
    await expect
        .poll(() => isLatestChatVisible(page, timestamp), {
            timeout: 5_000,
        })
        .toBe(expectedVisible);
}

/**
 * Builds a temporary copy of the built extension for a test run. The only
 * changes to the production output are:
 *
 * - `action.default_popup` is pointed at the test popup wrapper, which embeds
 *   the real popup and exposes the DOM bridge Playwright needs; and
 * - the `scripting` permission is added for `setVideoDuration`.
 *
 * The `omitDiscordContentScript` option lets one test reproduce a missing
 * Discord listener. Everything else in the copy is the untouched `dist` build.
 */
export async function createTestExtension(
    options: {
        omitDiscordContentScript?: boolean;
    } = {},
): Promise<string> {
    const extensionPath = resolve(process.cwd(), 'dist');
    temporaryExtensionDir = mkdtempSync(
        join(tmpdir(), 'youtube-discord-sync-extension-'),
    );
    const temporaryExtensionPath = join(temporaryExtensionDir, 'extension');
    cpSync(extensionPath, temporaryExtensionPath, { recursive: true });
    writeFileSync(
        join(temporaryExtensionPath, 'e2e-popup.html'),
        popupHarnessHtml,
    );
    writeFileSync(
        join(temporaryExtensionPath, 'e2e-popup.js'),
        popupHarnessScript,
    );

    const manifestPath = join(temporaryExtensionPath, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        action: { default_popup: string };
        content_scripts: Array<{ js: string[] }>;
        permissions: string[];
    };
    manifest.action.default_popup = 'e2e-popup.html';
    manifest.permissions = [...new Set([...manifest.permissions, 'scripting'])];
    if (options.omitDiscordContentScript) {
        manifest.content_scripts = manifest.content_scripts.filter(
            (contentScript) => !contentScript.js.includes('discord/script.js'),
        );
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 4));

    return temporaryExtensionPath;
}

async function getTabId(serviceWorker: Worker, url: string): Promise<number> {
    const tabId = await serviceWorker.evaluate(async (url) => {
        const extensionChrome = globalThis as typeof globalThis & {
            chrome: ExtensionChromeApi;
        };
        const tabs = await extensionChrome.chrome.tabs.query({ url });
        return tabs.find((tab) => tab.url === url)?.id;
    }, url);

    if (typeof tabId !== 'number') {
        throw new Error(`Could not find browser tab for ${url}`);
    }

    return tabId;
}

/**
 * Wraps the native action popup in a Playwright-style locator API. Because
 * Chrome keeps the toolbar popup out of Playwright's page model, the wrapper
 * asks the popup harness (running inside the extension) to perform each
 * operation on the real popup DOM. `ensureOpen` reopens the popup through
 * `chrome.action.openPopup()` whenever Chrome has dismissed it, matching the
 * user clicking the toolbar icon again.
 */
function createPopupPage(serviceWorker: Worker): PopupPage {
    async function sendBridgeRequest(
        request: PopupBridgeRequest,
    ): Promise<PopupBridgeResponse | null> {
        return serviceWorker.evaluate(async (request) => {
            const extensionChrome = globalThis as typeof globalThis & {
                chrome: ExtensionChromeApi;
            };
            try {
                return await extensionChrome.chrome.runtime.sendMessage<PopupBridgeResponse>(
                    request,
                );
            } catch {
                return null;
            }
        }, request);
    }

    async function ensureOpen(): Promise<void> {
        const ready = await sendBridgeRequest({
            message: '__e2e_popup_bridge',
            action: 'ready',
        });
        if (ready?.ready) {
            return;
        }

        await serviceWorker.evaluate(async () => {
            const extensionChrome = globalThis as typeof globalThis & {
                chrome: ExtensionChromeApi;
            };
            await extensionChrome.chrome.action.openPopup();
        });
        await expect
            .poll(
                async () => {
                    const response = await sendBridgeRequest({
                        message: '__e2e_popup_bridge',
                        action: 'ready',
                    });
                    return response?.ready ?? false;
                },
                { timeout: 10_000 },
            )
            .toBe(true);
    }

    function createLocator(query: PopupLocatorQuery): PopupLocator {
        async function sendRequest(
            action: PopupBridgeRequest['action'],
            value?: string,
        ): Promise<PopupBridgeResponse | null> {
            await ensureOpen();
            return sendBridgeRequest({
                message: '__e2e_popup_bridge',
                action,
                query,
                value,
            });
        }

        async function getElements(): Promise<PopupElementSnapshot[]> {
            return (await sendRequest('query'))?.elements ?? [];
        }

        return {
            async waitFor() {
                await expect
                    .poll(async () => (await getElements()).length, {
                        timeout: 10_000,
                    })
                    .toBeGreaterThan(0);
            },
            async innerText() {
                const [element] = await getElements();
                if (!element) {
                    throw new Error('Native popup element not found');
                }
                return element.text;
            },
            async count() {
                return (await getElements()).length;
            },
            async click() {
                await expect
                    .poll(
                        async () =>
                            (await sendRequest('click'))?.changed ?? false,
                        {
                            timeout: 10_000,
                        },
                    )
                    .toBe(true);
            },
            async fill(value) {
                const response = await sendRequest('fill', value);
                if (!response?.changed) {
                    throw new Error('Native popup input not found');
                }
            },
            async inputValue() {
                const [element] = await getElements();
                if (element?.value === null || !element) {
                    throw new Error('Native popup input not found');
                }
                return element.value;
            },
            last() {
                return createLocator({
                    ...query,
                    ...(query.kind === 'selector' ? { last: true } : {}),
                });
            },
        };
    }

    return {
        ensureOpen,
        getByText(text) {
            return createLocator(
                typeof text === 'string'
                    ? { kind: 'text', value: text }
                    : {
                          kind: 'text',
                          pattern: { source: text.source, flags: text.flags },
                      },
            );
        },
        getByRole(role, options) {
            return createLocator({
                kind: 'role',
                role,
                ...(options?.name
                    ? {
                          name: {
                              source: options.name.source,
                              flags: options.name.flags,
                          },
                      }
                    : {}),
            });
        },
        locator(selector) {
            return createLocator({ kind: 'selector', selector });
        },
        waitForTimeout(timeout) {
            return new Promise((resolve) => setTimeout(resolve, timeout));
        },
    };
}

function readFixture(fileName: string): string {
    return readFileSync(
        new URL(`../fixtures/${fileName}`, import.meta.url),
        'utf8',
    );
}

function getContext(): BrowserContext {
    if (!context) {
        throw new Error('Extension test browser has not been started');
    }
    return context;
}
