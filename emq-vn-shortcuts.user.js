// ==UserScript==
// @name         EMQ VN Shortcuts
// @namespace    https://github.com/Serecola
// @version      1.1
// @description  Displays shortcuts for VN titles in EMQ dropdown.
// @author       Serecola
// @match        https://erogemusicquiz.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @downloadURL  https://github.com/Serecola/emq-scripts/raw/main/emq-vn-shortcuts.user.js
// @updateURL    https://github.com/Serecola/emq-scripts/raw/main/emq-vn-shortcuts.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        JSON_URL: 'https://raw.githubusercontent.com/Serecola/bad-emq-players/main/data_shortcuts/shortcuts.json',
        CACHE_KEY: 'emq_shortcuts_data',
        TIMESTAMP_KEY: 'emq_shortcuts_ts',
        CACHE_DURATION: 7 * 24 * 60 * 60 * 1000,
        MAX_DISPLAY: 10
    };

    // -------------------------------------------------------------------------
    // Normalization
    // -------------------------------------------------------------------------
    function normalize(text) {
        if (!text || text === '\\N') return '';
        const decomposed = text.normalize('NFKD');
        return decomposed.replace(/\p{M}/gu, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    }

    // -------------------------------------------------------------------------
    // Storage (Page localStorage via unsafeWindow)
    // -------------------------------------------------------------------------
    function getPageStorage() {
        try {
            return typeof unsafeWindow !== 'undefined' ? unsafeWindow.localStorage : window.localStorage;
        } catch { return window.localStorage; }
    }

    function getCache() {
        const storage = getPageStorage();
        try {
            const raw = storage.getItem(CONFIG.CACHE_KEY);
            const ts = storage.getItem(CONFIG.TIMESTAMP_KEY);
            if (raw && ts) return { data: JSON.parse(raw), timestamp: parseInt(ts, 10) };
        } catch (e) { console.warn('[EMQ VN Shortcuts] Cache read error:', e); }
        return null;
    }

    function setCache(data) {
        const storage = getPageStorage();
        try {
            storage.setItem(CONFIG.CACHE_KEY, JSON.stringify(data));
            storage.setItem(CONFIG.TIMESTAMP_KEY, Date.now().toString());
            console.log(`[EMQ VN Shortcuts] Cache saved (${data.length} entries)`);
        } catch (e) { console.warn('[EMQ VN Shortcuts] Cache write error:', e); }
    }

    function clearCache() {
        const storage = getPageStorage();
        try {
            storage.removeItem(CONFIG.CACHE_KEY);
            storage.removeItem(CONFIG.TIMESTAMP_KEY);
            console.log('[EMQ VN Shortcuts] Cache cleared');
        } catch (e) { console.warn('[EMQ VN Shortcuts] Cache clear error:', e); }
    }

    function isStale(timestamp) { return Date.now() - timestamp > CONFIG.CACHE_DURATION; }

    // -------------------------------------------------------------------------
    // Lookup Map & Matcher (stores both shortcuts and word shortcuts)
    // -------------------------------------------------------------------------
    let lookupMap = null;
    let wordShortcutSet = null;

    function buildLookupMap(jsonData) {
        const map = new Map();
        const wordSet = new Set();

        for (const entry of jsonData) {
            const { jp_latin_title, en_latin_title, shortcuts, shortcuts_words } = entry;
            if (!shortcuts || shortcuts.length === 0) continue;

            // Track word shortcuts
            if (shortcuts_words && shortcuts_words.length > 0) {
                shortcuts_words.forEach(w => wordSet.add(w));
            }

            const addTitle = (title) => {
                const norm = normalize(title);
                if (!norm) return;
                map.set(norm, { shortcuts, words: shortcuts_words });
                const stripped = normalize(title.replace(/\([^)]*\)/g, ''));
                if (stripped && stripped !== norm) map.set(stripped, { shortcuts, words: shortcuts_words });
            };

            if (jp_latin_title) addTitle(jp_latin_title);
            if (en_latin_title && en_latin_title !== jp_latin_title) addTitle(en_latin_title);
        }

        return { map, wordSet };
    }

    function findShortcuts(rawTitle, map) {
        if (!rawTitle || map.size === 0) return null;
        const normFull = normalize(rawTitle);
        if (map.has(normFull)) return map.get(normFull);

        const normNoParens = normalize(rawTitle.replace(/\([^)]*\)/g, ''));
        if (map.has(normNoParens)) return map.get(normNoParens);

        for (const [key, val] of map) {
            if (normFull.startsWith(key) || normNoParens.startsWith(key)) return val;
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // UI Panel (Robust Creation & Injection)
    // -------------------------------------------------------------------------
    let panel = null;
    let panelInitialized = false;

    function initPanel() {
        if (panelInitialized) return;
        panel = document.createElement('div');
        panel.id = 'emq-shortcuts-panel';
        panel.style.cssText = `
            margin: 10px 0; padding: 10px 12px;
            background: #161b22; border: 1px solid #30363d; border-radius: 6px;
            font-size: 15px; color: #c9d1d9; font-family: system-ui, -apple-system, sans-serif;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: none; z-index: 9999;
        `;
        panel.innerHTML = `
            <b style="margin-right:8px;">⌨ Shortcuts</b>
            <span id="emq-sc-status" style="color:#8b949e;font-size:13px;"></span>
            <button id="emq-sc-refresh" style="margin-left:6px;padding:2px 6px;background:#30363d;border:1px solid #484f58;color:#8b949e;border-radius:4px;cursor:pointer;font-size:12px;">↻</button>
            <div id="emq-sc-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
        `;

        const refreshBtn = panel.querySelector('#emq-sc-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = () => {
                clearCache();
                lookupMap = null;
                wordShortcutSet = null;
                refreshBtn.textContent = '⟳';
                fetchAndCache(true);
            };
            refreshBtn.title = 'Clear cache & re-download';
        }
        panelInitialized = true;
    }

    function ensurePanelInDOM() {
        if (!panelInitialized) initPanel();
        if (document.contains(panel)) return panel;

        const target = document.getElementById('correctAnswerInfoDiv') || document.getElementById('app') || document.body;
        target.appendChild(panel);
        return panel;
    }

    function renderShortcuts(shortcuts, wordShortcuts = [], statusText = '', isError = false) {
        const el = ensurePanelInDOM();
        el.style.display = 'block';

        const statusEl = el.querySelector('#emq-sc-status');
        const chipsEl = el.querySelector('#emq-sc-chips');
        if (statusEl) { statusEl.textContent = statusText; statusEl.style.color = isError ? '#f85149' : '#8b949e'; }
        if (!chipsEl) return;

        chipsEl.innerHTML = '';

        const wordSet = new Set(wordShortcuts);

        if (!shortcuts || shortcuts.length === 0) {
            chipsEl.innerHTML = '<span style="color:#8b949e;">None found</span>';
            return;
        }

        shortcuts.slice(0, CONFIG.MAX_DISPLAY).forEach(sc => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = sc || '␣';

            const isWordShortcut = wordSet.has(sc);

            btn.style.cssText = `
                background: ${isWordShortcut ? '#3a2a1a' : '#21262d'};
                color: #c9d1d9;
                border: 1px solid ${isWordShortcut ? '#ffd700' : '#30363d'};
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                font-family: ui-monospace, SFMono-Regular, monospace;
                font-size: 14px;
                transition: all 0.15s ease;
                box-shadow: ${isWordShortcut ? '0 0 4px rgba(255, 215, 0, 0.5)' : 'none'};
            `;

            if (isWordShortcut) {
                btn.style.setProperty('box-shadow', '0 0 6px rgba(255, 215, 0, 0.6)');
                btn.style.setProperty('text-shadow', '0 0 2px rgba(255, 215, 0, 0.3)');
            }

            btn.onmouseenter = () => {
                btn.style.background = isWordShortcut ? '#4a3a2a' : '#30363d';
                if (isWordShortcut) btn.style.boxShadow = '0 0 10px rgba(255, 215, 0, 0.8)';
            };
            btn.onmouseleave = () => {
                btn.style.background = isWordShortcut ? '#3a2a1a' : '#21262d';
                if (isWordShortcut) btn.style.boxShadow = '0 0 6px rgba(255, 215, 0, 0.6)';
            };
            btn.onclick = () => {
                navigator.clipboard.writeText(sc).catch(() => {});
                const orig = btn.textContent;
                btn.style.background = '#238636';
                btn.style.color = '#fff';
                btn.textContent = '✓';
                setTimeout(() => {
                    btn.style.background = isWordShortcut ? '#3a2a1a' : '#21262d';
                    btn.style.color = '#c9d1d9';
                    btn.textContent = orig;
                    if (isWordShortcut) btn.style.boxShadow = '0 0 6px rgba(255, 215, 0, 0.6)';
                }, 800);
            };
            chipsEl.appendChild(btn);
        });
    }

    function updateStatus(text, isError = false) {
        if (!panelInitialized) return;
        const el = document.getElementById('emq-sc-status');
        if (el) { el.textContent = text; el.style.color = isError ? '#f85149' : '#8b949e'; }
    }

    // -------------------------------------------------------------------------
    // Fetch Logic
    // -------------------------------------------------------------------------
    function fetchShortcuts() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url: CONFIG.JSON_URL,
                headers: { 'Cache-Control': 'no-cache' },
                onload: (res) => {
                    if (res.status === 200) {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch (e) { reject(new Error('JSON parse failed')); }
                    } else { reject(new Error(`HTTP ${res.status}`)); }
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Timed out')), timeout: 15000
            });
        });
    }

    // -------------------------------------------------------------------------
    // Core Flow
    // -------------------------------------------------------------------------
    let lastTitleKey = '';

    async function fetchAndCache(force = false) {
        const cache = getCache();
        if (cache && !force && !isStale(cache.timestamp)) {
            console.log('[EMQ VN Shortcuts] Cache fresh. Ready.');
            const { map, wordSet } = buildLookupMap(cache.data);
            lookupMap = map;
            wordShortcutSet = wordSet;
            updateStatus('ready');
            return;
        }

        updateStatus('downloading...');
        try {
            const data = await fetchShortcuts();
            setCache(data);
            const { map, wordSet } = buildLookupMap(data);
            lookupMap = map;
            wordShortcutSet = wordSet;
            updateStatus('ready');
            console.log('[EMQ VN Shortcuts] Shortcuts downloaded & cached.');
            if (document.querySelector('li.correctAnswerSourceTitle')) displayShortcuts();
        } catch (e) {
            console.error('[EMQ VN Shortcuts] Fetch failed:', e);
            if (!cache || force) updateStatus('download failed', true);
            else updateStatus('cached (stale)');
        }
    }

    function displayShortcuts() {
        const items = document.querySelectorAll('li.correctAnswerSourceTitle');
        if (!items.length) return;

        const cache = getCache();
        if (!cache?.data) { updateStatus('waiting for download...'); return; }

        const titles = Array.from(items).map(el => el.textContent.trim()).filter(Boolean);
        const key = titles.join('|');
        if (key === lastTitleKey) return;
        lastTitleKey = key;

        if (!lookupMap) {
            const { map, wordSet } = buildLookupMap(cache.data);
            lookupMap = map;
            wordShortcutSet = wordSet;
        }

        const allSc = new Set();
        const allWordSc = new Set();

        titles.forEach(t => {
            const result = findShortcuts(t, lookupMap);
            if (result) {
                result.shortcuts.forEach(s => allSc.add(s));
                if (result.words) {
                    result.words.forEach(w => {
                        allSc.add(w);
                        allWordSc.add(w);
                    });
                }
            }
        });

        const sorted = Array.from(allSc).sort((a, b) => a.length - b.length || a.localeCompare(b));
        renderShortcuts(sorted, Array.from(allWordSc), 'ready');
    }

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------
    function init() {
        initPanel();
        fetchAndCache();

        const observer = new MutationObserver(() => {
            clearTimeout(window._emqDisplayTimeout);
            window._emqDisplayTimeout = setTimeout(() => {
                if (document.querySelector('li.correctAnswerSourceTitle')) {
                    displayShortcuts();
                }
            }, 150);
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'id'] });
        setTimeout(displayShortcuts, 600);
        console.log('[EMQ VN Shortcuts] Script initialized. Watching for results phase...');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();