// ==UserScript==
// @name         EMQ Autocomplete
// @namespace    https://tampermonkey.net/
// @version      0.4
// @author       Serecola & AI
// @description  EMQ autocomplete with multi-keyword matching in any order
// @match        https://erogemusicquiz.com/*
// @match        https://www.erogemusicquiz.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://github.com/Serecola/emq-scripts/raw/main/emq-autocomplete.user.js
// @updateURL    https://github.com/Serecola/emq-scripts/raw/main/emq-autocomplete.user.js
// ==/UserScript==

(async () => {
    "use strict";

    const MAX_RESULTS = 25;
    const AUTOCOMPLETE_INPUT_SELECTOR = ".autocomplete input[type='search']";

    function normalize(text) {
        return String(text ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
    }

    function stripTrailingParenthetical(text) {
        return String(text ?? "")
            .replace(/\s*\([^()]*\)\s*$/u, "")
            .trim();
    }

    function getQueryWords(query) {
        return String(query ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .split(/\s+/)
            .flatMap(word => {
                const cleaned = word.replace(/[^\p{L}\p{N}]/gu, "");
                return cleaned.match(/\p{L}+|\p{N}+/gu) || [];
            })
            .filter(Boolean);
    }

    // Each config owns one JSON dataset and the set of input placeholders
    // that should search against it.
    const SOURCE_CONFIGS = [
        {
            dataUrl: "/autocomplete/mst.json",
            placeholders: new Set([
                "enter source title here",
                "enter your guess here"
            ]),
            entries: [],
            loaded: false,
            mapEntry(entry, index) {
                const title = String(entry["2"] ?? "");
                const kanjiTitle = String(entry["3"] ?? "");
                const romajiSlug = String(entry["4"] ?? "");
                const kanjiSlug = String(entry["5"] ?? "");

                // "2" is the romaji title, "3" its kanji title, "4"/"5" are
                // punctuation-stripped versions of each. Combine all of
                // them so a mixed-script query (e.g. "魔法 silky") can match
                // the kanji half and the romaji half independently.
                const combined = [title, kanjiTitle, romajiSlug, kanjiSlug]
                    .filter(Boolean)
                    .join(" ");

                return {
                    index,
                    id: entry["1"],
                    title,
                    normalized: normalize(combined || title),
                    titleNormalized: normalize(title),
                    sourceType: entry["6"]
                };
            }
        },
        {
            dataUrl: "/autocomplete/mt.json",
            placeholders: new Set(["enter song title here"]),
            entries: [],
            loaded: false,
            mapEntry(entry, index) {
                const title = String(entry["2"] ?? "");
                const altTitle = String(entry["5"] ?? "");

                return {
                    index,
                    id: entry["1"],
                    title,
                    normalized: normalize(
                        altTitle ? `${title} ${altTitle}` : title
                    ),
                    titleNormalized: normalize(title)
                };
            }
        },
        {
            dataUrl: "/autocomplete/a.json",
            placeholders: new Set([
                "enter artist name here",
                "enter composer name here"
            ]),
            entries: [],
            loaded: false,
            mapEntry(entry, index) {
                // "3"/"4" are the display name in its two scripts (e.g.
                // "Morikawa Toshiyuki" / "森川 智之"). "8"/"9" are the same
                // name with given/family order swapped, so searching either
                // order still matches.
                const title = String(entry["3"] ?? entry["4"] ?? "");
                const altTitle = String(entry["4"] ?? "");
                const swapped = String(entry["8"] ?? "");
                const swappedAlt = String(entry["9"] ?? "");

                const combined = [title, altTitle, swapped, swappedAlt]
                    .filter(Boolean)
                    .join(" ");

                return {
                    index,
                    id: entry["1"],
                    title,
                    normalized: normalize(combined || title),
                    titleNormalized: normalize(title)
                };
            }
        },
        {
            dataUrl: "/autocomplete/developer.json",
            placeholders: new Set(["enter developer name here"]),
            entries: [],
            loaded: false,
            mapEntry(entry, index) {
                // "3"/"5" are native-script variants of the name (sometimes
                // two slightly different readings); "4" is a plain romaji
                // slug. All are folded into the searchable text.
                const title = String(entry["2"] ?? "");
                const altTitle = String(entry["3"] ?? "");
                const altTitle2 = String(entry["5"] ?? "");
                const romajiSlug = String(entry["4"] ?? "");

                const combined = [title, altTitle, altTitle2, romajiSlug]
                    .filter(Boolean)
                    .join(" ");

                return {
                    index,
                    id: entry["1"],
                    title,
                    normalized: normalize(combined || title),
                    titleNormalized: normalize(title)
                };
            }
        }
    ];

    // Maps an attached <input> to the SOURCE_CONFIGS entry it should search.
    const inputConfigs = new WeakMap();

    let activeInput = null;
    let customResults = [];
    let customResultElements = [];
    let selectedIndex = -1;

    let searchTimer = null;

    function getConfigForInput(input) {
        const placeholder = (input.getAttribute("placeholder") || "")
            .trim()
            .toLowerCase();

        return SOURCE_CONFIGS.find(config =>
            config.placeholders.has(placeholder)
        );
    }

    function isAllowedInput(input) {
        return Boolean(getConfigForInput(input));
    }

    async function loadDatabase(config) {

        try {
            const response = await fetch(
                new URL(config.dataUrl, location.origin),
                { credentials: "same-origin" }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const json = await response.json();

            if (!Array.isArray(json)) {
                throw new Error(`${config.dataUrl} is not an array`);
            }

            config.entries = json
                .map((entry, index) => config.mapEntry(entry, index))
                .filter(entry => entry.title && entry.normalized);

            config.loaded = true;

        } catch (error) {
            console.error("[EMQ Split] Failed to load", config.dataUrl, error);
            config.entries = [];
            config.loaded = false;
        }
    }

    async function loadAllDatabases() {
        await Promise.all(SOURCE_CONFIGS.map(loadDatabase));
    }

    function search(query, queryWords, database) {
        const normalizedQuery = normalize(query);

        const sortedWords = [...queryWords].sort(
            (a, b) => b.length - a.length
        );

        const results = [];

        for (const entry of database) {
            let matches = true;
            let score = 0;

            for (const keyword of sortedWords) {
                const position = entry.normalized.indexOf(keyword);

                if (position === -1) {
                    matches = false;
                    break;
                }

                score += position === 0 ? 500 : Math.max(1, 100 - position);
                score += keyword.length * 10;
            }

            if (!matches) {
                continue;
            }

            if (entry.normalized === normalizedQuery) {
                score += 10000;
            }

            if (entry.normalized.includes(normalizedQuery)) {
                score += 2000;
            }

            // Prefer shorter titles when scores are similar.
            score -= entry.normalized.length;

            results.push({ entry, score });
        }

        results.sort((a, b) =>
            a.score !== b.score
                ? b.score - a.score
                : a.entry.index - b.entry.index
        );

        return results.slice(0, MAX_RESULTS).map(x => x.entry);
    }

    function getAutocomplete(input) {
        return input.closest(".autocomplete");
    }

    function getMenu(input) {
        return getAutocomplete(input)?.querySelector(".autocomplete-items");
    }

    function getNativeItems(input) {
        const menu = getMenu(input);

        if (!menu) {
            return [];
        }

        return Array.from(menu.children).filter(
            element =>
                element.id &&
                element.id.startsWith("autocomplete-item-") &&
                !element.classList.contains("emq-split-item")
        );
    }

    function clearCustomResults() {
        const menu = activeInput ? getMenu(activeInput) : null;

        if (menu) {
            menu
                .querySelectorAll(".emq-split-item")
                .forEach(element => element.remove());
        }

        customResults = [];
        customResultElements = [];
        selectedIndex = -1;

        updateActiveResult();
    }

    function copyElementAttributes(source, target) {
        if (!source) {
            return;
        }

        for (const attribute of source.attributes) {
            if (attribute.name === "id" || attribute.name === "style") {
                continue;
            }

            target.setAttribute(attribute.name, attribute.value);
        }
    }

    function createResultElement(input, entry, combinedIndex, template) {
        const element = document.createElement("div");

        copyElementAttributes(template, element);

        element.classList.remove("autocomplete-active");

        element.id = `autocomplete-item-${combinedIndex}`;
        element.classList.add("emq-split-item");
        element.textContent = entry.title;

        element.addEventListener(
            "mouseenter",
            () => {
                selectedIndex = combinedIndex;
                updateActiveResult();
            },
            { passive: true }
        );

        // Prevent blur when clicking a result.
        element.addEventListener("mousedown", event => {
            event.preventDefault();
        });

        element.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            await selectResult(input, entry);
        });

        return element;
    }

    function renderCustomResults(input, results) {
        const menu = getMenu(input);

        if (!menu) {
            return;
        }

        menu
            .querySelectorAll(".emq-split-item")
            .forEach(element => element.remove());

        const nativeItems = getNativeItems(input);

        // Native items sometimes render as "Title (Native Script)" (e.g.
        // artist/developer entries showing a Japanese reading alongside the
        // romaji name). Strip that trailing parenthetical before comparing
        // so it can still match our plain-title entries and won't be
        // duplicated in the custom overlay.
        const nativeTitles = new Set(
            nativeItems.map(item =>
                normalize(stripTrailingParenthetical(item.textContent))
            )
        );

        const dedupedResults = results.filter(
            entry => !nativeTitles.has(entry.titleNormalized)
        );

        customResults = dedupedResults;
        customResultElements = [];
        selectedIndex = -1;

        if (dedupedResults.length === 0) {
            return;
        }

        let template = nativeItems[0];

        if (!template) {
            template = document.createElement("div");

            for (const attribute of Array.from(menu.attributes)) {
                if (attribute.name.startsWith("b-")) {
                    template.setAttribute(attribute.name, attribute.value);
                }
            }
        }

        menu.style.display = "block";

        const fragment = document.createDocumentFragment();

        for (let i = 0; i < dedupedResults.length; i++) {
            const element = createResultElement(
                input,
                dedupedResults[i],
                nativeItems.length + i,
                template
            );

            fragment.appendChild(element);
            customResultElements.push(element);
        }

        menu.appendChild(fragment);

    }

    function updateActiveResult() {
        if (!activeInput) {
            return;
        }

        const items = [...getNativeItems(activeInput), ...customResultElements];

        items.forEach((item, index) => {
            item.classList.toggle(
                "autocomplete-active",
                index === selectedIndex
            );
        });

        if (selectedIndex >= 0 && selectedIndex < items.length) {
            items[selectedIndex].scrollIntoView({ block: "nearest" });
        }
    }

    function setInputValue(input, value) {
        const descriptor = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value"
        );

        if (descriptor?.set) {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }

        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function waitForNativeResult(input, title) {
        const wanted = normalize(title);

        const existing = getNativeItems(input).find(
            item => normalize(item.textContent) === wanted
        );

        if (existing) {
            return Promise.resolve(existing);
        }

        const menu = getMenu(input);

        if (!menu) {
            return Promise.resolve(null);
        }

        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const match = getNativeItems(input).find(
                    item => normalize(item.textContent) === wanted
                );

                if (match) {
                    clearTimeout(timeoutId);
                    observer.disconnect();
                    resolve(match);
                }
            });

            const timeoutId = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, 2000);

            observer.observe(menu, { childList: true, subtree: true });
        });
    }

    async function selectResult(input, entry) {

        clearCustomResults();
        setInputValue(input, entry.title);

        const nativeResult = await waitForNativeResult(input, entry.title);

        if (!nativeResult) {
            console.error("[EMQ Split] Native result not found:", entry.title);
            return;
        }

        nativeResult.click();
    }

    function performSearch(input) {
        const config = inputConfigs.get(input);

        if (!config || !config.loaded) {
            return;
        }

        activeInput = input;

        const query = input.value.trim();

        if (query.toLowerCase().startsWith("id:")) {
            clearCustomResults();
            return;
        }

        const queryWords = getQueryWords(query);

        if (queryWords.length < 2) {
            clearCustomResults();
            return;
        }

        const results = search(query, queryWords, config.entries);

        renderCustomResults(input, results);
    }

    function attachInput(input) {
        if (input.dataset.emqSplitV7) {
            return;
        }

        const config = getConfigForInput(input);

        if (!config) {
            return;
        }

        inputConfigs.set(input, config);

        input.dataset.emqSplitV7 = "true";

        input.addEventListener(
            "input",
            () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => performSearch(input), 30);
            },
            { capture: true, passive: true }
        );

        input.addEventListener(
            "keydown",
            async event => {
                if (activeInput !== input) {
                    return;
                }

                const nativeItems = getNativeItems(input);

                // No custom overlay is showing. Only step in for Enter, to
                // auto-select the first native suggestion if nothing is
                // already highlighted (native site behavior otherwise
                // leaves Enter unhandled and submits the raw text).
                if (customResultElements.length === 0) {
                    const isEnter =
                        event.key === "Enter" || event.key === "NumpadEnter";

                    if (!isEnter || nativeItems.length === 0 || event.ctrlKey) {
                        // Ctrl+Enter is left alone (no auto-select of the
                        // first native result) so it can be used for
                        // whatever the site itself binds it to.
                        return;
                    }

                    const hasNativeActive = nativeItems.some(item =>
                        item.classList.contains("autocomplete-active")
                    );

                    if (hasNativeActive) {
                        return;
                    }

                    event.preventDefault();
                    event.stopImmediatePropagation();

                    nativeItems[0].click();

                    return;
                }

                const combinedLength = nativeItems.length + customResultElements.length;

                switch (event.key) {
                    case "ArrowDown":
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        selectedIndex = Math.min(
                            selectedIndex + 1,
                            combinedLength - 1
                        );
                        updateActiveResult();
                        break;

                    case "ArrowUp":
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        selectedIndex = Math.max(selectedIndex - 1, 0);
                        updateActiveResult();
                        break;

                    case "Enter":
                    case "NumpadEnter": {
                        event.preventDefault();
                        event.stopImmediatePropagation();

                        const index = selectedIndex >= 0 ? selectedIndex : 0;

                        if (index < nativeItems.length) {
                            nativeItems[index]?.click();
                        } else {
                            const result =
                                customResults[index - nativeItems.length];

                            if (result) {
                                await selectResult(input, result);
                            }
                        }

                        break;
                    }

                    case "Escape":
                        clearCustomResults();
                        break;
                }
            },
            true
        );

        input.addEventListener(
            "blur",
            () => {
                setTimeout(() => {
                    if (document.activeElement !== input) {
                        clearCustomResults();
                    }
                }, 200);
            },
            { passive: true }
        );
    }

    function collectAllowedInputs(node, into) {
        if (!(node instanceof Element)) {
            return;
        }

        if (node.matches(AUTOCOMPLETE_INPUT_SELECTOR)) {
            into.push(node);
        }

        node
            .querySelectorAll?.(AUTOCOMPLETE_INPUT_SELECTOR)
            .forEach(element => into.push(element));
    }

    function startObserver() {
        const observer = new MutationObserver(mutations => {
            const candidates = [];

            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node =>
                    collectAllowedInputs(node, candidates)
                );
            }

            for (const input of candidates) {
                if (isAllowedInput(input)) {
                    attachInput(input);
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        document
            .querySelectorAll(AUTOCOMPLETE_INPUT_SELECTOR)
            .forEach(input => {
                if (isAllowedInput(input)) {
                    attachInput(input);
                }
            });
    }

    try {
        await loadAllDatabases();
        startObserver();
    } catch (error) {
        console.error("[EMQ Split] FAILED:", error);
    }
})();