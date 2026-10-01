# Tab Groups by URL

Chrome extension: when you open a page whose URL matches a pattern, the tab automatically lands in a predefined **tab group – with name and color**. You can also open any group with all its pages **in one click**.

![Tab strip with automatically created groups](docs/tab-strip.png)

## Features

- **[Automatic grouping](docs/automatic-grouping.md)** – tabs move into their group as soon as their URL matches: per window, without duplicate groups, and without pulling back tabs you dragged out by hand.
- **[URL patterns](docs/url-patterns.md)** – domains with subdomains, paths, ports, schemes, `*` wildcards, regular expressions and `!` exclusions. The topmost matching group wins.
- **[Open a group in one click](docs/open-group.md)** – all of its pages as a tab group, without opening anything twice – or a whole category at once. Expanded or collapsed, as you choose per group and per category.
- **[Categories](docs/categories.md)** – sort your groups into sections like *Work* or *Reading*: pause or open a whole category (optionally as collapsed tab groups), reuse a group name in another category, optionally show the category in the tab title.
- **[Popup](docs/popup.md)** – pause/resume, open groups (in collapsible categories), see where the current tab belongs, assign its domain to a group.
- **[Settings page](docs/settings.md)** – edit, reorder (drag & drop), collapse and pause groups, test any URL live.
- **[Backup, sync & import](docs/backup-and-sync.md)** – via Chrome sync, plus export/import as JSON – and a reset to start over.

![Settings page: groups sorted into categories – one expanded with name, category, color, URL patterns and pages to open](docs/options.png)

See also [Permissions & privacy](docs/privacy.md) and [Troubleshooting](docs/troubleshooting.md) – or start at the [documentation overview](docs/README.md).

## Installation

1. Clone this repository – `git clone https://github.com/chrssng/chrome-tab-groups.git` – or [download it as a ZIP](https://github.com/chrssng/chrome-tab-groups/archive/refs/heads/master.zip) and unpack it.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the **`extension`** folder.
4. The settings page opens automatically – add your first group, or **Import** [`tests/sample-groups.json`](tests/sample-groups.json) to see all features in action. Tip: pin the extension via the puzzle icon in the toolbar.

**Updating:** run `git pull` (or replace the files in your *existing* `extension` folder), then click ⟳ on the extension's entry at `chrome://extensions` – your groups are kept. A different folder counts as a different extension, so export your groups first ([details](docs/backup-and-sync.md#updating-the-extension-or-moving-to-another-computer)).

## Permissions

`tabs` to read the tabs' URLs (Chrome calls this “Read your browsing history”), `tabGroups` to create and edit groups, `storage` for the settings. No browsing history is stored and nothing is sent to the internet – see [Permissions & privacy](docs/privacy.md).

## Development

```
extension/            ← load this folder in Chrome
  manifest.json       Manifest V3
  background.js       service worker: watches tabs, groups them
  lib/patterns.js     URL patterns and URLs to open (no chrome.* – also testable in Node)
  lib/config.js       loading/saving/validating the settings
  lib/colors.js       the nine Chrome group colors
  options.html        settings page (ui/options.js, ui/options.css)
  popup.html          popup with “Open group” (ui/popup.js, ui/popup.css)
  ui/shared.css       shared styles, light/dark
docs/                 user documentation and screenshots
tests/
  patterns.test.mjs   unit tests for the pattern logic
  config.test.mjs     unit tests for categories, import/export and validation
  e2e.mjs             end-to-end test in a real Chromium
  sample-groups.json  sample settings for trying out the features
```

No build step, no runtime dependencies – plain JavaScript (ES modules). After changing the code, click ⟳ on the extension's entry at `chrome://extensions`.

```bash
npm test                          # unit tests (Node 20+)
npm install                       # only needed for the E2E test (Playwright)
npx playwright install chromium
npm run test:e2e                  # 91 checks in a real Chromium, no internet needed
```

Debugging: on `chrome://extensions`, click **Service Worker** on the extension's entry – this opens DevTools for `background.js`.

### Commit messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), and a **scope is always required**:

```
<type>(<scope>): <description>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **Scope:** the part of the project that changes, e.g. `background`, `patterns`, `config`, `options`, `popup`, `manifest`, `e2e`, `readme`, `deps`
- **Breaking changes:** `!` before the colon (`feat(config)!: …`) and/or a `BREAKING CHANGE:` footer

```
feat(popup): show which groups are already open
fix(background): keep pinned tabs out of groups
docs(readme): explain exclusion patterns
chore(deps): update playwright
```

## License

[MIT](LICENSE)
