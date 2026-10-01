[← Documentation](README.md)

# Permissions & privacy

## Permissions

| Permission | Used for |
|---|---|
| `tabs` | reading the tabs' URLs, to find the matching group. Chrome describes this as “Read your browsing history”. |
| `tabGroups` | creating, naming, coloring and moving tab groups |
| `storage` | saving the settings |

The extension needs Chrome 110 or newer.

## What is stored

| What | Where | How long |
|---|---|---|
| Your categories, groups and Behavior options | `chrome.storage.sync` – synced with your Google account if Chrome sync is on for extensions | until you delete them |
| Per open tab: which group it last belonged to, and whether it was just opened via “Open group” | `chrome.storage.session` – in memory only | until the tab is closed or Chrome quits |
| Per open tab group: which of your groups it was created for (to tell apart [groups with the same title](categories.md#groups-with-the-same-title)) | `chrome.storage.session` – in memory only | until the tab group is closed or Chrome quits |
| Which categories and groups are collapsed on the settings page, and which categories in the popup | the extension's local storage – only on this computer, not synced | until you expand them or remove the extension |

The per-tab memory makes sure you [stay in control](automatic-grouping.md#you-stay-in-control) and that [redirects](open-group.md#redirects) don't move freshly opened tabs – even if Chrome restarts the extension's service worker in between.

## What is not done

- No browsing history is stored – URLs are only compared against your patterns.
- Nothing is sent to the internet: no server, no analytics, no tracking.
- No code is loaded from outside – everything runs from the `extension` folder.

The source code is open: [github.com/chrssng/chrome-tab-groups](https://github.com/chrssng/chrome-tab-groups).
