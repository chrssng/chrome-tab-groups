[← Documentation](README.md)

# Backup, sync & import

## Chrome sync

The settings are stored in `chrome.storage.sync`. If Chrome sync is turned on for extensions, your groups follow your Google account to every computer you sign in to.

Chrome sync has size limits. Each group is stored as its own entry, so you'll only run into them with very long pattern lists:

| Limit | Message when saving |
|---|---|
| 8 KB per group | *A group has too many patterns – Chrome sync allows at most 8 KB per group. Split it into several groups.* |
| 100 KB in total | *The settings are too large for Chrome sync (max. 100 KB).* |
| Number of saves per minute | *Too many saves in a short time – please try again in a minute.* |

## Export

Settings → Back up, transfer & reset → **Export** downloads a JSON file named after the current date, e.g. `260930_tab-groups.json`.

The export contains all categories, groups and Behavior options as they are **currently on the page** – including unsaved changes. Which categories and groups are collapsed isn't part of it.

## Import

Settings → Back up, transfer & reset → **Import …**, then choose a file.

If you don't have any groups yet, the file is loaded right away. Otherwise you choose:

| Choice | What happens |
|---|---|
| **Add to my groups** | Your groups and Behavior options stay. The groups from the file are added at the end of their category. Categories with the same name (upper/lower case doesn't count) are merged – they keep their own **Open all collapsed** – new categories are added at the end. Groups whose name already exists in the same category are skipped – you're told how many. |
| **Replace all groups** | Your categories, groups and Behavior options are replaced by those from the file. |
| **Cancel** | Nothing happens. <kbd>Esc</kbd> does the same. |

**Nothing is saved until you click Save** – review the result first, or click **Discard** to undo the import.

If the file can't be read, you see *The file is not valid JSON.* or *No groups found in the file.*

## Reset

Settings → Back up, transfer & reset → **Reset …** starts over from scratch: all categories and groups are removed, and the Behavior options go back to their defaults – just like right after installing (only the category *Default*, no groups).

- You're asked first. **Cancel** or <kbd>Esc</kbd> does nothing.
- Like everything on the settings page, it only takes effect when you click **Save** – until then, **Discard** brings everything back.
- After saving, the reset also reaches every computer that syncs this extension via Chrome sync. **Export** first if you might want your groups back.
- Tab groups that are open right now stay as they are.

## File format

A minimal file:

```json
{
  "format": "tab-groups-by-url",
  "version": 1,
  "settings": {
    "enabled": true,
    "ungroupOnLeave": false,
    "openInListOrder": false
  },
  "categories": [
    { "name": "Work", "openCollapsed": false }
  ],
  "groups": [
    {
      "name": "Development",
      "category": "Work",
      "showCategory": false,
      "color": "blue",
      "patterns": ["github.com", "!github.com/my-company", "localhost:3000"],
      "openUrls": [],
      "enabled": true,
      "openCollapsed": false
    }
  ]
}
```

`categories` lists the categories in their order. An entry can also be just the name (`"Work"`), as in files from older versions. The list can be left out – categories that only appear on groups are then created in the order they first appear.

| Category field | | If missing or invalid |
|---|---|---|
| `name` | Name of the category | `Default` |
| `openCollapsed` | `true` = **Open all** creates the tab groups collapsed – see [Collapsed tab groups](open-group.md#collapsed-tab-groups) | `false` |

| Group field | | If missing or invalid |
|---|---|---|
| `name` | Name of the group | empty – has to be filled in before saving |
| `category` | Name of the category | `Default` (created if necessary) |
| `showCategory` | `true` = the tab group is titled *Category · Name* | `false` |
| `color` | `grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan` or `orange` | `blue` |
| `patterns` | URL patterns, one string per line | none |
| `openUrls` | Pages to open | none |
| `enabled` | `false` = paused | `true` |
| `openCollapsed` | `true` = opening the group on its own (**Open now**, popup) creates its tab group collapsed – see [Collapsed tab groups](open-group.md#collapsed-tab-groups) | `false` |

| Settings field | Option | If missing |
|---|---|---|
| `enabled` | Group tabs automatically | `true` |
| `ungroupOnLeave` | Remove a tab from its group when it leaves the group | `false` |
| `openInListOrder` | Open groups in list order | `false` |

Good to know:

- The priority is the order of the categories, and within each category the order of its groups in `groups`.
- A plain array of groups (`[ { "name": … }, … ]`) is accepted as well – all of them go to *Default* unless they name a category.
- Files from older versions (without categories) work: their groups go to *Default*.
- Exported files may contain more fields and an `exportedAt` timestamp – that's fine.

## Sample file

[`tests/sample-groups.json`](../tests/sample-groups.json) contains ten groups in three categories to try out the features without setting up groups by hand. Import it with **Replace all groups** (or **Add to my groups** to keep yours).

| Category | Group | Shows |
|---|---|---|
| *Work* | *Issues & PRs* | wildcards in paths; has to stay above *GitHub* |
| | *GitHub* | a domain with all subdomains |
| | *Docs* | path prefixes, comments, pages to open without a scheme |
| | *Local dev* | ports, IP addresses, `http://` for localhost; **Open collapsed** is on |
| *Reading* | *Docs* | the same name as in *Work* – titled *Reading · Docs* in the tab strip |
| | *Wikipedia* | a pattern with scheme and wildcard subdomain |
| | *PDFs* | a regular expression |
| | *News* | a paused starter set: only pages to open, no patterns |
| *Default* | *Google* | exclusions (`!mail.google.com`, `!google.com/maps`); a catch-all, so its category is at the bottom |
| | *Mail* | picks up what *Google* excludes |

The file also turns on **Remove a tab from its group when it leaves the group** and **Open groups in list order**, and sets *Reading* to **Open all collapsed** – see [Collapsed tab groups](open-group.md#collapsed-tab-groups).

## Updating the extension or moving to another computer

- **New version, same folder:** run `git pull` (or replace the files in your *existing* `extension` folder), then click ⟳ on the extension's entry at `chrome://extensions`. Your groups are kept.
- **New version from a different folder:** Chrome treats it as a different extension, and your groups are missing. **Export** them first and **Import** them afterwards.
- **Another computer:** with Chrome sync for extensions, your groups arrive by themselves. Otherwise use export and import.
