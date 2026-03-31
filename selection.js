// selection.js

(function () {
    if (document.getElementById('tempsnap-overlay')) {
        return; // Already injected
    }

    const overlay = document.createElement('div');
    overlay.id = 'tempsnap-overlay';
    overlay.className = 'tempsnap-overlay-container';

    const selectionBox = document.createElement('div');
    selectionBox.id = 'tempsnap-selection-box';
    selectionBox.className = 'tempsnap-selection-box';
    overlay.appendChild(selectionBox);

    document.body.appendChild(overlay);

    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    let isEditing = false;
    let isDrawing = false;
    let activeTool = 'crop';
    let drawStart = null;
    let snapshot = null;
    let originalDataUrl = '';
    let editorCanvas = null;
    let editorCtx = null;
    let editorStatus = null;
    let editorToolButtons = [];
    let editorResetBtn = null;
    let editorCancelBtn = null;
    let editorSaveBtn = null;

    function onMouseDown(e) {
            let editorShortcuts = null;

        if (isEditing) return;
        // Only accept left click
        if (e.button !== 0) return;

        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;

        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';

        // Use the older mask trick for highlighting
        overlay.style.backgroundColor = 'transparent';
    }

    function onMouseMove(e) {
        if (isEditing) return;
        if (!isSelecting) return;

        const currentX = e.clientX;
        const currentY = e.clientY;

        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        const left = Math.min(currentX, startX);
        const top = Math.min(currentY, startY);

        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;
        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
    }

    async function onMouseUp(e) {
        if (isEditing) return;
        if (!isSelecting) return;
        isSelecting = false;

        // Calculate physical device pixels correctly relative to window
        const dpr = window.devicePixelRatio || 1;
        const cropBox = {
            x: Math.min(startX, e.clientX) * dpr,
            y: Math.min(startY, e.clientY) * dpr,
            width: Math.abs(e.clientX - startX) * dpr,
            height: Math.abs(e.clientY - startY) * dpr,
            dpr: dpr
        };

        // If practically no area selected, interpret as "Cancel"
        if (cropBox.width < 5 || cropBox.height < 5) {
            console.log("[TempSnap] Selection too small, cancelled.");
            cleanup();
            return;
        }

        try {
            const result = await sendRuntimeMessage({ action: 'PREPARE_CAPTURE', cropBox });
            if (!result || !result.ok || !result.dataUrl) {
                throw new Error(result?.error || 'Could not prepare capture.');
            }
            launchEditor(result.dataUrl);
        } catch (err) {
            console.error('[TempSnap] Prepare capture failed:', err);
            cleanup();
        }
    }

    // Escape cancels selection; in editor mode, shortcuts are enabled.
    function onKeyDown(e) {
        if (isEditing) {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
                return;
            }

            const key = e.key.toLowerCase();
            if (editorShortcuts && e.key.toUpperCase() === editorShortcuts.crop) {
                e.preventDefault();
                setActiveTool('crop', true);
                return;
            }
            if (editorShortcuts && e.key.toUpperCase() === editorShortcuts.highlight) {
                e.preventDefault();
                setActiveTool('highlight', true);
                return;
            }
            if (editorShortcuts && e.key.toUpperCase() === editorShortcuts.arrow) {
                e.preventDefault();
                setActiveTool('arrow', true);
                return;
            }
            if (editorShortcuts && e.key.toUpperCase() === editorShortcuts.blur) {
                e.preventDefault();
                setActiveTool('blur', true);
                return;
            }
            if (editorShortcuts && e.key.toUpperCase() === editorShortcuts.reset && editorResetBtn) {
                e.preventDefault();
                editorResetBtn.click();
                return;
            }
            if (editorShortcuts && e.key === 'Enter' && editorSaveBtn && !editorSaveBtn.disabled) {
                e.preventDefault();
                editorSaveBtn.click();
                return;
            }
            if (editorShortcuts && e.key === 'Escape' && editorCancelBtn) {
                e.preventDefault();
                editorCancelBtn.click();
                return;
            }
            return;
        }

        if (e.key === 'Escape') {
            isSelecting = false;
            cleanup();
        }
    }

    function launchEditor(dataUrl) {
        isEditing = true;
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.35)';
        selectionBox.style.display = 'none';
        overlay.innerHTML = '';

        const shell = document.createElement('div');

        // Fetch custom shortcuts from storage
        chrome.storage.local.get('editorShortcuts', (result) => {
            editorShortcuts = result.editorShortcuts || {
                crop: 'C',
                highlight: 'H',
                arrow: 'A',
                blur: 'B',
                reset: 'R',
                save: 'ENTER',
                cancel: 'ESC'
            };
        });

        shell.className = 'tempsnap-editor-shell';

        const toolbar = document.createElement('div');
        toolbar.className = 'tempsnap-editor-toolbar';

        const toolRow = document.createElement('div');
        toolRow.className = 'tempsnap-tool-row';
        const actionRow = document.createElement('div');
        actionRow.className = 'tempsnap-action-row';

        const status = document.createElement('div');
        status.className = 'tempsnap-editor-status';
        status.textContent = 'Edit on full screen. Shortcuts: C/H/A/B tools, R reset, Enter save, Esc cancel.';
        editorStatus = status;

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'tempsnap-canvas-wrap';

        editorCanvas = document.createElement('canvas');
        canvasWrap.appendChild(editorCanvas);
        editorCtx = editorCanvas.getContext('2d', { willReadFrequently: true });

        editorToolButtons = ['crop', 'highlight', 'arrow', 'blur'].map((tool) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tempsnap-editor-btn';
            btn.textContent = tool.charAt(0).toUpperCase() + tool.slice(1);
            btn.dataset.tool = tool;
            if (tool === activeTool) btn.classList.add('active');
            btn.addEventListener('click', () => {
                setActiveTool(tool, true);
            });
            toolRow.appendChild(btn);
            return btn;
        });

        editorResetBtn = createActionButton('Reset', async () => {
            await drawDataUrlToCanvas(originalDataUrl, editorCanvas, editorCtx);
            if (editorStatus) {
                editorStatus.textContent = 'Reset to original.';
            }
        });

        editorCancelBtn = createActionButton('Cancel', () => {
            cleanup();
        });

        editorSaveBtn = createActionButton('Save & Copy', async () => {
            try {
                editorSaveBtn.disabled = true;
                editorSaveBtn.textContent = 'Saving...';
                const finalDataUrl = editorCanvas.toDataURL('image/png');
                const response = await sendRuntimeMessage({
                    action: 'FINALIZE_CAPTURE',
                    dataUrl: finalDataUrl
                });
                if (!response || !response.ok) {
                    throw new Error(response?.error || 'Could not save capture.');
                }
                cleanup();
            } catch (err) {
                console.error('[TempSnap] Finalize failed:', err);
                if (editorStatus) {
                    editorStatus.textContent = 'Save failed. Try again.';
                }
                editorSaveBtn.disabled = false;
                editorSaveBtn.textContent = 'Save & Copy';
            }
        });
        editorSaveBtn.classList.add('primary');

        actionRow.appendChild(editorResetBtn);
        actionRow.appendChild(editorCancelBtn);
        actionRow.appendChild(editorSaveBtn);

        toolbar.appendChild(toolRow);
        toolbar.appendChild(actionRow);
        shell.appendChild(toolbar);
        shell.appendChild(status);
        shell.appendChild(canvasWrap);
        overlay.appendChild(shell);

        originalDataUrl = dataUrl;
        drawDataUrlToCanvas(dataUrl, editorCanvas, editorCtx).catch((err) => {
            console.error('[TempSnap] Editor image load failed:', err);
            cleanup();
        });

        editorCanvas.addEventListener('mousedown', onCanvasMouseDown);
        editorCanvas.addEventListener('mousemove', onCanvasMouseMove);
        window.addEventListener('mouseup', onCanvasMouseUpEditor);
    }

    function setActiveTool(tool, announce = false) {
        activeTool = tool;
        editorToolButtons.forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
        if (announce && editorStatus) {
            editorStatus.textContent = `Tool: ${tool}`;
        }
    }

    function createActionButton(label, handler) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tempsnap-editor-btn';
        btn.textContent = label;
        btn.addEventListener('click', handler);
        return btn;
    }

    async function drawDataUrlToCanvas(dataUrl, canvas, ctx) {
        const img = await loadImage(dataUrl);
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    }

    function loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = dataUrl;
        });
    }

    function onCanvasMouseDown(e) {
        if (!isEditing) return;
        isDrawing = true;
        drawStart = toCanvasPoint(e);
        snapshot = editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
    }

    function onCanvasMouseMove(e) {
        if (!isEditing || !isDrawing || !drawStart || !snapshot) return;
        const end = toCanvasPoint(e);
        editorCtx.putImageData(snapshot, 0, 0);
        drawPreview(drawStart, end);
    }

    function onCanvasMouseUpEditor(e) {
        if (!isEditing || !isDrawing || !drawStart || !snapshot) return;
        const end = toCanvasPoint(e);
        editorCtx.putImageData(snapshot, 0, 0);
        applyTool(drawStart, end);
        isDrawing = false;
        drawStart = null;
        snapshot = null;
    }

    function toCanvasPoint(e) {
        const rect = editorCanvas.getBoundingClientRect();
        const scaleX = editorCanvas.width / rect.width;
        const scaleY = editorCanvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function rectFrom(start, end) {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        return { x, y, w, h };
    }

    function drawPreview(start, end) {
        if (activeTool === 'arrow') {
            drawArrow(start, end, '#ff6666', 3);
            return;
        }

        const r = rectFrom(start, end);
        editorCtx.lineWidth = 2;
        editorCtx.strokeStyle = activeTool === 'highlight' ? '#ffd02b' : '#66a9ff';
        editorCtx.setLineDash(activeTool === 'crop' ? [8, 6] : []);
        editorCtx.strokeRect(r.x, r.y, r.w, r.h);
        editorCtx.setLineDash([]);
    }

    function applyTool(start, end) {
        if (activeTool === 'crop') {
            applyCrop(start, end);
            return;
        }

        if (activeTool === 'highlight') {
            const r = rectFrom(start, end);
            editorCtx.lineWidth = 4;
            editorCtx.strokeStyle = '#ffd02b';
            editorCtx.strokeRect(r.x, r.y, r.w, r.h);
            return;
        }

        if (activeTool === 'arrow') {
            drawArrow(start, end, '#ff6666', 4);
            return;
        }

        if (activeTool === 'blur') {
            applyBlur(start, end);
        }
    }

    function applyCrop(start, end) {
        const r = rectFrom(start, end);
        const w = Math.max(1, Math.round(r.w));
        const h = Math.max(1, Math.round(r.h));
        if (w < 6 || h < 6) return;

        const sx = Math.round(r.x);
        const sy = Math.round(r.y);
        const temp = document.createElement('canvas');
        temp.width = w;
        temp.height = h;
        const tctx = temp.getContext('2d');
        tctx.drawImage(editorCanvas, sx, sy, w, h, 0, 0, w, h);

        editorCanvas.width = w;
        editorCanvas.height = h;
        editorCtx.drawImage(temp, 0, 0);
    }

    function drawArrow(start, end, color, lineWidth) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const head = 16;

        editorCtx.strokeStyle = color;
        editorCtx.fillStyle = color;
        editorCtx.lineWidth = lineWidth;
        editorCtx.beginPath();
        editorCtx.moveTo(start.x, start.y);
        editorCtx.lineTo(end.x, end.y);
        editorCtx.stroke();

        editorCtx.beginPath();
        editorCtx.moveTo(end.x, end.y);
        editorCtx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
        editorCtx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
        editorCtx.closePath();
        editorCtx.fill();
    }

    function applyBlur(start, end) {
        const r = rectFrom(start, end);
        const x = Math.round(r.x);
        const y = Math.round(r.y);
        const w = Math.max(1, Math.round(r.w));
        const h = Math.max(1, Math.round(r.h));
        if (w < 6 || h < 6) return;

        const sw = Math.max(1, Math.floor(w / 14));
        const sh = Math.max(1, Math.floor(h / 14));
        const temp = document.createElement('canvas');
        temp.width = sw;
        temp.height = sh;
        const tctx = temp.getContext('2d');
        tctx.drawImage(editorCanvas, x, y, w, h, 0, 0, sw, sh);

        editorCtx.save();
        editorCtx.imageSmoothingEnabled = false;
        editorCtx.drawImage(temp, 0, 0, sw, sh, x, y, w, h);
        editorCtx.restore();
    }

    function sendRuntimeMessage(payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(payload, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        });
    }

    function cleanup() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('mouseup', onCanvasMouseUpEditor);
        document.removeEventListener('keydown', onKeyDown);
        editorToolButtons = [];
        editorStatus = null;
        editorResetBtn = null;
        editorCancelBtn = null;
        editorSaveBtn = null;
        overlay.remove();
    }

    overlay.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);

})();
