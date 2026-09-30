[← Documentation](README.md)

# Automatic grouping

Whenever a tab gets a new URL, the extension looks for the first group whose [URL patterns](url-patterns.md) match – and moves the tab into that group's tab group.

## When a tab is checked

Every time a tab's URL changes:

- a new tab is opened (link, bookmark, <kbd>Ctrl</kbd>+click, “Open in new tab”, …)
- you type an address or follow a link in an existing tab
- a page redirects
- a web app changes the URL without reloading the page (e.g. switching between repositories on GitHub)

The groups are checked **from top to bottom**; the first active group that matches wins. Paused groups and groups without a name are skipped. See [Which group wins](url-patterns.md#which-group-wins).

## Where the tab goes

Tab groups are managed **per window**:

- If the window already has a tab group with the group's title, the tab joins it. The title is the group's name – or *Category · Name* if the group [shows its category](categories.md#the-category-in-the-tab-title).
- Otherwise a new tab group is created with that title and the group's color.

Groups of different categories may have the same title. The extension still puts each tab into the right tab group – see [Groups with the same title](categories.md#groups-with-the-same-title).

Along the way:

- If the tab group has a different color than configured, the color is corrected.
- If the tab group is collapsed and the tab you're looking at is moved into it, the group is expanded.
- Many tabs opened at the same time (a bookmark folder, a restored session) still end up in *one* tab group – tabs are processed one after another.
- While you drag a tab, Chrome locks the tab strip. The extension retries for a moment instead of failing.

## You stay in control

The extension only acts when a tab **enters the scope of a different group** – not on every page load. If you drag a tab out of its group by hand, it won't be pulled back as long as it stays on pages of the same group.

Example with a group *GitHub* (`github.com`) and a group *Mail* (`mail.google.com`):

| You … | The tab … |
|---|---|
| open `github.com/nodejs/node` | goes into *GitHub* |
| drag it out of the group | stays outside |
| click around on GitHub | still stays outside – same group as before |
| go to `mail.google.com` | goes into *Mail* – a different group |
| go back to `github.com` | goes into *GitHub* again |

To put a tab back right away, use **Not in the group right now – move it there** in the [popup](popup.md#current-tab), or **Sort all tabs**.

## Tabs that are left alone

- **Pinned tabs** are never grouped.
- **The New Tab page** and `about:blank` never trigger anything.
- **Tabs in pop-up and app windows** are ignored – only normal browser windows count.
- **URLs no group matches:** the tab stays where it is – even inside a group – unless you turn on the option below.

## Removing a tab when it leaves its group

Settings → Behavior → **Remove a tab from its group when it leaves the group** (off by default).

When it's on, a tab that navigates to a URL **no rule matches** is taken out of its tab group. This only affects tab groups the extension manages – tab groups you created yourself (with a title that doesn't belong to an active group) are left untouched.

Navigating to a URL of *another* group always moves the tab, with or without this option.

## Sorting tabs that are already open

New rules only apply to tabs that change their URL. To sort everything that's already open:

- Popup → **Sort all tabs**, or
- Settings → Behavior → **Sort all tabs now** (saves unsaved changes first).

This goes through all tabs in all normal windows, skips pinned tabs, and creates the tab groups in the order of your list. Afterwards you see how many tabs were moved (and, with the option above, how many were removed from groups). It also works while automatic grouping is paused.

## Pausing

**The whole extension:** use the switch at the top of the [popup](popup.md), or Settings → Behavior → **Group tabs automatically**. The toolbar icon then shows the badge **off**. Manual actions keep working: **Sort all tabs**, **move it there** and [Open group](open-group.md).

**A whole category:** use the switch in the category's header in the settings – it turns all of its groups on or off at once and shows *Mixed* if only some are paused.

**A single group:** use its **Active/Paused** switch in the settings. A paused group never matches – a URL falls through to the next group below. It can still be opened with “Open group”. Under [Test a URL](settings.md#test-a-url), a paused group that would match is listed as *“Would also match …, but that group is paused.”*

## Renaming and recoloring

If you change a group's name or color in the settings and save, all open tab groups with the old title – in all windows – are renamed or recolored right away. The same happens when the title changes because you rename a category the group shows in its title, or turn **Show the category in the tab title** on or off. This also happens when the change arrives via Chrome sync from another device.

Renaming a tab group directly in the tab strip is a different story – see [Troubleshooting](troubleshooting.md#a-second-tab-group-with-the-same-name-appears).
