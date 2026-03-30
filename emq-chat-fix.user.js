// ==UserScript==
// @name EMQ Chat Fix
// @namespace https://erogemusicquiz.com
// @version 1.4
// @description fix chat being jumped to bottom
// @author Hyther
// @match https://erogemusicquiz.com/*
// @grant none
// @run-at document-start
// ==/UserScript==

(function() {
    'use strict';
    let chat = null;
    let lastScroll = 0;
    let ready = false;
    let userMoving = false;
    function init() {
        chat = document.getElementById('chatHistory');
        if (!chat) return false;
        const goToBottom = () => {
            if (ready) return;
            if (chat.scrollHeight > chat.clientHeight + 50) {
                chat.scrollTop = chat.scrollHeight;
                lastScroll = chat.scrollHeight;
            }
            ready = true;
        };
        setTimeout(goToBottom, 1000);
        setTimeout(() => {
            chat.scrollTo = () => {};
            chat.scroll = () => {};
            Object.defineProperty(chat, 'scrollTop', {
                get() { return lastScroll; },
                set(val) {
                    if (userMoving || !ready) {
                        lastScroll = Math.max(0, val);
                    }
                },
                configurable: true
            });
            chat.addEventListener('scroll', () => {
                userMoving = true;
                lastScroll = chat.scrollTop;
                clearTimeout(window.emqTimer);
                window.emqTimer = setTimeout(() => userMoving = false, 1500);
            }, { passive: true });
            new MutationObserver(() => {
                if (ready && !userMoving) {
                    chat.scrollTop = lastScroll;
                }
            }).observe(chat, { childList: true, subtree: true });
        }, 1800);
        return true;
    }
    const checker = setInterval(() => {
        if (init()) clearInterval(checker);
    }, 450);
    window.addEventListener('load', () => setTimeout(init, 2500));
})();
