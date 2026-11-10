const form = document.getElementById("settings");
const status = document.getElementById("status");
const buttons = document.querySelectorAll("[data-action]");

function setStatus(text, isError) {
  status.textContent = text;
  status.className = isError ? "error" : "";
}

function syncForm(settings) {
  for (const input of form.elements) {
    if (input.type === "checkbox") input.checked = settings[input.name];
    if (input.type === "radio") input.checked = settings[input.name] === input.value;
  }
  form.querySelector(".comments").disabled = settings.content === "doc";
}

form.addEventListener("change", () => {
  const settings = {};
  for (const input of form.elements) {
    if (input.type === "checkbox") settings[input.name] = input.checked;
    if (input.type === "radio" && input.checked) settings[input.name] = input.value;
  }
  form.querySelector(".comments").disabled = settings.content === "doc";
  chrome.storage.sync.set(settings);
});

async function run(tab, action) {
  buttons.forEach((button) => { button.disabled = true; });
  setStatus("Exporting…");
  try {
    const doc = await sendToTab(tab.id, { type: "build" });
    if (!doc?.ok) throw new Error(doc?.error || "Couldn't export this doc");
    const suffix = doc.summary ? " · " + doc.summary : "";
    if (action === "download") {
      saveFile(doc.markdown, doc.filename);
      setStatus("Saved " + doc.filename + suffix);
    } else if (await writeClipboard(doc.markdown)) {
      setStatus("Copied" + suffix);
    } else {
      throw new Error("Clipboard blocked");
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

(async () => {
  syncForm(await getSettings());
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !GDMD_DOC_URL.test(tab.url || "")) {
    buttons.forEach((button) => { button.disabled = true; });
    setStatus("Open a Google Doc to export it.");
    return;
  }
  buttons.forEach((button) => button.addEventListener("click", () => run(tab, button.dataset.action)));
})();
