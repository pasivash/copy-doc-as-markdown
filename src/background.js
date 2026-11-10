importScripts("shared.js", "collect.js");

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  }
  return btoa(binary);
}

// Google's export endpoint intermittently throttles or fails; retry before giving up.
async function fetchDocx(url) {
  let reason = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    try {
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      const bytes = await res.arrayBuffer();
      const head = new Uint8Array(bytes, 0, 2);
      if (res.ok && head[0] === 0x50 && head[1] === 0x4b) return bytes;
      reason = res.ok ? "not a .docx, are you signed in?" : "HTTP " + res.status;
      if ([401, 403, 404].includes(res.status)) break;
    } catch (error) {
      reason = error.message;
    }
  }
  throw new Error("Export failed (" + reason + ")");
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id && GDMD_DOC_URL.test(tab.url || "")) {
    sendToTab(tab.id, { type: "run", action: command === "download" ? "download" : "copy" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "fetch-docx") {
    fetchDocx(msg.url)
      .then((bytes) => sendResponse({ ok: true, base64: encodeBase64(bytes) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (msg?.type === "collect") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, discussions: [] });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectDiscussions,
    }).then((results) => {
      sendResponse(results?.[0]?.result || { ok: false, discussions: [] });
    }).catch(() => sendResponse({ ok: false, discussions: [] }));
    return true;
  }
});
