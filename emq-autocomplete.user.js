// ==UserScript==
// @name         EMQ Autocomplete
// @namespace    https://tampermonkey.net/
// @version      0.1a
// @author       Serecola & AI
// @description  EMQ autocomplete with multi-keyword matching in any order
// @match        https://erogemusicquiz.com/*
// @match        https://www.erogemusicquiz.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(async () => {
    "use strict";

    const DATA_URL = "/autocomplete/mst.json";
    const MAX_RESULTS = 25;
    const AUTOCOMPLETE_INPUT_SELECTOR = ".autocomplete input[type='search']";

    const ALLOWED_PLACEHOLDERS = new Set([
        "enter source title here",
        "enter your guess here"
    ]);

    let database = [];
    let loaded = false;

    let activeInput = null;
    let customResults = [];
    let customResultElements = [];
    let selectedIndex = -1;

    let searchTimer = null;

    const DEBUG = true;

    function log(...args) {
        if (DEBUG) {
            console.log("[EMQ Split]", ...args);
        }
    }

    function normalize(text) {
        return String(text ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "");
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

    function isAllowedInput(input) {
        const placeholder = (input.getAttribute("placeholder") || "")
            .trim()
            .toLowerCase();

        return ALLOWED_PLACEHOLDERS.has(placeholder);
    }

    async function loadDatabase() {
        log("Loading:", DATA_URL);

        const response = await fetch(
            new URL(DATA_URL, location.origin),
            { credentials: "same-origin" }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const json = await response.json();

        if (!Array.isArray(json)) {
            throw new Error("mst.json is not an array");
        }

        database = json
            .map((entry, index) => ({
                index,

                id: entry["1"],
                title: String(entry["2"] ?? ""),
                normalized: normalize(entry["4"] ?? entry["2"] ?? ""),

                titleNormalized: normalize(entry["2"] ?? ""),

                sourceType: entry["6"]
            }))
            .filter(entry => entry.title && entry.normalized);

        loaded = true;

        log("Indexed titles:", database.length);
    }

    function search(query, queryWords) {
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
            log("ERROR: .autocomplete-items not found");
            return;
        }

        menu
            .querySelectorAll(".emq-split-item")
            .forEach(element => element.remove());

        const nativeItems = getNativeItems(input);
        const nativeTitles = new Set(
            nativeItems.map(item => normalize(item.textContent))
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

        log("Displaying", dedupedResults.length, "custom results");
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
        log("Selecting:", entry.title);

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
        if (!loaded) {
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

        const results = search(query, queryWords);
        log(`Query "${query}" -> ${results.length} results`);

        renderCustomResults(input, results);
    }

    function attachInput(input) {
        if (input.dataset.emqSplitV7) {
            return;
        }

        input.dataset.emqSplitV7 = "true";
        log("Attached:", input);

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
                if (activeInput !== input || customResultElements.length === 0) {
                    return;
                }

                const nativeItems = getNativeItems(input);
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
        log("Starting...");
        await loadDatabase();
        startObserver();
        log("Ready.");
    } catch (error) {
        console.error("[EMQ Split] FAILED:", error);
    }
})();