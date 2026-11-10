// Shared by the content script, popup and service worker.
var GDMD_DEFAULTS = {
  content: "all", // "all" | "doc" | "comments"
  resolved: true,
  suggestions: true,
  header: true,
  button: true,
};
var GDMD_DOC_URL = /^https:\/\/docs\.google\.com\/document\//;
var GDMD_SCRIPTS = ["shared.js", "lib.js", "content.js"];

function getSettings() {
  return chrome.storage.sync.get(GDMD_DEFAULTS);
}

// Sends to the tab's content script, injecting it first if the tab predates the install.
async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: GDMD_SCRIPTS });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* gesture may have expired */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

function saveFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
