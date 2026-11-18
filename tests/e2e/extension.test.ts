import { afterEach, expect, test } from 'vitest';
import {
    cleanupExtensionTest,
    createDiscordChannelPage,
    createDiscordInvalidPage,
    createRandomWebpagePage,
    createTestExtension,
    createYouTubePage,
    dispatchTimeUpdate,
    expectLatestChatVisibility,
    getYoutubeTimestamp,
    launchExtension,
    openPopup,
    setVideoDuration,
    waitForContentScript,
    youtubeFinishedFixture,
    youtubeHomepageFixture,
    youtubeLatePlayerFixture,
    youtubeMalformedFixture,
    youtubeOngoingFixture,
    youtubePendingMetadataFixture,
    youtubePremiereFixture,
} from './extension-test-utils';

afterEach(cleanupExtensionTest);

const CHANNELS = ['#general', '#announcements', '#memes'] as const;
const SERVER_NAME = 'The Example Discord Server';
const VOD_GUIDANCE =
    'To start, go to a YouTube livestream VOD or premiere to start syncing.';

/** The microformat of `youtube_finished_livestream.html`, for injecting late. */
const FINISHED_LIVESTREAM_MICROFORMAT = JSON.stringify({
    '@id': 'https://www.youtube.com/watch?v=fixture-video',
    name: 'Fixture finished livestream',
    author: 'Fixture channel',
    thumbnailUrl: ['https://example.test/thumbnail.jpg'],
    publication: [
        {
            isLiveBroadcast: true,
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-01T01:00:00.000Z',
        },
    ],
});

test('syncs a finished livestream to a Discord channel and shows sync information there', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // youtube tab information should be displayed
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });

    // sync a discord tab
    const syncButton = popup.getByRole('button', {
        name: new RegExp(CHANNELS[0], 'i'),
    });
    await syncButton.click();

    // there should be a indicator that syncing has started
    await expect
        .poll(() => syncButton.textContent(), { timeout: 5_000 })
        .toContain('Syncing');

    // timestamp should update in the UI if an timeupdate event is dispatched
    await dispatchTimeUpdate(youtubePage);
    const eventTimestamp = await getYoutubeTimestamp(
        serviceWorker,
        youtubePage,
    );

    expect(eventTimestamp).toBe('2023-12-31T23:59:58.000Z');

    // discord should display youtube tab information
    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);
    await discordPopup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });

    // discord should have auto scrolled to the latest chat per timestamp
    await expectLatestChatVisibility(discordPage, eventTimestamp, true);
});

test('syncs two of three Discord channels and scrolls only those channels', async () => {
    const serviceWorker = await launchExtension();
    const discordPages = await Promise.all([
        createDiscordChannelPage(CHANNELS[0], 456, SERVER_NAME),
        createDiscordChannelPage(CHANNELS[1], 457, SERVER_NAME),
        createDiscordChannelPage(CHANNELS[2], 458, SERVER_NAME),
    ]);
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await Promise.all(
        discordPages.map((page) =>
            waitForContentScript(serviceWorker, page, 'get_tab_information'),
        ),
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // sync the general and announcements discord channels
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup.getByText('Fixture finished livestream').waitFor();
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
        .click();
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[1], 'i') })
        .click();

    // both selected channels should show that syncing has started
    await expect
        .poll(() =>
            popup
                .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
                .textContent(),
        )
        .toContain('Syncing');
    await expect
        .poll(() =>
            popup
                .getByRole('button', { name: new RegExp(CHANNELS[1], 'i') })
                .textContent(),
        )
        .toContain('Syncing');

    // update the discord chat using the latest playback timestamp
    await dispatchTimeUpdate(youtubePage);
    const eventTimestamp = await getYoutubeTimestamp(
        serviceWorker,
        youtubePage,
    );

    // only the selected channels should show the matching chat
    await expectLatestChatVisibility(discordPages[0], eventTimestamp, true);
    await expectLatestChatVisibility(discordPages[1], eventTimestamp, true);
    await expectLatestChatVisibility(discordPages[2], eventTimestamp, false);
});

test('blocks a second source from taking over a syncing Discord tab', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    // distinct URLs: a tab is looked up by its exact URL
    const firstSource = await createYouTubePage(
        youtubeFinishedFixture,
        'https://www.youtube.com/watch?v=fixture-first',
    );
    // a different title, so the Discord popup shows who really owns the tab
    const secondSource = await createYouTubePage(
        youtubePremiereFixture,
        'https://www.youtube.com/watch?v=fixture-second',
    );
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, firstSource, 'fetch_info');
    await waitForContentScript(serviceWorker, secondSource, 'fetch_info');

    // the first source claims the Discord channel
    await firstSource.bringToFront();
    const firstPopup = await openPopup(serviceWorker);
    await firstPopup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });
    const firstRow = firstPopup.getByRole('button', {
        name: new RegExp(CHANNELS[0], 'i'),
    });
    await firstRow.click();

    // the owned row stays interactive and uses the sync glyph
    await expect.poll(() => firstRow.textContent()).toContain('Syncing');
    await expect.poll(() => firstRow.isDisabled()).toBe(false);
    const currentLabel = firstPopup.locator('[data-syncing="current"]');
    await expect.poll(() => currentLabel.count()).toBe(1);
    await expect
        .poll(() => currentLabel.textContent())
        .toContain('Syncing with this tab');
    // read before switching tabs: the popup re-binds to the active tab
    const currentLabelClassName = await currentLabel.className();
    expect(currentLabelClassName).toContain('text-emerald-400');
    const currentIcon = firstPopup.locator('[data-syncing="current"] svg');
    await expect.poll(() => currentIcon.count()).toBe(1);
    expect(await currentIcon.className()).toContain('animate-spin-slow');

    // the second source sees the channel as taken over by another tab
    await secondSource.bringToFront();
    const secondPopup = await openPopup(serviceWorker);
    await secondPopup
        .getByText('Fixture premiere')
        .waitFor({ state: 'visible' });
    const blockedRow = secondPopup.getByRole('button', {
        name: new RegExp(CHANNELS[0], 'i'),
    });
    await expect.poll(() => blockedRow.isDisabled()).toBe(true);
    await expect.poll(() => blockedRow.textContent()).toContain('Syncing');

    // the same glyph, held still and muted: motion is the only extra cue
    const otherLabel = secondPopup.locator('[data-syncing="other"]');
    await expect.poll(() => otherLabel.count()).toBe(1);
    await expect
        .poll(() => otherLabel.textContent())
        .toContain('Syncing in another tab');
    const otherLabelClassName = await otherLabel.className();
    expect(otherLabelClassName).toContain('text-white/50');
    expect(otherLabelClassName).not.toBe(currentLabelClassName);
    const otherIcon = secondPopup.locator('[data-syncing="other"] svg');
    await expect.poll(() => otherIcon.count()).toBe(1);
    expect(await otherIcon.className()).not.toContain('animate-spin-slow');

    // clicking the blocked row must not take the channel over
    await blockedRow.click();
    await expect.poll(() => blockedRow.isDisabled()).toBe(true);

    // the first source still drives the channel
    await dispatchTimeUpdate(firstSource);
    const eventTimestamp = await getYoutubeTimestamp(
        serviceWorker,
        firstSource,
    );
    await expectLatestChatVisibility(discordPage, eventTimestamp, true);

    // the channel still reports the first source, not the second
    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);
    await discordPopup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });
    await expect
        .poll(() => discordPopup.getByText('Fixture premiere').count())
        .toBe(0);
});

test('unsyncs a Discord channel and returns its popup to the sync selector', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // start syncing with the general discord channel
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    const syncButton = popup.getByRole('button', {
        name: new RegExp(CHANNELS[0], 'i'),
    });
    await syncButton.click();

    // advance playback and capture its timestamp
    await dispatchTimeUpdate(youtubePage);
    let eventTimestamp = await getYoutubeTimestamp(serviceWorker, youtubePage);

    // the matching chat should be visible in the channel
    await expectLatestChatVisibility(discordPage, eventTimestamp, true);

    // unsync the general channel
    await syncButton.click();

    // the channel should no longer show an active sync
    await expect.poll(() => syncButton.textContent()).not.toContain('Syncing');

    // advance playback after unsyncing
    await dispatchTimeUpdate(youtubePage);
    eventTimestamp = await getYoutubeTimestamp(serviceWorker, youtubePage);

    // the unsynced channel should no longer follow playback
    await expectLatestChatVisibility(discordPage, eventTimestamp, false);

    // open the discord popup after unsyncing
    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);

    // the popup should show its selector, not YouTube sync information
    await discordPopup.getByText('Sync with').waitFor({ state: 'visible' });
    await expect
        .poll(() =>
            discordPopup.getByText('Fixture finished livestream').count(),
        )
        .toBe(0);
});

test('unsyncs only one of two Discord channels', async () => {
    const serviceWorker = await launchExtension();
    const discordPages = await Promise.all([
        createDiscordChannelPage(CHANNELS[0], 456, SERVER_NAME),
        createDiscordChannelPage(CHANNELS[1], 457, SERVER_NAME),
    ]);
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await Promise.all(
        discordPages.map((page) =>
            waitForContentScript(serviceWorker, page, 'get_tab_information'),
        ),
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // start syncing with the general and announcements channels
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    const generalButton = popup.getByRole('button', {
        name: new RegExp(CHANNELS[0], 'i'),
    });
    const announcementsButton = popup.getByRole('button', {
        name: new RegExp(CHANNELS[1], 'i'),
    });
    await generalButton.click();
    await announcementsButton.click();

    // send the first playback update
    await dispatchTimeUpdate(youtubePage);
    const firstEventTimestamp = await getYoutubeTimestamp(
        serviceWorker,
        youtubePage,
    );

    // both channels should show the matching chat
    await expectLatestChatVisibility(
        discordPages[0],
        firstEventTimestamp,
        true,
    );
    await expectLatestChatVisibility(
        discordPages[1],
        firstEventTimestamp,
        true,
    );

    // unsync the general channel while leaving announcements active
    await generalButton.click();

    // only announcements should remain marked as syncing
    await expect
        .poll(() => generalButton.textContent())
        .not.toContain('Syncing');
    await expect
        .poll(() => announcementsButton.textContent())
        .toContain('Syncing');

    // send another playback update
    await dispatchTimeUpdate(youtubePage);
    const secondEventTimestamp = await getYoutubeTimestamp(
        serviceWorker,
        youtubePage,
    );

    // announcements should follow playback while general stays unchanged
    await expectLatestChatVisibility(
        discordPages[0],
        secondEventTimestamp,
        false,
    );
    await expectLatestChatVisibility(
        discordPages[1],
        secondEventTimestamp,
        true,
    );
});

test('pausing stops further Discord scrolling', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // start syncing with the general channel
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    const syncButton = popup.getByRole('button', {
        name: new RegExp(CHANNELS[0], 'i'),
    });
    await syncButton.click();

    // advance playback once while syncing
    await dispatchTimeUpdate(youtubePage);
    let eventTimestamp = await getYoutubeTimestamp(serviceWorker, youtubePage);

    // confirm the matching chat is visible
    await expectLatestChatVisibility(discordPage, eventTimestamp, true);

    // the syncing indicator spins while playback is following
    const syncIcon = popup.locator('[data-syncing="current"] svg');
    await expect
        .poll(() => syncIcon.className())
        .toContain('animate-spin-slow');

    // pause playback and send an update
    await popup.locator('button[aria-label="Pause syncing"]').click();
    await popup.waitForTimeout(100);

    // pausing freezes the indicator
    await expect
        .poll(() => syncIcon.className())
        .not.toContain('animate-spin-slow');

    await dispatchTimeUpdate(youtubePage);
    eventTimestamp = await getYoutubeTimestamp(serviceWorker, youtubePage);

    // confirm the chat does not advance while paused
    await expectLatestChatVisibility(discordPage, eventTimestamp, false);

    // resume playback and send another update
    await popup.locator('button[aria-label="Resume syncing"]').click();
    await popup.waitForTimeout(100);

    // resuming starts the indicator again
    await expect
        .poll(() => syncIcon.className())
        .toContain('animate-spin-slow');
    await popup.waitForTimeout(100);
    await dispatchTimeUpdate(youtubePage);
    eventTimestamp = await getYoutubeTimestamp(serviceWorker, youtubePage);

    // confirm the timestamp advanced and the next chat is visible
    expect(eventTimestamp).toBe('2024-01-01T00:00:00.000Z');
    await expectLatestChatVisibility(discordPage, eventTimestamp, true);
});

test('navigating in place away from the video stops its Discord sync', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // start syncing the Discord channel
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup.getByText('Fixture finished livestream').waitFor({
        state: 'visible',
    });
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
        .click();

    // confirm the channel has started syncing
    await expect
        .poll(() =>
            popup
                .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
                .textContent(),
        )
        .toContain('Syncing');

    // leave the video the way YouTube does: in place, without a page load.
    // Detaching the player's `src` on its own must not be enough to end the
    // sync, because the player does that while it switches streams.
    await youtubePage.evaluate(() => {
        history.pushState({}, '', '/');
        document.querySelector('#microformat')?.replaceChildren();
    });

    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);

    // verify the Discord tab no longer reports a YouTube sync
    await discordPopup.getByText('Sync with').waitFor({ state: 'visible' });
    await expect
        .poll(() =>
            discordPopup.getByText('Fixture finished livestream').count(),
        )
        .toBe(0);
});

test('closing the YouTube source tab stops its Discord sync', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // start syncing the Discord channel
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup.getByText('Fixture finished livestream').waitFor({
        state: 'visible',
    });
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
        .click();

    // confirm the channel has started syncing
    await expect
        .poll(() =>
            popup
                .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
                .textContent(),
        )
        .toContain('Syncing');

    // close the YouTube source and reopen the Discord popup
    await youtubePage.close();
    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);

    // verify the Discord tab no longer reports a YouTube sync
    await discordPopup.getByText('Sync with').waitFor({ state: 'visible' });
    await expect
        .poll(() =>
            discordPopup.getByText('Fixture finished livestream').count(),
        )
        .toBe(0);
});

test('navigating the YouTube source tab stops its Discord sync', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // start syncing the Discord channel
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
        .click();

    // confirm the channel has started syncing
    await expect
        .poll(() =>
            popup
                .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
                .textContent(),
        )
        .toContain('Syncing');

    // navigate the source tab and reopen the Discord popup
    await youtubePage.goto(
        'https://www.youtube.com/watch?v=next-fixture-video',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');
    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);

    // verify the previous YouTube sync has ended
    await discordPopup.getByText('Sync with').waitFor({ state: 'visible' });
    await expect
        .poll(() =>
            discordPopup.getByText('Fixture finished livestream').count(),
        )
        .toBe(0);
});

test('changing the offset updates the displayed timestamp in both popups', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // change the offset in the YouTube popup
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup.getByText('Fixture finished livestream').waitFor();
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
        .click();
    const timestampDisplay = popup.locator('div.text-xs').last();
    const originalTimestamp = await timestampDisplay.innerText();

    const offsetInput = popup.getByRole('spinbutton');
    await offsetInput.fill('5');

    // verify the new offset and timestamp in YouTube
    await expect.poll(() => offsetInput.inputValue()).toBe('5');
    await expect
        .poll(() => timestampDisplay.innerText())
        .not.toBe(originalTimestamp);

    // open the Discord popup to check its sync details
    await discordPage.bringToFront();
    const discordPopup = await openPopup(serviceWorker);

    // verify Discord displays the updated offset and timestamp
    await discordPopup.getByText('Offset:').waitFor({ state: 'visible' });
    await discordPopup.getByText('5 seconds').waitFor({ state: 'visible' });
    await expect
        .poll(() => discordPopup.locator('div.text-xs').last().innerText())
        .not.toBe(originalTimestamp);
});

test('computes a premiere timestamp from its duration', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    const youtubePage = await createYouTubePage(youtubePremiereFixture);
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');
    await setVideoDuration(serviceWorker, youtubePage, 1800);

    // start syncing the premiere to Discord
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup.getByText('Fixture premiere').waitFor({ state: 'visible' });
    await popup
        .getByRole('button', { name: new RegExp(CHANNELS[0], 'i') })
        .click();

    // dispatch one second of playback
    await dispatchTimeUpdate(youtubePage);
    const eventTimestamp = await getYoutubeTimestamp(
        serviceWorker,
        youtubePage,
    );

    // verify the premiere timestamp and matching chat visibility
    expect(eventTimestamp).toBe('2024-01-01T00:29:58.000Z');
    await expectLatestChatVisibility(discordPage, eventTimestamp, true);
});

test('shows no Discord tabs when none are open', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');
    // open the YouTube popup with no Discord tabs
    await youtubePage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // show the empty Discord-tab state
    await popup.getByText('No Discord tabs open').waitFor({ state: 'visible' });
});

test('ignores Discord tabs that are not on a channel page', async () => {
    const serviceWorker = await launchExtension();
    const invalidPage = await createDiscordInvalidPage();
    const invalidTitle = await invalidPage.title();
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // open the YouTube popup with only an invalid Discord tab
    await youtubePage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // ignore the invalid tab and show the empty state
    expect(invalidTitle).toBe('Discord | Not a channel');
    await popup.getByText('No Discord tabs open').waitFor({ state: 'visible' });
});

test('an ongoing livestream shows the VOD guidance', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(youtubeOngoingFixture);
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // open the popup on the ongoing livestream
    await youtubePage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // direct the user to a finished livestream VOD
    await popup.getByText(VOD_GUIDANCE).waitFor({ state: 'visible' });
});

test('a YouTube homepage shows the VOD guidance', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(
        youtubeHomepageFixture,
        'https://www.youtube.com/',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // open the popup on the YouTube homepage
    await youtubePage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // direct the user to a finished livestream VOD
    await popup.getByText(VOD_GUIDANCE).waitFor({ state: 'visible' });
});

test('a watch page whose player appears late still registers', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(youtubeLatePlayerFixture);
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    // open the popup before the player element exists
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);

    // the VOD is usable from its metadata alone, so no guidance is shown
    await popup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });
    expect(await popup.getByText(VOD_GUIDANCE).count()).toBe(0);

    // the player appears long after the old bootstrap window would have expired
    await youtubePage.waitForTimeout(2500);
    await youtubePage.evaluate(() => {
        const video = document.createElement('video');
        video.className = 'video-stream';
        document.body.append(video);
    });

    // give the debounced inspection time to attach to the new player
    await youtubePage.waitForTimeout(500);

    // the late player is picked up and starts reporting playback
    await dispatchTimeUpdate(youtubePage);
    expect(await getYoutubeTimestamp(serviceWorker, youtubePage)).toBe(
        '2023-12-31T23:59:58.000Z',
    );
});

test('a watch page whose metadata appears late still registers', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(youtubePendingMetadataFixture);
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);

    // a watch page that has not rendered its metadata waits on the loading page
    await popup.locator('[role="status"]').waitFor({ state: 'visible' });

    // YouTube swaps the microformat in once the watch data is available
    await youtubePage.evaluate((microformat) => {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = microformat;
        document.querySelector('#microformat')?.append(script);
    }, FINISHED_LIVESTREAM_MICROFORMAT);

    await popup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });
});

test('navigating in place from the homepage to a livestream registers', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(
        youtubeHomepageFixture,
        'https://www.youtube.com/',
    );
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup.getByText(VOD_GUIDANCE).waitFor({ state: 'visible' });

    // YouTube navigates with `pushState`, so the content script never reloads
    await youtubePage.evaluate((microformat) => {
        history.pushState({}, '', '/watch?v=fixture-video');
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = microformat;
        document.querySelector('#microformat')?.append(script);
    }, FINISHED_LIVESTREAM_MICROFORMAT);

    await popup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });
});

test('a transient player source reset keeps the VOD registered', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);
    await waitForContentScript(serviceWorker, youtubePage, 'fetch_info');

    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);
    await popup
        .getByText('Fixture finished livestream')
        .waitFor({ state: 'visible' });

    // YouTube detaches the media source while it switches streams
    await youtubePage.locator('.video-stream').evaluate((element) => {
        element.setAttribute('src', 'blob:fixture');
        element.removeAttribute('src');
    });
    await popup.waitForTimeout(1000);

    expect(await popup.getByText('Fixture finished livestream').count()).toBe(
        1,
    );
    expect(await popup.getByText(VOD_GUIDANCE).count()).toBe(0);
});

test('opening the popup on Discord shows the sync option selector', async () => {
    const serviceWorker = await launchExtension();
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );
    await waitForContentScript(
        serviceWorker,
        discordPage,
        'get_tab_information',
    );

    // open the popup on a Discord channel
    await discordPage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // show the available sync options
    await popup.getByText('Sync with').waitFor({ state: 'visible' });

    // select YouTube as the sync source
    await popup.getByRole('button', { name: /youtube/i }).click();

    // prompt the user to open a YouTube livestream VOD
    await expect
        .poll(() =>
            popup
                .getByText(
                    'To start, open this extension in a YouTube livestream VOD tab.',
                )
                .count(),
        )
        .toBeGreaterThan(0);
});

test('opening the popup on another website shows Welcome', async () => {
    const serviceWorker = await launchExtension();
    const page = await createRandomWebpagePage();
    await page.getByText('This is a random webpage').waitFor({
        state: 'visible',
    });

    // open the popup on an unrelated website
    await page.bringToFront();

    const popup = await openPopup(serviceWorker);

    // show the welcome message
    await popup.getByText(/Welcome!/).waitFor({ state: 'visible' });
});

test('shows the loading page until the YouTube content script registers', async () => {
    const extensionPath = await createTestExtension({
        omitYouTubeContentScript: true,
    });
    const serviceWorker = await launchExtension(extensionPath);
    const youtubePage = await createYouTubePage(youtubeFinishedFixture);

    // the tab is a YouTube watch page, but nothing has registered for it yet
    await youtubePage.bringToFront();
    const popup = await openPopup(serviceWorker);

    // so the popup waits instead of claiming the tab is broken
    await popup.locator('[role="status"]').waitFor({ state: 'visible' });
    expect(
        await popup
            .getByText('Something went wrong. Please refresh the page.')
            .count(),
    ).toBe(0);

    // the failure is still reported once the retries are exhausted
    await popup
        .getByText('Something went wrong. Please refresh the page.')
        .waitFor({ state: 'visible' });
});

test('shows an error when fetching YouTube information fails', async () => {
    const serviceWorker = await launchExtension();
    const youtubePage = await createYouTubePage(youtubeMalformedFixture);

    // open the popup with malformed YouTube metadata
    await youtubePage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // show the information-fetch error
    await popup
        .getByText('Something went wrong. Please refresh the page.')
        .waitFor({ state: 'visible' });
});

test('shows an error when fetching Discord tab information fails', async () => {
    const extensionPath = await createTestExtension({
        omitDiscordContentScript: true,
    });
    const serviceWorker = await launchExtension(extensionPath);
    const discordPage = await createDiscordChannelPage(
        CHANNELS[0],
        456,
        SERVER_NAME,
    );

    // open the popup without a Discord content-script listener
    await discordPage.bringToFront();

    const popup = await openPopup(serviceWorker);

    // show the information-fetch error
    await popup
        .getByText('Something went wrong. Please refresh the page.')
        .waitFor({ state: 'visible' });
});
