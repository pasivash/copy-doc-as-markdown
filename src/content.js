if (!globalThis.__gdmdLoaded) {
  globalThis.__gdmdLoaded = true;

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function pageTitle() {
    return document.title.replace(/\s[-–—]\sGoogle\s+\S+$/, "").trim() || "Untitled document";
  }

  function fileName(title) {
    return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".md";
  }

  function docxUrl() {
    const match = location.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([^/]+)/);
    if (!match) throw new Error("Open a Google Doc first");
    const url = new URL("https://docs.google.com/document/d/" + match[1] + "/export");
    url.searchParams.set("format", "docx");
    const tab = new URL(location.href).searchParams.get("tab");
    if (tab) url.searchParams.set("tab", tab);
    return url.toString();
  }

  function toast(message, isError) {
    let node = document.getElementById("gdmd-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "gdmd-toast";
      document.body.appendChild(node);
    }
    node.className = isError ? "error" : "";
    node.textContent = message;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.remove(), 3200);
  }

  function showManual(text) {
    let panel = document.getElementById("gdmd-manual");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "gdmd-manual";
      panel.innerHTML = '<div><button type="button" data-act="copy">Copy</button><button type="button" data-act="close">Close</button></div><textarea readonly></textarea>';
      panel.addEventListener("click", async (event) => {
        if (event.target.dataset.act === "close") panel.remove();
        if (event.target.dataset.act === "copy") {
          panel.querySelector("textarea").select();
          if (await writeClipboard(panel.querySelector("textarea").value)) panel.remove();
        }
      });
      document.body.appendChild(panel);
    }
    const area = panel.querySelector("textarea");
    area.value = text;
    area.focus();
    area.select();
  }

  // The export redirects to another Google host, so it's fetched by the service worker.
  async function fetchDocxBytes(url) {
    const file = await chrome.runtime.sendMessage({ type: "fetch-docx", url });
    if (!file?.ok || !file.base64) throw new Error(file?.error || "Export failed");
    return decodeBase64(file.base64);
  }

  function friendlyError(error) {
    const message = error?.message || "Couldn't export this doc";
    console.warn("[Copy Doc as Markdown]", error);
    if (/HTTP 429/.test(message)) return "Google is throttling exports. Wait a few seconds and try again.";
    return /Export failed|Not a Word document/.test(message)
      ? "Couldn't export this doc " + (message.match(/\(.*\)/)?.[0] || "") + ". Try again in a moment."
      : message;
  }

  async function build() {
    const settings = await getSettings();
    const [buffer, live] = await Promise.all([
      fetchDocxBytes(docxUrl()),
      settings.content === "doc" ? null : chrome.runtime.sendMessage({ type: "collect" }),
    ]);
    const title = pageTitle();
    const result = await GDMD.docxToMarkdown(buffer, {
      ...settings,
      title,
      url: location.href.split("#")[0],
      discussions: live?.discussions || [],
    });
    if (!result.markdown) throw new Error("Nothing to export with the current settings");
    return {
      markdown: result.markdown,
      filename: fileName(title),
      summary: settings.content === "doc" ? "" : "comments: " + result.summary,
    };
  }

  function setBusy(busy) {
    run.busy = busy;
    for (const button of document.querySelectorAll("#gdmd-bar button")) button.disabled = busy;
  }

  async function run(action) {
    if (run.busy) return;
    setBusy(true);
    try {
      const doc = await build();
      const done = (verb) => toast(verb + (doc.summary ? " · " + doc.summary : ""));
      if (action === "download") {
        saveFile(doc.markdown, doc.filename);
        done("Saved " + doc.filename);
      } else if (await writeClipboard(doc.markdown)) {
        done("Copied");
      } else {
        showManual(doc.markdown);
        toast("Clipboard blocked — copy from the box");
      }
    } catch (error) {
      toast(friendlyError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function mount(show) {
    const existing = document.getElementById("gdmd-bar");
    if (!show) return existing?.remove();
    if (existing) return;
    const bar = document.createElement("div");
    bar.id = "gdmd-bar";
    bar.innerHTML = '<button type="button" data-action="copy" title="Copy this doc as Markdown">Copy markdown</button>'
      + '<button type="button" data-action="download" title="Download as a .md file">.md ↓</button>';
    bar.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action) run(action);
    });
    document.body.appendChild(bar);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "run") run(msg.action);
    if (msg?.type === "build") {
      build().then(
        (doc) => sendResponse({ ok: true, ...doc }),
        (error) => sendResponse({ ok: false, error: friendlyError(error) }),
      );
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.button) mount(changes.button.newValue);
  });
  getSettings().then((settings) => mount(settings.button));
}
