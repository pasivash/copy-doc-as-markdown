importScripts("shared.js", "collect.js");

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  }
  return btoa(binary);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id && GDMD_DOC_URL.test(tab.url || "")) {
    sendToTab(tab.id, { type: "run", action: command === "download" ? "download" : "copy" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "fetch-docx") {
    fetch(msg.url, { credentials: "include", redirect: "follow" })
      .then(async (res) => {
        if (!res.ok) {
          sendResponse({ ok: false, error: "Export failed (" + res.status + ")" });
          return;
        }
        sendResponse({ ok: true, base64: encodeBase64(await res.arrayBuffer()) });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
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
