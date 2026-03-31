// ==UserScript==
// @name         EMQ Chat Fix
// @namespace    https://erogemusicquiz.com
// @version      1.5
// @description  fix chat being jumped to bottom, but scroll down on own messages
// @author       Hyther
// @match        https://erogemusicquiz.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    let chat = null;
    let lastScroll = 0;
    let ready = false;
    let userMoving = false;
    let userSentMessage = false;
    let nativeSetter = null;

    function init() {
        chat = document.getElementById('chatHistory');
        if (!chat) return false;

        nativeSetter = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop').set;

        const goToBottom = () => {
            if (ready) return;
            lastScroll = chat.scrollHeight - chat.clientHeight;
            nativeSetter.call(chat, lastScroll);
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
                if (!ready) return;
                if (userSentMessage) {
                    userSentMessage = false;
                    setTimeout(() => {
                        lastScroll = chat.scrollHeight - chat.clientHeight;
                        nativeSetter.call(chat, lastScroll);
                    }, 50);
                }
            }).observe(chat, { childList: true, subtree: true });

            const chatInput = document.getElementById('chatInput');
            if (chatInput) {
                chatInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        userSentMessage = true;
                    }
                }, true);
            }

        }, 1800);

        return true;
    }

    const checker = setInterval(() => {
        if (init()) clearInterval(checker);
    }, 450);

    window.addEventListener('load', () => setTimeout(init, 2500));
})();