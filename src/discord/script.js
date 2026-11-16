// as of now any incoming sync requests are assumed to be from a YouTube tab
// this can change in the future once we start supporting other websites
// @TODO: change these to make it clear that these come from a YouTube tab

async function run() {
    let currentSync = null;

    function handleMessage(request, sender, sendResponse) {
        if (request.message === 'video_timeupdate') {
            const { timestamp } = request;

            const scroller = document.querySelector(
                "main div[class*='scroller']",
            );

            if (!scroller) {
                console.warn('Chat scroller not found');
            }

            const chatElements = Array.from(
                document.querySelectorAll(
                    `main div[class*='scroller'] time[datetime]`,
                ),
            ).filter((chatElement) => {
                return (
                    new Date(chatElement.getAttribute('datetime')) <
                    new Date(timestamp)
                );
            });

            const closestTimeElement = chatElements[chatElements.length - 1];

            if (!chatElements.length) {
                scroller.scrollBy({
                    behavior: 'instant',
                    top: -scroller.clientHeight,
                });

                return;
            }

            const currentChatElement = closestTimeElement.closest('li');

            const distance =
                48 +
                scroller.clientHeight -
                currentChatElement.getBoundingClientRect().top -
                currentChatElement.clientHeight;
            const y = -distance + 30;

            scroller.scrollBy({ behavior: 'instant', top: y });
        }

        if (request.message === 'sync_start') {
            syncStart(request.tabId);
        }

        if (request.message === 'sync_stop') {
            syncStop();
        }

        if (request.message === 'get_tab_information') {
            sendResponse({ currentSync });
        }
    }

    chrome.runtime.onMessage.addListener(handleMessage);

    function syncStart(tabId) {
        currentSync = {
            type: 'youtube',
            tabId,
        };
    }

    function syncStop() {
        currentSync = null;
    }

    return true;
}

run();
