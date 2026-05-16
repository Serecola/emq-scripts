// ==UserScript==
// @name         EMQ Chat QoL
// @namespace    https://erogemusicquiz.com/
// @version      1.1
// @description  Chat QoL improvements: image hover preview, and paste file upload to litterbox
// @author       Serecola
// @match        https://erogemusicquiz.com/*
// @grant        GM_xmlhttpRequest
// @connect      litterbox.catbox.moe
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════════════════════
    // IMAGE HOVER PREVIEW
    // Shows a floating image preview when hovering over image links in chat.
    // ════════════════════════════════════════════════════════════════════════════

    const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|svg|avif)(\?.*)?$/i;
    const IMAGE_HOSTS = [
        'catbox.moe',
        'files.catbox.moe',
        'i.imgur.com',
        'imgur.com',
        'cdn.discordapp.com',
        'media.discordapp.net',
        'i.redd.it',
        'pbs.twimg.com',
        's-ul.eu',
    ];

    // Normalizes URLs to a directly loadable image URL where possible.
    function normalizeImageUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.hostname === 'imgur.com') {
                const match = parsed.pathname.match(/^\/([a-zA-Z0-9]+)$/);
                if (match) return `https://i.imgur.com/${match[1]}.png`;
            }
        } catch {}
        return url;
    }

    function isImageUrl(url) {
        try {
            const parsed = new URL(url);
            if (IMAGE_EXTENSIONS.test(parsed.pathname)) return true;
            if (IMAGE_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) return true;
        } catch {}
        return false;
    }

    const hoverStyle = document.createElement('style');
    hoverStyle.textContent = `
        .emq-img-hover-zoom {
            position: fixed;
            z-index: 999999;
            pointer-events: none;
            border-radius: 6px;
            border: 1px solid #666;
            box-shadow: 0 8px 32px rgba(0,0,0,0.75);
            background: #111;
            max-width: min(800px, 90vw);
            max-height: 80vh;
            object-fit: contain;
            opacity: 0;
            transition: opacity 0.12s ease;
        }
        .emq-img-hover-zoom.visible {
            opacity: 1;
        }
    `;
    document.head.appendChild(hoverStyle);

    const hoverZoom = document.createElement('img');
    hoverZoom.className = 'emq-img-hover-zoom';
    hoverZoom.alt = '';
    document.body.appendChild(hoverZoom);

    const HOVER_MARGIN = 16;

    function positionHoverZoom(e) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const iw = hoverZoom.offsetWidth;
        const ih = hoverZoom.offsetHeight;

        let x = e.clientX + 24;
        if (x + iw + HOVER_MARGIN > vw) x = e.clientX - iw - 24;

        let y = e.clientY + 24;
        if (y + ih + HOVER_MARGIN > vh) y = e.clientY - ih - 24;

        hoverZoom.style.left = Math.max(HOVER_MARGIN, x) + 'px';
        hoverZoom.style.top  = Math.max(HOVER_MARGIN, y) + 'px';
    }

    function decorateLink(anchor) {
        if (anchor.dataset.emqDecorated) return;
        anchor.dataset.emqDecorated = 'true';

        const url = normalizeImageUrl(anchor.href);

        anchor.addEventListener('mouseenter', e => {
            hoverZoom.src = '';
            hoverZoom.style.left = '-9999px';
            hoverZoom.style.top  = '-9999px';
            hoverZoom.classList.add('visible');
            hoverZoom.src = url;
            if (hoverZoom.naturalWidth) {
                positionHoverZoom(e);
            } else {
                hoverZoom.onload = () => positionHoverZoom(e);
            }
        });
        anchor.addEventListener('mousemove', positionHoverZoom);
        anchor.addEventListener('mouseleave', () => {
            hoverZoom.classList.remove('visible');
            hoverZoom.onload = null;
        });
    }

    function scanForLinks(root) {
        if (!root.querySelectorAll) return;
        if (root.matches && root.matches('.chatMessageContents a[href]') && isImageUrl(root.href)) {
            decorateLink(root);
        }
        for (const a of root.querySelectorAll('.chatMessageContents a[href]')) {
            if (isImageUrl(a.href)) decorateLink(a);
        }
    }

    scanForLinks(document);

    // ════════════════════════════════════════════════════════════════════════════
    // LITTERBOX FILE UPLOAD
    // Drag & drop or copy & paste a file into chat to upload to litterbox.
    // Uses GM_xmlhttpRequest to bypass EMQ's Content Security Policy.
    // ════════════════════════════════════════════════════════════════════════════

    const LITTERBOX_API  = 'https://litterbox.catbox.moe/resources/internals/api.php';
    const LITTERBOX_TIME = '12h';

    function uploadToLitterbox(file) {
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('fileToUpload', file);
            fd.append('reqtype', 'fileupload');
            fd.append('time', LITTERBOX_TIME);
            GM_xmlhttpRequest({
                method: 'POST',
                url: LITTERBOX_API,
                data: fd,
                timeout: 90000, // 90 seconds
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        resolve(res.responseText.trim());
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: (err) => reject(new Error(err.statusText || 'Network error')),
            });
        });
    }

    let toast = null;

    function getOrCreateToast() {
        if (toast) return toast;
        const chat = document.getElementById('chat');
        if (!chat) return null;
        toast = document.createElement('div');
        toast.style.cssText = [
            'position:absolute',
            'bottom:100px',
            'left:50%',
            'transform:translateX(-50%)',
            'background:rgba(20,20,20,0.88)',
            'color:#e8e8e8',
            'padding:5px 12px',
            'border-radius:6px',
            'font-size:12px',
            'z-index:9999',
            'pointer-events:none',
            'transition:opacity .2s',
            'white-space:nowrap',
            'opacity:0',
        ].join(';');
        chat.appendChild(toast);
        return toast;
    }

    function showToast(msg) {
        const t = getOrCreateToast();
        if (!t) return;
        t.textContent = msg;
        t.style.opacity = '1';
    }

    function hideToast() {
        if (toast) toast.style.opacity = '0';
    }

    // ── Drag overlay ──────────────────────────────────────────────────────────────

    let overlay = null;
    function showOverlay(wrapper) {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.textContent = 'Drop to upload to litterbox';
        overlay.style.cssText = [
            'position:absolute', 'inset:0',
            'background:rgba(0,120,255,0.13)',
            'border:2px dashed #4a9eff', 'border-radius:6px',
            'z-index:9999', 'pointer-events:none',
            'display:flex', 'align-items:center', 'justify-content:center',
            'color:#4a9eff', 'font-size:13px', 'font-weight:500',
        ].join(';');
        wrapper.appendChild(overlay);
    }
    function hideOverlay() {
        if (overlay) { overlay.remove(); overlay = null; }
    }

    // ── Attach to the chatInput textarea ─────────────────────────────────────────

    function attachLitterbox(textarea) {
        if (textarea.dataset.emqLitterbox) return;
        textarea.dataset.emqLitterbox = 'true';

        // Structure: <div style="position:relative">     ← wrapper (overlay target)
        //              <div style="display:flex">         ← flexRow
        //                <textarea id="chatInput">
        //                <button class="emoji-toggle-btn">
        const flexRow = textarea.parentElement;
        const wrapper = flexRow.parentElement;

        let dragCounter = 0;

        textarea.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            dragCounter++;
            showOverlay(wrapper);
        });

        textarea.addEventListener('dragleave', () => {
            if (--dragCounter <= 0) { dragCounter = 0; hideOverlay(); }
        });

        textarea.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        });

        textarea.addEventListener('drop', async (e) => {
            dragCounter = 0;
            hideOverlay();
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            e.preventDefault();
            e.stopPropagation();
            showToast('Uploading to litterbox\u2026');
            try {
                const url = await uploadToLitterbox(file);
                hideToast();
                insertAtCursor(textarea, url);
            } catch (err) {
                hideToast();
                showToast('Upload failed');
                setTimeout(hideToast, 3000);
                console.error('[EMQ Chat QoL] drop upload failed:', err);
            }
        });

        textarea.addEventListener('paste', async (e) => {
            const file = e.clipboardData?.files?.[0];
            if (!file) return;
            e.preventDefault();
            e.stopPropagation();
            showToast('Uploading to litterbox\u2026');
            try {
                const url = await uploadToLitterbox(file);
                hideToast();
                insertAtCursor(textarea, url);
            } catch (err) {
                hideToast();
                showToast('Upload failed');
                setTimeout(hideToast, 3000);
                console.error('[EMQ Chat QoL] paste upload failed:', err);
            }
        });
    }

    function insertAtCursor(el, text) {
        const start = el.selectionStart ?? el.value.length;
        const end   = el.selectionEnd   ?? el.value.length;
        el.value    = el.value.slice(0, start) + text + el.value.slice(end);
        const pos   = start + text.length;
        el.setSelectionRange(pos, pos);
        // Fire input event so Blazor's two-way binding picks up the new value
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
    }

    let debounceTimer = null;
    function scheduleFullScan() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => scanForLinks(document), 300);
    }

    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                scanForLinks(node);
            }
        }
        scheduleFullScan();

        const chatInput = document.getElementById('chatInput');
        if (chatInput) attachLitterbox(chatInput);
    }).observe(document.body, { childList: true, subtree: true });

    // Run once immediately in case elements are already present on load
    const chatInput = document.getElementById('chatInput');
    if (chatInput) attachLitterbox(chatInput);

})();