# Copy Doc as Markdown

Chrome extension that copies or downloads a Google Doc as clean Markdown, including open **and resolved** comment threads, replies and suggestions — handy for feeding docs to LLMs, wikis or code reviews.

## Features

- Copy to clipboard or download a `.md` file — from the toolbar popup, the on-page buttons, or keyboard shortcuts (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> / <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>, configurable at `chrome://extensions/shortcuts`).
- Headings, lists, tables, links, bold/italic/strikethrough, inline code, super/subscript.
- Comments are numbered (`[c1]`) in the text and listed at the end with author, date, status and replies.
- Settings: document + comments, document only, or comments only; include/exclude resolved threads and suggestions; toggle the title/link header and the on-page buttons.
- Works entirely locally. See [PRIVACY.md](PRIVACY.md).

## Development

```sh
npm install
npm test        # converter tests
npm run build   # dist/copy-doc-as-markdown.zip for the Chrome Web Store
```

Load the unpacked extension from `chrome://extensions` → Developer mode → **Load unpacked** → select `src/`.

| File | Role |
| --- | --- |
| `src/lib.js` | .docx → Markdown converter (pure, tested) |
| `src/collect.js` | Reads live comment threads (resolved state, suggestions) from the Docs page |
| `src/content.js` | Builds the export in the page, on-page buttons, toasts |
| `src/popup.*` | Toolbar popup with actions and settings |
| `src/shared.js` | Settings defaults, clipboard, file download, script injection |
| `src/background.js` | Export fetch fallback, main-world collection, shortcuts |

## Releasing

1. Bump `version` in `src/manifest.json`.
2. Commit, then `git tag v<version> && git push --tags`.
3. CI tests, builds and attaches the zip to a GitHub release. Upload that zip in the [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole). Listing copy lives in [STORE.md](STORE.md).
