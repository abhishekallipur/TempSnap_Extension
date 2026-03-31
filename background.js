// background.js

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('janitor_')) {
    return;
  }

  const storageKey = alarm.name.replace('janitor_', '');
  const { pinnedCaptureKey } = await chrome.storage.local.get('pinnedCaptureKey');

  if (pinnedCaptureKey === storageKey) {
    // Keep pinned captures alive and retry later in case it gets unpinned.
    chrome.alarms.create(alarm.name, { delayInMinutes: 1 });
    console.log(`[TempSnap Janitor] Skipped pinned capture ${storageKey}`);
    return;
  }

  // Delete the image data from storage
  await chrome.storage.local.remove(storageKey);

  console.log(`[TempSnap Janitor] Deleted image data for ${storageKey}`);
});

function notify(title, message) {
  const safeTitle = typeof title === 'string' && title.trim()
    ? title
    : 'TempSnap';
  const safeMessage = typeof message === 'string' && message.trim()
    ? message
    : 'Operation completed.';

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: safeTitle,
    message: safeMessage
  });
}

async function copyToClipboardInTab(tabId, dataUrl) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: async (url) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();

        // Use modern clipboard api now that we are in a foreground tab context
        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob
          })
        ]);
      } catch (err) {
        console.error("TempSnap clipboard error:", err);
        throw err;
      }
    },
    args: [dataUrl]
  });
}

async function triggerSelectionOverlay(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['selection.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['selection.js']
    });
  } catch (err) {
    console.warn("Could not inject selection overlay:", err);
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture_and_copy') {
    try {
      // Get the currently active tab in the current window
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Fallback: if no tab found, try to find any tab in the current window
      if (!tab) {
        const [anyTab] = await chrome.tabs.query({ currentWindow: true });
        tab = anyTab;
      }

      if (!tab) {
        notify('TempSnap Error', 'Please open a webpage before taking a screenshot');
        return;
      }

      await triggerSelectionOverlay(tab.id);

    } catch (err) {
      console.error(err);
      notify('TempSnap Error', `Failed to open selection: ${err?.message || 'Unknown error'}`);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRIGGER_SELECTION') {
    if (sender.tab && sender.tab.id) {
      triggerSelectionOverlay(sender.tab.id);
      return;
    }

    // Popup pages do not provide sender.tab, so resolve the active tab explicitly.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        console.warn('TempSnap: No active tab available for selection trigger.');
        return;
      }
      triggerSelectionOverlay(tab.id);
    });
  }
  else if (message.action === 'PREPARE_CAPTURE') {
    if (!sender.tab || !sender.tab.id) {
      sendResponseSafe({ ok: false, error: 'Missing sender tab.' });
      return true;
    }

    prepareCapture(message.cropBox)
      .then((dataUrl) => {
        sendResponseSafe({ ok: true, dataUrl });
      })
      .catch((err) => {
        console.error('Prepare capture failed:', err);
        sendResponseSafe({ ok: false, error: err?.message || 'Prepare failed' });
      });

    return true;
  }
  else if (message.action === 'FINALIZE_CAPTURE') {
    if (!sender.tab || !sender.tab.id) {
      sendResponseSafe({ ok: false, error: 'Missing sender tab.' });
      return true;
    }

    handleFinalizedCapture(message.dataUrl, sender.tab.id)
      .then(() => sendResponseSafe({ ok: true }))
      .catch((err) => {
        console.error('Finalize capture failed:', err);
        sendResponseSafe({ ok: false, error: err?.message || 'Finalize failed' });
      });

    return true;
  }
  else if (message.action === 'CROP_SCREENSHOT') {
    if (!sender.tab || !sender.tab.id) {
      console.warn('TempSnap: Missing sender.tab for CROP_SCREENSHOT.');
      return;
    }
    handleCroppedCapture(message.cropBox, sender.tab.id);
  }
  else if (message.action === 'MULTIPASTE') {
    handleMultiPaste(message.keys);
  }

  function sendResponseSafe(payload) {
    try {
      if (typeof sendResponse === 'function') {
        sendResponse(payload);
      }
    } catch (err) {
      console.warn('TempSnap: sendResponse failed', err);
    }
  }
});

async function handleCroppedCapture(cropBox, tabId) {
  try {
    const croppedDataUrl = await prepareCapture(cropBox);
    await handleFinalizedCapture(croppedDataUrl, tabId);

  } catch (err) {
    console.error(err);
    notify('TempSnap Error', `Failed to capture region: ${err?.message || 'Unknown error'}`);
  }
}

async function prepareCapture(cropBox) {
  const dataUrl = await new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (url) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(url);
    });
  });

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(cropBox.width, cropBox.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    bitmap,
    cropBox.x, cropBox.y, cropBox.width, cropBox.height,
    0, 0, cropBox.width, cropBox.height
  );

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(croppedBlob);
}

async function handleFinalizedCapture(dataUrl, tabId) {
  if (!dataUrl) {
    throw new Error('Missing capture data.');
  }

  await copyToClipboardInTab(tabId, dataUrl);

  const timestamp = Date.now();
  const storageKey = `capture_${timestamp}`;
  await chrome.storage.local.set({ [storageKey]: dataUrl });

  const { timerMinutes } = await chrome.storage.local.get('timerMinutes');
  const delay = parseInt(timerMinutes, 10) || 10;
  chrome.alarms.create(`janitor_${storageKey}`, { delayInMinutes: delay });

  notify('TempSnap', `Captured region! Copied to clipboard. Auto-delete in ${delay} min.`);

  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (minutes) => {
      const toast = document.createElement('div');
      toast.textContent = `✅ TempSnap: Copied to clipboard! Wiping memory in ${minutes} mins.`;
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: linear-gradient(135deg, #1e293b, #0f172a);
        color: #f8fafc;
        padding: 12px 20px;
        border-radius: 8px;
        border-left: 4px solid #38bdf8;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
        font-family: -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 500;
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        pointer-events: none;
      `;
      document.body.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 400);
      }, 3000);
    },
    args: [delay]
  });
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to convert image data.'));
    reader.readAsDataURL(blob);
  });
}

async function handleMultiPaste(keys) {
  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Fallback: if no tab found, try to find any tab in the current window
    if (!tab) {
      const [anyTab] = await chrome.tabs.query({ currentWindow: true });
      tab = anyTab;
    }

    if (!tab) {
      notify('TempSnap Error', 'Please switch to a webpage to paste images');
      return;
    }

    // Wait a brief moment for the popup UI to close and focus to return to the active tab's prompt box
    await new Promise(resolve => setTimeout(resolve, 300));

    // Fetch all requested captures from storage
    const records = await chrome.storage.local.get(keys);
    const dataUris = keys.map(k => records[k]).filter(Boolean);

    if (dataUris.length === 0) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (uris) => {
        try {
          let activeEl = document.activeElement;

          // Auto-target common AI chat boxes if the body has focus but a textarea exists
          if (activeEl === document.body) {
            const potentialInput = document.querySelector('textarea, [contenteditable="true"], #prompt-textarea');
            if (potentialInput) activeEl = potentialInput;
          }

          const toFile = (uri, index) => {
            const byteString = atob(uri.split(',')[1]);
            const mimeString = uri.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: mimeString });
            return new File([blob], `tempsnap_multipaste_${index}.png`, { type: mimeString });
          };

          const resolveTarget = () => {
            const focused = document.activeElement;
            if (focused && focused !== document.body) {
              return focused;
            }
            return document.querySelector('textarea, [contenteditable="true"], #prompt-textarea') || document.body;
          };

          const dispatchPaste = (files) => {
            const dt = new DataTransfer();
            files.forEach(file => dt.items.add(file));

            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            });

            const target = resolveTarget();
            return target.dispatchEvent(pasteEvent);
          };

          const pasteSequentially = async () => {
            const files = uris.map((uri, index) => toFile(uri, index));

            // Many chat editors only process one file per paste event.
            for (let i = 0; i < files.length; i++) {
              dispatchPaste([files[i]]);
              await new Promise(resolve => setTimeout(resolve, 650));
            }

            // Draw a sleek success toast to indicate God Mode injection succeeded
            const toast = document.createElement('div');
            toast.textContent = `⚡ God Mode: Dropped ${uris.length} snaps!`;
            toast.style.cssText = `
              position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
              background: linear-gradient(135deg, #38bdf8, #2563eb);
              color: #fff; padding: 12px 20px; border-radius: 8px;
              box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
              font-family: -apple-system, sans-serif; font-size: 14px; font-weight: 600;
              opacity: 0; transform: translateY(20px); transition: all 0.4s;
              pointer-events: none;
            `;
            document.body.appendChild(toast);

            requestAnimationFrame(() => {
              toast.style.opacity = '1'; toast.style.transform = 'translateY(0)';
            });
            setTimeout(() => {
              toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)';
              setTimeout(() => toast.remove(), 400);
            }, 3000);
          };

          pasteSequentially();

        } catch (e) {
          console.error("TempSnap Multipaste God Mode injection failed:", e);
        }
      },
      args: [dataUris]
    });
  } catch (err) {
    console.error("Multipaste error in background:", err);
    notify('God Mode Error', `Injection failed: ${err?.message || 'Unknown error'}`);
  }
}
