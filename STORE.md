# Chrome Web Store listing

Copy-paste material for the [developer dashboard](https://chrome.google.com/webstore/devconsole).

## Store listing

**Category:** Productivity (Tools)

**Summary** (from manifest): Copy or download a Google Doc as Markdown, including open and resolved comment threads and suggestions.

**Description:**

> Turn any Google Doc into clean Markdown in one click — with its comments.
>
> • Copy to clipboard or download a .md file
> • Keeps headings, lists, tables, links and text formatting
> • Includes comment threads with authors, dates and replies — even resolved ones — and suggestions, linked to the text with [c1] markers
> • Choose what to export: document and comments, document only, or comments only
> • Toggle resolved threads, suggestions and the title header
> • Keyboard shortcuts: Alt+Shift+M to copy, Alt+Shift+D to download
>
> Great for pasting docs into ChatGPT/Claude/Cursor, wikis, GitHub or Notion.
>
> Private by design: everything runs locally in your browser. No servers, no analytics, no data collection.
>
> Not affiliated with Google.

**Assets** (in `store/`): screenshots `screenshot-1-overview.png`, `screenshot-2-comments.png`, `screenshot-3-settings.png` (1280×800) and small promo tile `promo-small-440x280.png`. Icon: `src/icons/icon128.png`.

## Privacy practices tab

**Single purpose:** Export the Google Doc the user is viewing, with its comments, as Markdown to the clipboard or a .md file.

**Permission justifications:**

- `scripting` — Read the comment threads already loaded in the Google Docs page (to know which are resolved or suggestions), and inject the exporter into Docs tabs that were open before installation.
- `clipboardWrite` — Copy the generated Markdown to the clipboard when the user asks.
- `storage` — Save the user's export preferences.
- Host `https://docs.google.com/*` — Run on Google Docs and request the document's .docx export with the user's existing session.
- Host `https://*.googleusercontent.com/*` — Google serves the .docx export from this domain after a redirect.

**Remote code:** No, I am not using remote code.

**Data usage:** Check none of the data types. Certify all three disclosures (no selling, no unrelated use, no creditworthiness use). The extension handles "Website content" only locally and never transmits it; if a reviewer pushes back, tick "Website content" and note it never leaves the device.

**Privacy policy URL:** https://github.com/pasivash/copy-doc-as-markdown/blob/main/PRIVACY.md
