const popupFrame = document.querySelector('#popup-app');

function resizePopupFrame() {
    const popupDocument = popupFrame.contentDocument;
    if (!popupDocument?.body) {
        return;
    }

    const height = Math.ceil(
        Math.max(
            popupDocument.documentElement.scrollHeight,
            popupDocument.body.scrollHeight,
        ),
    );
    popupFrame.style.height = `${height}px`;
}

popupFrame.addEventListener('load', () => {
    const popupDocument = popupFrame.contentDocument;
    const popupWindow = popupFrame.contentWindow;
    if (!popupDocument?.body || !popupWindow) {
        return;
    }

    const resizeObserver = new popupWindow.ResizeObserver(resizePopupFrame);
    resizeObserver.observe(popupDocument.documentElement);
    resizeObserver.observe(popupDocument.body);
    resizePopupFrame();
});

function findElements(document, query) {
    if (query.kind === 'selector') {
        const elements = Array.from(document.querySelectorAll(query.selector));
        return query.last ? elements.slice(-1) : elements;
    }

    if (query.kind === 'role') {
        if (query.role === 'button') {
            return Array.from(document.querySelectorAll('button')).filter(
                (button) =>
                    !query.name ||
                    new RegExp(query.name.source, query.name.flags).test(
                        button.innerText,
                    ),
            );
        }

        return Array.from(document.querySelectorAll('input[type="number"]'));
    }

    const matchesText = (element) => {
        const text =
            element.innerText?.trim() ?? element.textContent?.trim() ?? '';
        return query.pattern
            ? new RegExp(query.pattern.source, query.pattern.flags).test(text)
            : text.includes(query.value ?? '');
    };

    return Array.from(document.body.querySelectorAll('*')).filter(
        (element) =>
            matchesText(element) &&
            !Array.from(element.children).some(matchesText),
    );
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.message !== '__e2e_popup_bridge') {
        return false;
    }

    const frame = document.querySelector('#popup-app');
    const popupDocument = frame?.contentDocument;
    if (!popupDocument?.body) {
        sendResponse({ ready: false });
        return true;
    }

    if (request.action === 'ready') {
        sendResponse({ ready: true });
        return true;
    }

    const elements = findElements(popupDocument, request.query);
    if (request.action === 'query') {
        sendResponse({
            ready: true,
            elements: elements.map((element) => ({
                text: element.innerText ?? element.textContent ?? '',
                value: element.tagName === 'INPUT' ? element.value : null,
            })),
        });
        return true;
    }

    if (request.action === 'click') {
        elements[0]?.click();
        sendResponse({ ready: true, changed: elements.length > 0 });
        return true;
    }

    if (request.action === 'fill') {
        const input = elements[0];
        const popupWindow = popupDocument.defaultView;
        if (input?.tagName !== 'INPUT' || !popupWindow) {
            sendResponse({ ready: true, changed: false });
            return true;
        }

        Reflect.set(
            popupWindow.HTMLInputElement.prototype,
            'value',
            request.value,
            input,
        );
        input.dispatchEvent(new popupWindow.Event('input', { bubbles: true }));
        input.dispatchEvent(new popupWindow.Event('change', { bubbles: true }));
        sendResponse({ ready: true, changed: true });
        return true;
    }

    sendResponse({ ready: true, changed: false });
    return true;
});
