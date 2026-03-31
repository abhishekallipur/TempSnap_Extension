document.addEventListener('DOMContentLoaded', () => {
    const snapBtn = document.getElementById('snapBtn');
    const previewCard = document.getElementById('previewCard');
    const previewImage = document.getElementById('previewImage');
    const editCanvas = document.getElementById('editCanvas');
    const quickEditBar = document.getElementById('quickEditBar');
    const editApplyBtn = document.getElementById('editApplyBtn');
    const editResetBtn = document.getElementById('editResetBtn');
    const editCancelBtn = document.getElementById('editCancelBtn');
    const quickToolButtons = Array.from(document.querySelectorAll('.quick-tool-btn'));
    const timerWrap = document.getElementById('timerWrap');
    const deleteText = document.getElementById('deleteText');
    const progressFill = document.getElementById('progressFill');
    const ringProgress = document.getElementById('ringProgress');
    const timerRing = document.querySelector('.timer-ring');
    const statusMsg = document.getElementById('statusMsg');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsFlyout = document.getElementById('settingsFlyout');
    const timerInput = document.getElementById('timerInput');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const recentStrip = document.getElementById('recentStrip');
    const recentList = document.getElementById('recentList');
    const godModeBtn = document.getElementById('godModeBtn');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const godModeBar = document.getElementById('godModeBar');
    const selectedCount = document.getElementById('selectedCount');
    const copyMultiBtn = document.getElementById('copyMultiBtn');

    const copyBtn = document.getElementById('copyBtn');
    const pinBtn = document.getElementById('pinBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    const confirmationOverlay = document.getElementById('confirmationOverlay');
    const confirmationPreview = document.getElementById('confirmationPreview');
    const confirmationTimer = document.getElementById('confirmationTimer');
    const confirmationDismiss = document.getElementById('confirmationDismiss');
    const onboardingOverlay = document.getElementById('onboardingOverlay');
    const onboardingTitle = document.getElementById('onboardingTitle');
    const onboardingText = document.getElementById('onboardingText');
    const onboardingSkip = document.getElementById('onboardingSkip');
    const onboardingPrev = document.getElementById('onboardingPrev');
    const onboardingNext = document.getElementById('onboardingNext');
    const onboardingDots = Array.from(document.querySelectorAll('.onboarding-dot'));

    const RING_CIRCUMFERENCE = 94.25;

    let captureState = null;
    let captures = [];
    let isGodMode = false;
    let selectedKeys = new Set();
    let countdownInterval = null;
    let currentTimerMinutes = 10;
    let isDarkMode = false;
    let lastCaptureKey = null;
    let confirmationTimeout = null;
    let isEditMode = false;
    let activeEditTool = 'crop';
    let isDrawing = false;
    let drawStart = null;
    let canvasSnapshot = null;
    let originalEditDataUrl = '';
    let onboardingStep = 0;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    const onboardingSteps = [
        {
            title: 'Capture in One Click',
            text: 'Tap Capture & Copy or use Ctrl + Shift + X to start.'
        },
        {
            title: 'Edit on Full Screen',
            text: 'Drag your area, then use crop, blur, arrow, and highlight before saving.'
        },
        {
            title: 'Manage from Recent Snaps',
            text: 'Use the strip to switch captures, pin important ones, or multi-copy in God Mode.'
        }
    ];

    const DEFAULT_EDITOR_SHORTCUTS = {
        crop: 'C',
        highlight: 'H',
        arrow: 'A',
        blur: 'B',
        reset: 'R',
        save: 'ENTER',
        cancel: 'ESC'
    };

    let editorShortcuts = null;

    initialize();

    async function initialize() {
        currentTimerMinutes = await ensureTimerMinutes();
        timerInput.value = String(currentTimerMinutes);
        isDarkMode = await ensureDarkModeSetting();
        applyDarkMode(isDarkMode);
        await loadCaptures();
        await renderState(true);
        editorShortcuts = await ensureEditorShortcuts();
        renderShortcutInputs();
        bindEvents();
        await maybeShowOnboarding();
    }

    function bindEvents() {
        snapBtn.addEventListener('click', () => {
            snapBtn.disabled = true;
            snapBtn.innerHTML = '<span>Opening selection...</span>';
            chrome.runtime.sendMessage({ action: 'TRIGGER_SELECTION' });
            window.close();
        });

        copyBtn.addEventListener('click', handleCopy);
        pinBtn.addEventListener('click', togglePin);
        deleteBtn.addEventListener('click', handleDelete);
        editApplyBtn.addEventListener('click', applyEdits);
        editResetBtn.addEventListener('click', resetEdits);
        editCancelBtn.addEventListener('click', () => stopEditMode(false));

        settingsBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const isOpening = settingsFlyout.classList.contains('hidden');
            settingsFlyout.classList.toggle('hidden');
            settingsBtn.setAttribute('aria-expanded', isOpening ? 'true' : 'false');
            if (isOpening) {
                timerInput.focus();
                timerInput.select();
            }
        });

        settingsFlyout.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        document.addEventListener('click', () => {
            settingsFlyout.classList.add('hidden');
            settingsBtn.setAttribute('aria-expanded', 'false');
        });

        timerInput.addEventListener('change', persistTimerSetting);
        timerInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                timerInput.blur();
            }
        });

        darkModeToggle.addEventListener('click', toggleDarkMode);

        const shortcutInputs = [
            { element: document.getElementById('shortcutCrop'), key: 'crop' },
            { element: document.getElementById('shortcutHighlight'), key: 'highlight' },
            { element: document.getElementById('shortcutArrow'), key: 'arrow' },
            { element: document.getElementById('shortcutBlur'), key: 'blur' },
            { element: document.getElementById('shortcutReset'), key: 'reset' },
            { element: document.getElementById('shortcutSave'), key: 'save' },
            { element: document.getElementById('shortcutCancel'), key: 'cancel' }
        ];
        shortcutInputs.forEach(({ element, key }) => {
            if (element) {
                bindShortcutInput(element, key);
            }
        });

        quickToolButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                activeEditTool = btn.dataset.tool || 'crop';
                updateActiveToolButton();
            });
        });

        editCanvas.addEventListener('mousedown', onCanvasMouseDown);
        editCanvas.addEventListener('mousemove', onCanvasMouseMove);
        window.addEventListener('mouseup', onCanvasMouseUp);

        confirmationDismiss.addEventListener('click', hideConfirmation);
        confirmationOverlay.addEventListener('click', (event) => {
            if (event.target === confirmationOverlay) {
                hideConfirmation();
            }
        });

        if (onboardingOverlay && onboardingSkip && onboardingPrev && onboardingNext) {
            onboardingSkip.addEventListener('click', completeOnboarding);
            onboardingPrev.addEventListener('click', () => {
                if (onboardingStep > 0) {
                    onboardingStep -= 1;
                    renderOnboardingStep();
                }
            });
            onboardingNext.addEventListener('click', () => {
                if (onboardingStep < onboardingSteps.length - 1) {
                    onboardingStep += 1;
                    renderOnboardingStep();
                    return;
                }
                completeOnboarding();
            });

            onboardingOverlay.addEventListener('click', (event) => {
                if (event.target === onboardingOverlay) {
                    completeOnboarding();
                }
            });
        }

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local') {
                Object.keys(changes).forEach((key) => {
                    // Handle new captures - show confirmation
                    if (key.startsWith('capture_') && changes[key].newValue && !changes[key].oldValue) {
                        lastCaptureKey = key;
                        showConfirmation(changes[key].newValue);
                    }
                    // Handle deleted captures - reload UI
                    if (key.startsWith('capture_') && !changes[key].newValue && changes[key].oldValue) {
                        console.log(`[TempSnap] Image deleted: ${key}`);
                        // If the deleted image was the current one, load a different one
                        if (captureState && captureState.key === key) {
                            loadCaptures();
                            renderState();
                        } else {
                            // Just update the recent strip if not the active one
                            loadCaptures();
                            renderRecentStrip();
                        }
                    }
                });
            }
        });

        godModeBtn.addEventListener('click', () => {
            isGodMode = !isGodMode;
            godModeBtn.classList.toggle('active', isGodMode);
            godModeBar.classList.toggle('hidden', !isGodMode);
            selectAllBtn.classList.toggle('hidden', !isGodMode);

            if (!isGodMode) {
                selectedKeys.clear();
                updateGodModeUI();
            }

            renderRecentStrip();
        });

        selectAllBtn.addEventListener('click', () => {
            if (!isGodMode) {
                return;
            }

            const allSelected = captures.length > 0 && selectedKeys.size === captures.length;
            if (allSelected) {
                selectedKeys.clear();
            } else {
                selectedKeys = new Set(captures.map((item) => item.key));
            }

            updateGodModeUI();
            renderRecentStrip();
        });

        copyMultiBtn.addEventListener('click', () => {
            const keys = Array.from(selectedKeys);
            if (keys.length === 0) {
                return;
            }

            chrome.runtime.sendMessage({
                action: 'MULTIPASTE',
                keys
            });
            window.close();
        });
    }

    async function persistTimerSetting() {
        let value = parseInt(timerInput.value, 10);
        if (!Number.isFinite(value)) {
            value = currentTimerMinutes;
        }

        value = Math.min(1440, Math.max(1, value));
        timerInput.value = String(value);

        if (value === currentTimerMinutes) {
            return;
        }

        currentTimerMinutes = value;
        await chrome.storage.local.set({ timerMinutes: currentTimerMinutes });
        await rescheduleUnpinnedJanitors(currentTimerMinutes);

        captures = captures.map((item) => ({
            ...item,
            durationMs: currentTimerMinutes * 60 * 1000
        }));

        if (captureState) {
            captureState.durationMs = currentTimerMinutes * 60 * 1000;
            updateCountdown();
        }

        statusMsg.textContent = `Auto-delete set to ${currentTimerMinutes} min.`;
    }

    async function ensureTimerMinutes() {
        const { timerMinutes } = await chrome.storage.local.get('timerMinutes');
        const minutes = parseInt(timerMinutes, 10);
        if (Number.isFinite(minutes) && minutes > 0) {
            return minutes;
        }

        await chrome.storage.local.set({ timerMinutes: 10 });
        return 10;
    }

    async function loadCaptures(preferredKey = null) {
        const { pinnedCaptureKey } = await chrome.storage.local.get('pinnedCaptureKey');
        const items = await chrome.storage.local.get(null);

        captures = Object.entries(items)
            .filter(([key]) => key.startsWith('capture_'))
            .map(([key, dataUrl]) => ({
                key,
                dataUrl,
                timestamp: parseInt(key.replace('capture_', ''), 10),
                durationMs: currentTimerMinutes * 60 * 1000,
                isPinned: pinnedCaptureKey === key
            }))
            .sort((a, b) => b.timestamp - a.timestamp);

        if (captures.length === 0) {
            captureState = null;
            return;
        }

        const targetKey = preferredKey || (captureState && captureState.key) || captures[0].key;
        captureState = captures.find((item) => item.key === targetKey) || captures[0];
        renderRecentStrip();
    }

    function renderRecentStrip() {
        if (captures.length <= 1) {
            recentStrip.classList.add('hidden');
            recentList.innerHTML = '';
            godModeBtn.classList.add('hidden');
            selectAllBtn.classList.add('hidden');
            godModeBar.classList.add('hidden');
            isGodMode = false;
            selectedKeys.clear();
            return;
        }

        recentStrip.classList.remove('hidden');
        godModeBtn.classList.remove('hidden');
        recentList.innerHTML = '';

        captures.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'recent-item';
            if (captureState && item.key === captureState.key) {
                btn.classList.add('selected');
            }
            if (item.isPinned) {
                btn.classList.add('pinned');
            }

            if (isGodMode) {
                btn.classList.add('god-selectable');
                if (selectedKeys.has(item.key)) {
                    btn.classList.add('god-selected');
                }
            }

            btn.title = `Capture ${new Date(item.timestamp).toLocaleTimeString()}`;

            const img = document.createElement('img');
            img.src = item.dataUrl;
            img.alt = 'Saved capture';
            btn.appendChild(img);

            btn.addEventListener('click', async () => {
                if (isGodMode) {
                    if (selectedKeys.has(item.key)) {
                        selectedKeys.delete(item.key);
                    } else {
                        selectedKeys.add(item.key);
                    }
                    updateGodModeUI();
                    renderRecentStrip();
                    return;
                }

                if (isEditMode) {
                    stopEditMode(false);
                }
                captureState = item;
                await renderState(false);
            });

            recentList.appendChild(btn);
        });

        // Keep the currently selected capture visible in long lists.
        const selectedBtn = recentList.querySelector('.recent-item.selected');
        if (selectedBtn) {
            selectedBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    async function renderState(useTransition = false) {
        clearInterval(countdownInterval);

        if (!captureState) {
            stopEditMode(false);
            snapBtn.classList.remove('hidden');
            previewCard.classList.add('hidden');
            timerWrap.classList.add('hidden');
            statusMsg.textContent = 'Ready to capture your next snippet.';
            setActionsDisabled(true);
            pinBtn.classList.remove('is-pinned');
            recentStrip.classList.add('hidden');
            godModeBar.classList.add('hidden');
            return;
        }

        if (useTransition && !snapBtn.classList.contains('hidden')) {
            await transitionToPreviewState();
        } else {
            snapBtn.classList.add('hidden');
            previewCard.classList.remove('hidden');
            timerWrap.classList.remove('hidden');
        }

        previewImage.src = captureState.dataUrl;
        renderRecentStrip();
        updateGodModeUI();

        setActionsDisabled(false);
        pinBtn.classList.toggle('is-pinned', captureState.isPinned);
        const selectedIndex = captures.findIndex((item) => item.key === captureState.key) + 1;
        statusMsg.textContent = captureState.isPinned
            ? 'Pinned for quick access.'
            : `Selected snap ${selectedIndex} of ${captures.length}.`;

        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
    }

    function updateCountdown() {
        if (!captureState) {
            return;
        }

        const elapsed = Date.now() - captureState.timestamp;
        const remainingMs = Math.max(0, captureState.durationMs - elapsed);
        const remainingSec = Math.floor(remainingMs / 1000);
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;

        deleteText.textContent = `Deleting in ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        const progressPct = captureState.durationMs === 0
            ? 0
            : (remainingMs / captureState.durationMs) * 100;

        progressFill.style.width = `${progressPct.toFixed(2)}%`;
        const dashOffset = RING_CIRCUMFERENCE * (1 - progressPct / 100);
        ringProgress.style.strokeDashoffset = `${dashOffset.toFixed(2)}`;
        timerRing.setAttribute('aria-valuenow', `${Math.round(progressPct)}`);

        if (remainingMs === 0) {
            statusMsg.textContent = 'Expiring...';
            deleteText.textContent = 'Deleting in 00:00';
            clearInterval(countdownInterval);
            
            // Proactively trigger deletion if the current capture has expired
            if (captureState && !captureState.isPinned) {
                const expiredKey = captureState.key;
                setTimeout(async () => {
                    try {
                        if (!expiredKey) {
                            return;
                        }

                        await chrome.storage.local.remove(expiredKey);
                        await clearJanitor(expiredKey);
                        console.log(`[TempSnap] Expired capture deleted: ${expiredKey}`);
                        await loadCaptures();
                        await renderState();
                    } catch (err) {
                        console.error('Auto-delete failed:', err);
                    }
                }, 500);
            }
        }
    }

    function setActionsDisabled(isDisabled) {
        copyBtn.disabled = isDisabled;
        pinBtn.disabled = isDisabled;
        deleteBtn.disabled = isDisabled;
    }

    async function handleCopy() {
        if (!captureState) {
            return;
        }

        if (isEditMode) {
            statusMsg.textContent = 'Apply or cancel edits before copying.';
            return;
        }

        try {
            copyBtn.disabled = true;
            const response = await fetch(captureState.dataUrl);
            const blob = await response.blob();
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);
            statusMsg.textContent = 'Copied to clipboard.';
        } catch (err) {
            console.error('Copy failed:', err);
            statusMsg.textContent = 'Copy failed. Try capturing again.';
        } finally {
            copyBtn.disabled = false;
        }
    }

    async function togglePin() {
        if (!captureState) {
            return;
        }

        try {
            if (captureState.isPinned) {
                await chrome.storage.local.remove('pinnedCaptureKey');
                captureState.isPinned = false;
                captures.forEach((item) => {
                    if (item.key === captureState.key) {
                        item.isPinned = false;
                    }
                });
                await scheduleJanitor(captureState.key, currentTimerMinutes);
            } else {
                await chrome.storage.local.set({ pinnedCaptureKey: captureState.key });
                captures.forEach((item) => {
                    item.isPinned = item.key === captureState.key;
                });
                captureState.isPinned = true;
                await clearJanitor(captureState.key);
            }

            pinBtn.classList.toggle('is-pinned', captureState.isPinned);
            renderRecentStrip();
            statusMsg.textContent = captureState.isPinned
                ? 'Pinned for quick access.'
                : 'Unpinned.';
        } catch (err) {
            console.error('Pin toggle failed:', err);
            statusMsg.textContent = 'Pin action failed.';
        }
    }

    async function handleDelete() {
        if (!captureState) {
            return;
        }

        try {
            const deletedKey = captureState.key;
            stopEditMode(false);
            await chrome.storage.local.remove(deletedKey);
            await clearJanitor(deletedKey);

            const { pinnedCaptureKey } = await chrome.storage.local.get('pinnedCaptureKey');
            if (pinnedCaptureKey === deletedKey) {
                await chrome.storage.local.remove('pinnedCaptureKey');
            }

            await loadCaptures();
            await renderState();
        } catch (err) {
            console.error('Delete failed:', err);
            statusMsg.textContent = 'Delete failed.';
        }
    }

    async function transitionToPreviewState() {
        const leavingAnim = snapBtn.animate([
            { opacity: 1, transform: 'translateY(0) scale(1)' },
            { opacity: 0, transform: 'translateY(-5px) scale(0.985)' }
        ], {
            duration: 160,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            fill: 'forwards'
        });

        await leavingAnim.finished;
        snapBtn.classList.add('hidden');
        snapBtn.style.opacity = '';
        snapBtn.style.transform = '';

        previewCard.classList.remove('hidden');
        timerWrap.classList.remove('hidden');

        previewCard.animate([
            { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], {
            duration: 220,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
        });

        timerWrap.animate([
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' }
        ], {
            duration: 240,
            easing: 'ease-out'
        });
    }

    async function clearJanitor(key) {
        await chrome.alarms.clear(`janitor_${key}`);
    }

    async function scheduleJanitor(key, minutes) {
        chrome.alarms.create(`janitor_${key}`, {
            delayInMinutes: Math.max(1 / 60, minutes)
        });
    }

    async function rescheduleUnpinnedJanitors(minutes) {
        const { pinnedCaptureKey } = await chrome.storage.local.get('pinnedCaptureKey');
        const items = await chrome.storage.local.get(null);
        const keys = Object.keys(items).filter((key) => key.startsWith('capture_'));

        await Promise.all(keys.map(async (key) => {
            await clearJanitor(key);
            if (key !== pinnedCaptureKey) {
                await scheduleJanitor(key, minutes);
            }
        }));
    }

    function updateGodModeUI() {
        const count = selectedKeys.size;
        selectedCount.textContent = `${count} selected`;
        copyMultiBtn.disabled = count === 0;
        if (isGodMode) {
            const allSelected = captures.length > 0 && count === captures.length;
            selectAllBtn.textContent = allSelected ? 'Unselect all' : 'Select all';
        }
        if (!isGodMode) {
            godModeBar.classList.add('hidden');
        }
    }

    async function toggleDarkMode() {
        isDarkMode = !isDarkMode;
        applyDarkMode(isDarkMode);
        await chrome.storage.local.set({ darkMode: isDarkMode });
        updateDarkModeToggleUI();
    }

    function applyDarkMode(enable) {
        if (enable) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        updateDarkModeToggleUI();
    }

    function updateDarkModeToggleUI() {
        darkModeToggle.classList.toggle('active', isDarkMode);
        darkModeToggle.setAttribute('aria-pressed', isDarkMode ? 'true' : 'false');
    }

    async function ensureDarkModeSetting() {
        const { darkMode } = await chrome.storage.local.get('darkMode');
        if (typeof darkMode === 'boolean') {
            return darkMode;
        }
        await chrome.storage.local.set({ darkMode: false });
        return false;
    }

    function showConfirmation(dataUrl) {
        // Clear any existing timeout
        if (confirmationTimeout) {
            clearTimeout(confirmationTimeout);
        }

        // Show the confirmation modal
        confirmationOverlay.classList.remove('hidden');
        confirmationPreview.src = dataUrl;

        // Update timer display
        updateConfirmationTimer();

        // Auto-dismiss after 4.5 seconds
        confirmationTimeout = setTimeout(() => {
            hideConfirmation();
        }, 4500);
    }

    async function startEditMode() {
        if (!captureState || isEditMode) {
            return;
        }

        originalEditDataUrl = captureState.dataUrl;
        await drawImageToEditCanvas(originalEditDataUrl);
        isEditMode = true;
        activeEditTool = 'crop';
        updateActiveToolButton();
        previewImage.classList.add('hidden');
        editCanvas.classList.remove('hidden');
        quickEditBar.classList.remove('hidden');
        statusMsg.textContent = 'Edit mode: draw on image with selected tool.';
    }

    function stopEditMode(keepEdits) {
        isEditMode = false;
        isDrawing = false;
        drawStart = null;
        canvasSnapshot = null;
        quickEditBar.classList.add('hidden');
        editCanvas.classList.add('hidden');
        previewImage.classList.remove('hidden');
        if (!keepEdits && originalEditDataUrl) {
            previewImage.src = originalEditDataUrl;
        }
    }

    async function drawImageToEditCanvas(dataUrl) {
        const img = await loadImage(dataUrl);
        editCanvas.width = img.naturalWidth || img.width;
        editCanvas.height = img.naturalHeight || img.height;
        editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
        editCtx.drawImage(img, 0, 0);
    }

    function loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image for editing.'));
            img.src = dataUrl;
        });
    }

    function updateActiveToolButton() {
        quickToolButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tool === activeEditTool);
        });
    }

    function onCanvasMouseDown(event) {
        if (!isEditMode) {
            return;
        }

        const point = toCanvasPoint(event);
        isDrawing = true;
        drawStart = point;
        canvasSnapshot = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
    }

    function onCanvasMouseMove(event) {
        if (!isEditMode || !isDrawing || !drawStart || !canvasSnapshot) {
            return;
        }

        const point = toCanvasPoint(event);
        editCtx.putImageData(canvasSnapshot, 0, 0);
        drawToolPreview(drawStart, point, activeEditTool);
    }

    function onCanvasMouseUp(event) {
        if (!isEditMode || !isDrawing || !drawStart || !canvasSnapshot) {
            return;
        }

        const end = toCanvasPoint(event);
        editCtx.putImageData(canvasSnapshot, 0, 0);
        applyTool(drawStart, end, activeEditTool);
        isDrawing = false;
        drawStart = null;
        canvasSnapshot = null;
    }

    function toCanvasPoint(event) {
        const rect = editCanvas.getBoundingClientRect();
        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    function getRectFromPoints(start, end) {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        return { x, y, w, h };
    }

    function drawToolPreview(start, end, tool) {
        if (tool === 'arrow') {
            drawArrow(start, end, '#ff6363', 3);
            return;
        }

        const rect = getRectFromPoints(start, end);
        editCtx.setLineDash(tool === 'crop' ? [8, 6] : []);
        editCtx.lineWidth = 2;
        editCtx.strokeStyle = tool === 'highlight' ? '#f5b400' : '#3d8cff';
        editCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        editCtx.setLineDash([]);
    }

    function applyTool(start, end, tool) {
        if (tool === 'crop') {
            applyCrop(start, end);
            return;
        }

        if (tool === 'highlight') {
            const rect = getRectFromPoints(start, end);
            editCtx.strokeStyle = '#f5b400';
            editCtx.lineWidth = 4;
            editCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            return;
        }

        if (tool === 'arrow') {
            drawArrow(start, end, '#ff6363', 4);
            return;
        }

        if (tool === 'blur') {
            applyBlur(start, end);
        }
    }

    function applyCrop(start, end) {
        const rect = getRectFromPoints(start, end);
        const cropW = Math.max(1, Math.round(rect.w));
        const cropH = Math.max(1, Math.round(rect.h));
        if (cropW < 6 || cropH < 6) {
            return;
        }

        const sx = Math.round(rect.x);
        const sy = Math.round(rect.y);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = cropW;
        tempCanvas.height = cropH;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(editCanvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

        editCanvas.width = cropW;
        editCanvas.height = cropH;
        editCtx.drawImage(tempCanvas, 0, 0);
    }

    function drawArrow(start, end, color, lineWidth) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const angle = Math.atan2(dy, dx);
        const headLength = 16;

        editCtx.strokeStyle = color;
        editCtx.fillStyle = color;
        editCtx.lineWidth = lineWidth;
        editCtx.beginPath();
        editCtx.moveTo(start.x, start.y);
        editCtx.lineTo(end.x, end.y);
        editCtx.stroke();

        editCtx.beginPath();
        editCtx.moveTo(end.x, end.y);
        editCtx.lineTo(
            end.x - headLength * Math.cos(angle - Math.PI / 6),
            end.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        editCtx.lineTo(
            end.x - headLength * Math.cos(angle + Math.PI / 6),
            end.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        editCtx.closePath();
        editCtx.fill();
    }

    function applyBlur(start, end) {
        const rect = getRectFromPoints(start, end);
        const x = Math.round(rect.x);
        const y = Math.round(rect.y);
        const w = Math.max(1, Math.round(rect.w));
        const h = Math.max(1, Math.round(rect.h));
        if (w < 6 || h < 6) {
            return;
        }

        const sampleW = Math.max(1, Math.floor(w / 14));
        const sampleH = Math.max(1, Math.floor(h / 14));

        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = sampleW;
        blurCanvas.height = sampleH;
        const blurCtx = blurCanvas.getContext('2d');
        blurCtx.drawImage(editCanvas, x, y, w, h, 0, 0, sampleW, sampleH);

        editCtx.save();
        editCtx.imageSmoothingEnabled = false;
        editCtx.drawImage(blurCanvas, 0, 0, sampleW, sampleH, x, y, w, h);
        editCtx.restore();
    }

    async function applyEdits() {
        if (!isEditMode || !captureState) {
            return;
        }

        try {
            const updatedDataUrl = editCanvas.toDataURL('image/png');
            captureState.dataUrl = updatedDataUrl;
            captures = captures.map((item) => item.key === captureState.key
                ? { ...item, dataUrl: updatedDataUrl }
                : item);

            previewImage.src = updatedDataUrl;
            await chrome.storage.local.set({ [captureState.key]: updatedDataUrl });
            stopEditMode(true);
            renderRecentStrip();
            statusMsg.textContent = 'Edits applied.';
        } catch (err) {
            console.error('Apply edits failed:', err);
            statusMsg.textContent = 'Could not apply edits.';
        }
    }

    async function resetEdits() {
        if (!isEditMode) {
            return;
        }
        await drawImageToEditCanvas(originalEditDataUrl);
        statusMsg.textContent = 'Edits reset to original.';
    }

    function hideConfirmation() {
        if (confirmationTimeout) {
            clearTimeout(confirmationTimeout);
            confirmationTimeout = null;
        }
        confirmationOverlay.classList.add('hidden');
    }

    function updateConfirmationTimer() {
        const timerText = `Auto-closing in ${currentTimerMinutes} minute${currentTimerMinutes > 1 ? 's' : ''}`;
        confirmationTimer.textContent = timerText;
    }

    async function maybeShowOnboarding() {
        if (!onboardingOverlay || !onboardingTitle || !onboardingText || !onboardingPrev || !onboardingNext) {
            return;
        }

        const { onboardingSeen } = await chrome.storage.local.get('onboardingSeen');
        if (onboardingSeen) {
            return;
        }
        onboardingStep = 0;
        renderOnboardingStep();
        onboardingOverlay.classList.remove('hidden');
    }

    function renderOnboardingStep() {
        if (!onboardingTitle || !onboardingText || !onboardingPrev || !onboardingNext) {
            return;
        }

        const step = onboardingSteps[onboardingStep];
        if (!step) {
            return;
        }

        onboardingTitle.textContent = step.title;
        onboardingText.textContent = step.text;
        onboardingPrev.disabled = onboardingStep === 0;
        onboardingNext.textContent = onboardingStep === onboardingSteps.length - 1 ? 'Done' : 'Next';

        onboardingDots.forEach((dot, index) => {
            dot.classList.toggle('active', index === onboardingStep);
        });
    }

    async function completeOnboarding() {
        if (onboardingOverlay) {
            onboardingOverlay.classList.add('hidden');
        }
        await chrome.storage.local.set({ onboardingSeen: true });
    }

    async function ensureEditorShortcuts() {
        const { editorShortcuts: stored } = await chrome.storage.local.get('editorShortcuts');
        const normalized = {
            crop: normalizeShortcutValue(stored?.crop, DEFAULT_EDITOR_SHORTCUTS.crop),
            highlight: normalizeShortcutValue(stored?.highlight, DEFAULT_EDITOR_SHORTCUTS.highlight),
            arrow: normalizeShortcutValue(stored?.arrow, DEFAULT_EDITOR_SHORTCUTS.arrow),
            blur: normalizeShortcutValue(stored?.blur, DEFAULT_EDITOR_SHORTCUTS.blur),
            reset: normalizeShortcutValue(stored?.reset, DEFAULT_EDITOR_SHORTCUTS.reset),
            save: normalizeShortcutValue(stored?.save, DEFAULT_EDITOR_SHORTCUTS.save),
            cancel: normalizeShortcutValue(stored?.cancel, DEFAULT_EDITOR_SHORTCUTS.cancel)
        };

        await chrome.storage.local.set({ editorShortcuts: normalized });
        return normalized;
    }

    function normalizeShortcutValue(value, fallback) {
        const raw = String(value || '').trim().toUpperCase();
        if (!raw) return fallback;
        if (raw === 'ENTER' || raw === 'ESC' || raw === 'ESCAPE') {
            return raw === 'ESCAPE' ? 'ESC' : raw;
        }
        if (/^[A-Z0-9]$/.test(raw)) return raw;
        return fallback;
    }

    function renderShortcutInputs() {
        if (!editorShortcuts) return;
        const inputs = {
            crop: document.getElementById('shortcutCrop'),
            highlight: document.getElementById('shortcutHighlight'),
            arrow: document.getElementById('shortcutArrow'),
            blur: document.getElementById('shortcutBlur'),
            reset: document.getElementById('shortcutReset'),
            save: document.getElementById('shortcutSave'),
            cancel: document.getElementById('shortcutCancel')
        };

        Object.entries(inputs).forEach(([key, element]) => {
            if (element && editorShortcuts[key]) {
                element.value = editorShortcuts[key];
            }
        });
    }

    function bindShortcutInput(inputEl, key) {
        inputEl.addEventListener('blur', () => persistShortcutValue(inputEl, key));
        inputEl.addEventListener('change', () => persistShortcutValue(inputEl, key));
    }

    async function persistShortcutValue(inputEl, key) {
        const value = inputEl.value.trim().toUpperCase();
        const normalized = normalizeShortcutValue(value, editorShortcuts[key]);
        inputEl.value = normalized;
        editorShortcuts[key] = normalized;
        await chrome.storage.local.set({ editorShortcuts });
    }
});
