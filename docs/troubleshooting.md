[← Documentation](README.md)

# Troubleshooting

## A tab isn't moved into its group

Check in this order:

1. **Is the extension paused?** The toolbar icon shows **off**. Turn it on in the [popup](popup.md#onoff-switch).
2. **Where does the URL go?** Paste it into Settings → [Test a URL](settings.md#test-a-url). Typical findings:
   - a group further up wins – move the right group up ([Which group wins](url-patterns.md#which-group-wins))
   - an exclusion (`!…`) skips the group
   - the group is paused, or has no name
   - the pattern has a scheme or port that doesn't fit (`https://…` doesn't match `http://`, `localhost:3000` doesn't match `localhost:3001`)
3. **Is the tab pinned, the New Tab page, or in a pop-up window?** These are [left alone](automatic-grouping.md#tabs-that-are-left-alone).
4. **Did you drag the tab out of its group?** It won't be pulled back while it stays on pages of that group – that's on purpose ([You stay in control](automatic-grouping.md#you-stay-in-control)). Use **move it there** in the popup, or **Sort all tabs**.
5. **Was the tab open before you added the rule?** New rules apply to the next navigation. Use **Sort all tabs**.

## A second tab group with the same name appears

The extension recognizes its tab groups by their **title** in each window. Two situations break that:

- **Hidden groups.** Depending on the version, Chrome keeps tab groups as “saved groups” in the bookmarks bar. If you *hide* a group and later open a matching page, the extension creates a new tab group with the same name – Chrome offers extensions no way to reopen hidden groups. Better **delete** groups you no longer need instead of hiding them.
- **Renaming in the tab strip.** If you rename a tab group directly in the tab strip, it no longer counts as the extension's group. The next matching tab lands in a new tab group with the name from the settings. Rename groups in the settings instead – that also renames open tab groups.

## Tabs of two groups with the same name end up in one tab group

Groups with the same name in different [categories](categories.md) get the same title in the tab strip – unless they show their category. While Chrome is running, the extension remembers which tab group belongs to which group. After a restart of Chrome, it can only tell them apart by their **color** – with the same color, their tabs can end up in one tab group.

Give such groups different colors, or turn on **Show the category in the tab title** for one of them. The settings page warns you about these groups – see [Groups with the same title](categories.md#groups-with-the-same-title).

## “Open group” opens nothing or not all pages

- The group isn't in the popup: it has no page to open. Fill in **Pages to open**, or add a URL pattern that is a concrete URL ([Which pages are opened](open-group.md#which-pages-are-opened)).
- Only some pages open: the others are [already open](open-group.md#no-duplicates) in that tab group – possibly on a subpage.

## Saving fails

- **Errors in red:** fix them first – the save bar says *please fix the marked errors first*, and **Save** jumps to the first one.
- **Size limits of Chrome sync:** split large groups – see [Chrome sync](backup-and-sync.md#chrome-sync).

## My groups are gone after an update

You probably loaded the new version from a different folder – Chrome treats that as a different extension. Load the old folder again, **Export**, then **Import** in the new one. See [Updating the extension](backup-and-sync.md#updating-the-extension-or-moving-to-another-computer).

## Debugging

On `chrome://extensions`, click **Service Worker** on the extension's entry. This opens DevTools for the background script; warnings are logged with the prefix `[Tab Groups]`.

Found a bug? [Open an issue](https://github.com/chrssng/chrome-tab-groups/issues).
