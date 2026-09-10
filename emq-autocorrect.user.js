// ==UserScript==
// @name         EMQ Text Autocorrect
// @namespace    https://github.com/Serecola
// @version      1.1
// @description  Custom text autocorrects for EMQ
// @author       Serecola
// @match        https://erogemusicquiz.com/*
// @downloadURL  https://github.com/Serecola/emq-scripts/raw/main/emq-autocorrect.user.js
// @updateURL    https://github.com/Serecola/emq-scripts/raw/main/emq-autocorrect.user.js
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'emq_autocorrects';

    function loadAutocorrects() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch { return []; }
    }

    function saveAutocorrects(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    let autocorrects = loadAutocorrects();
    let currentFilter = '';

    function applyAutocorrect(e) {
        const el = e.target;
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') || el.type === 'password') return;
        if (!autocorrects.length) return;

        const triggerKeys = new Set([' ', 'Enter', 'Tab']);
        if (!triggerKeys.has(e.key)) return;

        const val = el.value;
        const pos = el.selectionStart;
        const textBefore = val.slice(0, pos);
        const wordMatch = textBefore.match(/(\S+)$/);
        if (!wordMatch) return;

        const word = wordMatch[1];
        const rule = autocorrects.find(r => r.from === word);
        if (!rule) return;

        e.preventDefault();

        const wordStart = pos - word.length;
        const suffix = (e.key !== 'Enter' && e.key !== 'Tab') ? e.key : '';
        const replacement = rule.to + suffix;
        const newPos = wordStart + replacement.length;

        el.focus();
        el.setSelectionRange(wordStart, pos);
        if (!document.execCommand('insertText', false, replacement)) {
            el.value = val.slice(0, wordStart) + replacement + val.slice(pos);
        }
        el.setSelectionRange(newPos, newPos);
    }

    document.addEventListener('keydown', applyAutocorrect, true);

    let injected = false;

    function escHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function refreshAutocorrects() {
        autocorrects = loadAutocorrects();
        currentFilter = '';
        const filterInput = document.getElementById('emq-ac-from');
        if (filterInput) filterInput.value = '';
        renderList();
    }

    function buildTabPane() {
        const pane = document.createElement('div');
        pane.id = 'emq-ac-pane';
        pane.className = 'tab-pane';
        pane.style.cssText = 'padding: 8px 4px;';

        pane.innerHTML = `
            <div style="display:flex; gap:6px; margin-bottom:6px; align-items:center; flex-wrap:wrap;">
                <input id="emq-ac-from" type="text" placeholder="Shortcut / Search..."
                    style="flex:1; min-width:100px; padding:4px 6px; border-radius:4px;
                        border:1px solid #555; background:#111; color:#fff;">
                <input id="emq-ac-to" type="text" placeholder="Replacement text"
                    style="flex:2; min-width:140px; padding:4px 6px; border-radius:4px;
                        border:1px solid #555; background:#111; color:#fff;">
                <button id="emq-ac-add" type="button"
                    style="padding:4px 12px; background:#4a90e2; color:#fff; border:none;
                        border-radius:4px; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                    + Add
                </button>
                <button id="emq-ac-refresh" type="button"
                    style="padding:4px 12px; background:#555; color:#fff; border:none;
                        border-radius:4px; cursor:pointer; white-space:nowrap; flex-shrink:0;"
                    title="Reload from storage">
                    ↻ Refresh
                </button>
            </div>
            <div id="emq-ac-list" style="max-height:220px; overflow-y:auto; border:1px solid #333;
                border-radius:4px; background:#0d0d1a;"></div>
        `;

        return pane;
    }

    // -------------------------------------------------------------------------
// Title dropdown for the "Replacement text" box
// -------------------------------------------------------------------------
function getAutocompleteTitles() {
    try {
        const raw = localStorage.getItem('emq_shortcuts_data');
        if (!raw) return [];
        const data = JSON.parse(raw);
        const seen = new Set();
        const titles = [];
        for (const entry of data) {
            const { jp_latin_title, en_latin_title } = entry;
            for (const t of [jp_latin_title, en_latin_title]) {
                if (t && t !== '\\N' && !seen.has(t)) {
                    seen.add(t);
                    titles.push(t);
                }
            }
        }
        return titles;
    } catch (e) {
        console.warn('[EMQ Autocorrect] Failed to read title cache:', e);
        return [];
    }
}

function normalizeForMatch(text) {
    return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function attachTitleAutocomplete(inputEl, getTitles) {
    if (!inputEl) return;

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        position: absolute; z-index: 10000; display: none;
        background: #111; border: 1px solid #555; border-radius: 4px;
        max-height: 220px; overflow-y: auto; font-size: 13px;
        color: #fff; font-family: system-ui, -apple-system, sans-serif;
    `;
    document.body.appendChild(dropdown);

    let results = [];
    let focusIndex = -1;

    function positionDropdown() {
        const rect = inputEl.getBoundingClientRect();
        dropdown.style.left = `${rect.left + window.scrollX}px`;
        dropdown.style.top = `${rect.bottom + window.scrollY}px`;
        dropdown.style.width = `${rect.width}px`;
    }

    function close() {
        dropdown.style.display = 'none';
        focusIndex = -1;
    }

    function renderResults() {
        dropdown.innerHTML = '';
        results.forEach((title, i) => {
            const item = document.createElement('div');
            item.textContent = title;
            item.style.cssText = `
                padding: 4px 8px; cursor: pointer;
                background: ${i === focusIndex ? '#2a3a4a' : 'transparent'};
            `;
            item.onmouseenter = () => { focusIndex = i; renderResults(); };
            // prevent input blur from firing before click is registered
            item.onmousedown = (e) => e.preventDefault();
            item.onclick = () => {
                inputEl.value = title;
                close();
                inputEl.focus();
            };
            dropdown.appendChild(item);
        });
        dropdown.style.display = results.length ? 'block' : 'none';
    }

    function search(value) {
        const norm = normalizeForMatch(value);
        if (!norm) { results = []; renderResults(); return; }
        results = getTitles()
            .filter(t => normalizeForMatch(t).includes(norm))
            .slice(0, 25);
        focusIndex = -1;
        renderResults();
    }

    inputEl.addEventListener('input', () => {
        positionDropdown();
        search(inputEl.value);
    });

    inputEl.addEventListener('focus', () => {
        positionDropdown();
        if (inputEl.value) search(inputEl.value);
    });

    inputEl.addEventListener('blur', () => {
        // slight delay so a click on an item can register first
        setTimeout(close, 100);
    });

    inputEl.addEventListener('keydown', (e) => {
        if (dropdown.style.display !== 'block') return;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                focusIndex = Math.min(focusIndex + 1, results.length - 1);
                renderResults();
                break;
            case 'ArrowUp':
                e.preventDefault();
                focusIndex = Math.max(focusIndex - 1, 0);
                renderResults();
                break;
            case 'Enter':
                if (focusIndex >= 0) {
                    e.preventDefault();
                    inputEl.value = results[focusIndex];
                    close();
                }
                break;
            case 'Escape':
                close();
                break;
        }
    });

    window.addEventListener('scroll', () => { if (dropdown.style.display === 'block') positionDropdown(); }, true);
    window.addEventListener('resize', positionDropdown);
}

    function renderList() {
        const listEl = document.getElementById('emq-ac-list');
        if (!listEl) return;

        const filteredRules = currentFilter
            ? autocorrects.filter(rule =>
                rule.from.toLowerCase().includes(currentFilter.toLowerCase()) ||
                rule.to.toLowerCase().includes(currentFilter.toLowerCase())
              )
            : autocorrects;

        if (!filteredRules.length) {
            const message = currentFilter
                ? `<div style="padding:10px 12px; color:#555;">No rules match "${escHtml(currentFilter)}"</div>`
                : `<div style="padding:10px 12px; color:#555;">No rules yet. Add one above.</div>`;
            listEl.innerHTML = message;
            return;
        }

        listEl.innerHTML = '';
        filteredRules.forEach((rule, i) => {
            // Find original index for deletion
            const originalIndex = autocorrects.findIndex(r => r.from === rule.from && r.to === rule.to);

            const row = document.createElement('div');
            row.style.cssText = `display:flex; align-items:center; gap:8px; padding:6px 10px;
                border-bottom:1px solid #1e1e30;`;
            row.innerHTML = `
                <span style="color:#4a90e2; flex-shrink:0; min-width:80px; max-width:130px;
                    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:bold;"
                    title="${escHtml(rule.from)}">${highlightText(rule.from, currentFilter)}</span>
                <span style="color:#555; flex-shrink:0;">→</span>
                <span style="flex:1; color:#ccc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                    title="${escHtml(rule.to)}">${highlightText(rule.to, currentFilter)}</span>
                <button data-i="${originalIndex}" class="emq-ac-del" type="button"
                    style="padding:2px 8px; background:#6b1a1a; color:#ff6b6b;
                        border:1px solid #c0392b; border-radius:4px; cursor:pointer; flex-shrink:0;">✕</button>
            `;
            listEl.appendChild(row);
        });

        listEl.querySelectorAll('.emq-ac-del').forEach(btn => {
            btn.addEventListener('click', () => {
                autocorrects.splice(parseInt(btn.dataset.i), 1);
                saveAutocorrects(autocorrects);
                renderList();
            });
        });
    }

    function highlightText(text, searchTerm) {
        if (!searchTerm) return escHtml(text);

        const escapedText = escHtml(text);
        const escapedSearch = escHtml(searchTerm);

        const regex = new RegExp(`(${escapedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapedText.replace(regex, '<span style="background:#4a90e2; color:#fff; border-radius:2px; padding:0 2px;">$1</span>');
    }

    function wireUpPane() {
        const fromInput = document.getElementById('emq-ac-from');
        const toInput   = document.getElementById('emq-ac-to');
        const addBtn    = document.getElementById('emq-ac-add');
        const refreshBtn = document.getElementById('emq-ac-refresh');

        if (!addBtn || addBtn.dataset.wired) return;
        addBtn.dataset.wired = '1';

        addBtn.addEventListener('click', () => {
            const from = fromInput.value.trim();
            const to   = toInput.value.trim();
            if (!from || !to) return;
            if (autocorrects.some(r => r.from === from)) return;
            autocorrects.push({ from, to });
            saveAutocorrects(autocorrects);
            currentFilter = '';
            fromInput.value = '';
            toInput.value = '';
            renderList();
        });

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                refreshAutocorrects();
            });
        }

        if (fromInput) {
            fromInput.addEventListener('input', (e) => {
                const value = e.target.value;
                currentFilter = value;
                renderList();
            });
        }

        [fromInput, toInput].forEach(el => {
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    if (fromInput.value.trim() && toInput.value.trim()) {
                        addBtn.click();
                    }
                }
            });
        });

        renderList();
    }

    function tryInject() {
        if (injected) return;

        const prefContainer = document.getElementById('playerPreferences');
        if (!prefContainer) return;

        const navTabs    = prefContainer.querySelector('ul.nav.nav-tabs');
        const tabContent = prefContainer.querySelector('div.tab-content');
        if (!navTabs || !tabContent) return;

        if (navTabs.querySelector('.emq-ac-navitem')) return;

        const li = document.createElement('li');
        li.className = 'nav-item emq-ac-navitem';
        li.innerHTML = `<a class="nav-link" tabindex="0" style="cursor:pointer; user-select:none;">Autocorrect</a>`;
        navTabs.appendChild(li);

        const pane = buildTabPane();
        tabContent.appendChild(pane);

        attachTitleAutocomplete(pane.querySelector('#emq-ac-to'), getAutocompleteTitles);

        const ourLink = li.querySelector('a');

        function activateOurTab() {
            navTabs.querySelectorAll('a.nav-link').forEach(a => a.classList.remove('active', 'show'));
            tabContent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active', 'show'));
            ourLink.classList.add('active', 'show');
            pane.classList.add('active', 'show');
            wireUpPane();
        }

        ourLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            activateOurTab();
        });

        navTabs.querySelectorAll('li:not(.emq-ac-navitem) a.nav-link').forEach(a => {
            a.addEventListener('click', () => {
                ourLink.classList.remove('active', 'show');
                pane.classList.remove('active', 'show');
            });
        });

        injected = true;
    }

    const observer = new MutationObserver(() => {
        if (!document.getElementById('playerPreferences')) {
            injected = false;
        } else {
            tryInject();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    tryInject();

})();