// ==UserScript==
// @name         EMQ Bulk Collection Edit
// @namespace    https://github.com/Serecola
// @version      1.3
// @description  Bulk edit songs in an EMQ collection
// @author       Serecola
// @match        https://erogemusicquiz.com/*
// @downloadURL  https://github.com/Serecola/emq-scripts/raw/main/emq-bulk-collections.user.js
// @updateURL    https://github.com/Serecola/emq-scripts/raw/main/emq-bulk-collections.user.js
// ==/UserScript==

(function () {
    'use strict';

    function getSession() {
        const session = JSON.parse(localStorage.getItem('session'));
        return { userId: session.Player.Id, token: session.Token };
    }

    const collectionEntitiesMap = {};

    const panel = document.createElement('div');
    panel.id = 'emq-panel';
    panel.style.cssText = `
        position: fixed; bottom: 50px; right: 0; z-index: 99999;
        background: #1a1a2e; color: #eee; border-radius: 4px 4px 0 0;
        width: auto; font-family: sans-serif; font-size: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5); border: 1px solid #444;
        margin-right: 2px;
    `;
    panel.innerHTML = `
        <div id="emq-header" style="display:flex; justify-content:space-between; align-items:center; padding: 2px 5px; height:40px; box-sizing:border-box; cursor:pointer;">
            <span id="emq-title" style="font-weight:bold; font-size:15px; padding: 0 4px; white-space:nowrap;"> Bulk Collection Edit</span>
            <span id="emq-minimize" style="color:#aaa; font-size:20px; padding: 0 2px; line-height:1; user-select:none;">−</span>
        </div>
        <div id="emq-body" style="padding: 0px 12px 12px 12px; width: 280px; box-sizing:border-box;">
            <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 8px;">
                <label style="font-size:13px; flex-shrink: 0;">Collection</label>
                <select id="emq-collection-id" style="flex: 1; padding:4px; border-radius:5px; border:1px solid #555; background:#111; color:#fff; font-size:13px;">
                    <option disabled selected>Loading...</option>
                </select>
                <button id="emq-refresh" style="padding:4px 8px; background:#4a90e2; color:#fff; border:none; border-radius:5px; cursor:pointer; font-size:13px; flex-shrink: 0;" title="Refresh collections">🔄</button>
            </div>
            <label style="font-size:13px;">Song IDs (comma separated)</label>
            <textarea id="emq-entity-ids" rows="4" placeholder="e.g. 5068, 5069, 5070" style="width:100%; margin:3px 0 8px; padding:4px; border-radius:5px; border:1px solid #555; background:#111; color:#fff; resize:vertical; font-size:13px;"></textarea>
            <button id="emq-start" style="width:100%; padding:6px; background:#4a90e2; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px;">▶ Start</button>
            <button id="emq-stop" style="display:none; width:100%; margin-top:5px; padding:6px; background:#c0392b; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px;">⏹ Stop</button>

            <hr style="border-color:#333; margin: 5px 0;">

            <!-- Delete section -->
            <div id="emq-delete-confirm" style="display:none; background:#2a0a0a; border:1px solid #c0392b; border-radius:6px; padding:8px; margin-bottom:6px; font-size:13px; text-align:center;">
                <div style="margin-bottom:6px; color:#ff6b6b;">⚠️ Delete ALL songs from this collection?</div>
                <div style="display:flex; gap:5px;">
                    <button id="emq-delete-yes" style="flex:1; padding:5px; background:#c0392b; color:#fff; border:none; border-radius:5px; cursor:pointer; font-size:13px;">Yes, delete</button>
                    <button id="emq-delete-no" style="flex:1; padding:5px; background:#444; color:#fff; border:none; border-radius:5px; cursor:pointer; font-size:13px;">Cancel</button>
                </div>
            </div>
            <button id="emq-delete" style="width:100%; padding:6px; background:#6b1a1a; color:#ff6b6b; border:1px solid #c0392b; border-radius:6px; cursor:pointer; font-size:14px;">🗑 Clear Collection</button>

            <div id="emq-status" style="margin-top:8px; font-size:13px; color:#aaa; min-height:16px; display: none;"></div>
            <div id="emq-progress" style="margin-top:4px; font-size:13px; color:#aaa; display: none;"></div>
        </div>
    `;
    document.body.appendChild(panel);

    const statusEl = document.getElementById('emq-status');
    const progressEl = document.getElementById('emq-progress');
    const startBtn = document.getElementById('emq-start');
    const stopBtn = document.getElementById('emq-stop');
    const deleteBtn = document.getElementById('emq-delete');
    const deleteConfirm = document.getElementById('emq-delete-confirm');
    const deleteYes = document.getElementById('emq-delete-yes');
    const deleteNo = document.getElementById('emq-delete-no');
    const collectionSelect = document.getElementById('emq-collection-id');
    const refreshBtn = document.getElementById('emq-refresh');
    const header = document.getElementById('emq-header');
    const title = document.getElementById('emq-title');
    const minimizeIcon = document.getElementById('emq-minimize');
    const body = document.getElementById('emq-body');

    let stopRequested = false;
    let statusTimeout = null;

    // Helper function to show status area and update text
    function setStatus(message, isError = false, autoHide = true) {
        // Clear any existing auto-hide timeout
        if (statusTimeout) {
            clearTimeout(statusTimeout);
        }

        // Show status area if it's hidden
        if (statusEl.style.display === 'none') {
            statusEl.style.display = 'block';
        }

        // Update status text and color
        statusEl.textContent = message;
        statusEl.style.color = isError ? '#ff6b6b' : '#aaa';

        // Auto-hide after 3 seconds if specified
        if (autoHide && !message.includes('Loading') && !message.includes('Adding') && !message.includes('Removing') && !message.includes('...')) {
            statusTimeout = setTimeout(() => {
                statusEl.style.display = 'none';
                statusEl.textContent = '';
                statusEl.style.color = '#aaa';
                statusTimeout = null;
            }, 3000);
        }
    }

    // Helper function to show progress area
    function setProgress(message, show = true) {
        if (show && message) {
            if (progressEl.style.display === 'none') {
                progressEl.style.display = 'block';
            }
            progressEl.textContent = message;
        } else if (!show) {
            progressEl.style.display = 'none';
            progressEl.textContent = '';
        }
    }

    // Helper function to clear status and progress
    function clearStatusAndProgress() {
        if (statusTimeout) {
            clearTimeout(statusTimeout);
            statusTimeout = null;
        }
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        statusEl.style.color = '#aaa';
        progressEl.style.display = 'none';
        progressEl.textContent = '';
    }

    // Load minimized state from localStorage (default: false/expanded)
    let minimized = localStorage.getItem('emq_minimized') === 'true';

    // Helper function to show/hide stop button based on operation state
    function setOperationState(isRunning) {
        if (isRunning) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            deleteBtn.disabled = true;
            refreshBtn.disabled = true;
        } else {
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            deleteBtn.disabled = false;
            refreshBtn.disabled = false;
            // Clear status and progress when operation finishes
            clearStatusAndProgress();
        }
    }

    // Apply minimized state on load
    function applyMinimizedState() {
        if (minimized) {
            body.style.display = 'none';
            title.style.display = 'none';
            minimizeIcon.textContent = '+';
        } else {
            body.style.display = 'block';
            title.style.display = 'inline';
            minimizeIcon.textContent = '−';
        }
    }

    // Toggle minimized state and save to localStorage
    function toggleMinimized() {
        minimized = !minimized;
        localStorage.setItem('emq_minimized', minimized);

        if (minimized) {
            body.style.display = 'none';
            title.style.display = 'none';
            minimizeIcon.textContent = '+';
        } else {
            body.style.display = 'block';
            title.style.display = 'inline';
            minimizeIcon.textContent = '−';
        }
    }

    header.addEventListener('click', (e) => {
        // Prevent toggling if clicking on the minimize icon itself (to avoid double toggle)
        if (e.target === minimizeIcon) {
            return;
        }
        toggleMinimized();
    });

    minimizeIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMinimized();
    });

    // Apply initial state
    applyMinimizedState();

    // --- Update dropdown label with current song count ---
    function updateCollectionCount(collectionId) {
        const count = (collectionEntitiesMap[collectionId] || []).length;
        for (const option of collectionSelect.options) {
            if (parseInt(option.value) === collectionId) {
                const name = option.textContent.replace(/\s*\(.*\)$/, '');
                option.textContent = `${name} (${count} songs)`;
                break;
            }
        }
    }

    async function loadCollections(showStatus = true) {
        if (showStatus) {
            setStatus('🔄 Loading collections...', false, false);
        }

        const { userId, token } = getSession();
        try {
            const res1 = await fetch('/Library/GetUserCollections', {
                method: 'POST',
                headers: { 'authorization': token, 'content-type': 'application/json; charset=utf-8' },
                body: JSON.stringify(userId)
            });
            const collectionIds = await res1.json();

            const res2 = await fetch('/Library/GetCollectionContainers', {
                method: 'POST',
                headers: { 'authorization': token, 'content-type': 'application/json; charset=utf-8' },
                body: JSON.stringify(collectionIds)
            });
            const data = await res2.json();

            const currentSelection = collectionSelect.value;
            collectionSelect.innerHTML = '';

            for (const container of data.collectionContainers) {
                const { id, name } = container.collection;
                const count = container.collectionEntities.length;
                collectionEntitiesMap[id] = container.collectionEntities;

                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${name} (${count} songs)`;
                collectionSelect.appendChild(option);
            }

            // Restore previous selection if it still exists
            if (currentSelection && [...collectionSelect.options].some(opt => opt.value === currentSelection)) {
                collectionSelect.value = currentSelection;
            }

            if (showStatus) {
                setStatus(`✅ Loaded ${data.collectionContainers.length} collections.`);
            }
        } catch (err) {
            if (showStatus) {
                collectionSelect.innerHTML = '<option disabled selected>Failed to load</option>';
                setStatus(`❌ ${err.message}`, true);
            }
        }
    }

    // Refresh button handler
    refreshBtn.addEventListener('click', () => {
        loadCollections(true);
    });

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function addEntity(collectionId, entityId, token) {
        return await fetch('/Library/ModifyCollectionEntity', {
            method: 'POST',
            headers: { 'authorization': token, 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ collectionId, entityId, isAdded: true })
        });
    }

    async function removeEntity(collectionId, entityId, token) {
        return await fetch('/Library/ModifyCollectionEntity', {
            method: 'POST',
            headers: { 'authorization': token, 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ collectionId, entityId, isAdded: false })
        });
    }

    // --- Add button ---
    startBtn.addEventListener('click', async () => {
        const collectionId = parseInt(collectionSelect.value);
        const raw = document.getElementById('emq-entity-ids').value;
        const entityIds = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

        if (!entityIds.length) {
            setStatus('⚠️ No valid IDs entered.', true);
            return;
        }

        const existingIds = new Set(
            (collectionEntitiesMap[collectionId] || []).map(e => e.entity_id)
        );

        const toAdd = entityIds.filter(id => !existingIds.has(id));
        const skipped = entityIds.length - toAdd.length;

        if (!toAdd.length) {
            setStatus('⚠️ All IDs already in collection.', true);
            return;
        }
        if (skipped > 0) {
            setStatus(`ℹ️ Skipping ${skipped} duplicate(s)...`, false, false);
            await sleep(800);
        }

        const { token } = getSession();
        stopRequested = false;
        setOperationState(true);

        for (let i = 0; i < toAdd.length; i++) {
            if (stopRequested) {
                setStatus('⛔ Stopped.', true);
                break;
            }

            const entityId = toAdd[i];
            setStatus(`⏳ Adding ${entityId}...`, false, false);
            setProgress(`${i + 1} / ${toAdd.length}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);

            try {
                const res = await addEntity(collectionId, entityId, token);
                if (res.ok) {
                    collectionEntitiesMap[collectionId].push({ entity_id: entityId });
                    updateCollectionCount(collectionId);
                    setStatus(`✅ Added ${entityId}.`);
                } else {
                    setStatus(`❌ Failed ${entityId} (${res.status}).`, true);
                }
            } catch (err) {
                setStatus(`❌ Error: ${err.message}`, true);
            }

            if (i < toAdd.length - 1 && !stopRequested) {
                for (let s = 5; s > 0; s--) {
                    if (stopRequested) break;
                    setProgress(`${i + 1} / ${toAdd.length} — next in ${(s * 0.1).toFixed(1)}s`);
                    await sleep(100);
                }
            }
        }

        if (!stopRequested) {
            setStatus('🎉 All done!');
            setProgress(`Added ${toAdd.length}${skipped > 0 ? `, skipped ${skipped} duplicate(s)` : ''}`, true);
            setTimeout(() => {
                setProgress('', false);
            }, 3000);
        }

        setOperationState(false);
    });

    stopBtn.addEventListener('click', () => { stopRequested = true; });

    // --- Delete button: show confirm ---
    deleteBtn.addEventListener('click', () => {
        const count = (collectionEntitiesMap[parseInt(collectionSelect.value)] || []).length;
        if (count === 0) {
            setStatus('⚠️ Collection is already empty.', true);
            return;
        }
        deleteConfirm.style.display = 'block';
        deleteBtn.style.display = 'none';
    });

    deleteNo.addEventListener('click', () => {
        deleteConfirm.style.display = 'none';
        deleteBtn.style.display = 'block';
    });

    // --- Confirmed delete ---
    deleteYes.addEventListener('click', async () => {
        deleteConfirm.style.display = 'none';

        const collectionId = parseInt(collectionSelect.value);
        const entities = [...(collectionEntitiesMap[collectionId] || [])];

        if (!entities.length) {
            setStatus('⚠️ Nothing to delete.', true);
            return;
        }

        const { token } = getSession();
        setOperationState(true);
        stopRequested = false;

        for (let i = 0; i < entities.length; i++) {
            if (stopRequested) {
                setStatus('⛔ Stopped.', true);
                break;
            }

            const entityId = entities[i].entity_id;
            setStatus(`🗑 Removing ${entityId}...`, false, false);
            setProgress(`${i + 1} / ${entities.length}`);

            try {
                const res = await removeEntity(collectionId, entityId, token);
                if (res.ok) {
                    collectionEntitiesMap[collectionId] = collectionEntitiesMap[collectionId].filter(e => e.entity_id !== entityId);
                    updateCollectionCount(collectionId);
                    setStatus(`✅ Removed ${entityId}.`);
                } else {
                    setStatus(`❌ Failed to remove ${entityId} (${res.status}).`, true);
                }
            } catch (err) {
                setStatus(`❌ Error: ${err.message}`, true);
            }

            if (i < entities.length - 1 && !stopRequested) {
                await sleep(500);
            }
        }

        if (!stopRequested) {
            setStatus('🗑 Collection cleared.');
            setProgress(`Removed ${entities.length} songs.`, true);
            setTimeout(() => {
                setProgress('', false);
            }, 3000);
        }

        setOperationState(false);
        deleteBtn.style.display = 'block';
    });

    loadCollections(true);
})();