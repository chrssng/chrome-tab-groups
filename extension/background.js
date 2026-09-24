/**
 * Service worker: watches tabs and moves them into the matching tab group.
 *
 * Basic idea
 *  - Whenever a tab gets a new URL, the first matching group is looked up.
 *  - Each window has at most one Chrome group per name; if it is missing,
 *    it gets created with name and color.
 *  - We only act when a tab enters the "scope" of a group. If you drag a tab
 *    out of its group by hand, you won't be overruled while you keep
 *    clicking around on the same website.
 *  - "Open group" loads a group's URLs as a tab group into the current
 *    window. These tabs are not re-sorted during their first seconds, so
 *    redirects (e.g. to a login page) don't push them into another group.
 */
import { loadConfig, GROUP_PREFIX, SETTINGS_KEY } from './lib/config.js';
import { compileGroups, findMatch, urlsToOpen, missingUrls } from './lib/patterns.js';

const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;
const HOLD_MS = 30_000; // how long freshly opened group tabs stay where they are

/* ---------- Configuration (cached) ---------- */

let configPromise = null;

function getConfig() {
  if (!configPromise) {
    configPromise = loadConfig().then((config) => {
      const active = config.groups.filter((g) => g.enabled && g.name); // ignore groups without a name
      return {
        ...config,
        compiled: compileGroups(active),
        managedNames: new Set(active.map((g) => g.name)),
      };
    });
    configPromise.catch(() => {
      configPromise = null;
    });
  }
  return configPromise;
}

/* ---------- Per-tab state ---------- */
// lastRule:  tabId → ID of the configured group whose scope the tab entered
//            last (or null for "no rule").
// holdUntil: tabId → point in time until which the tab is only observed, not
//            re-sorted (freshly opened via "Open group").
// Both live in storage.session and thus survive a service worker restart.

const lastRule = new Map();
const holdUntil = new Map();
const stateReady = chrome.storage.session
  .get(['lastRule', 'holdUntil'])
  .then((saved) => {
    for (const [tabId, ruleId] of Object.entries(saved.lastRule ?? {})) {
      if (!lastRule.has(Number(tabId))) lastRule.set(Number(tabId), ruleId);
    }
    for (const [tabId, until] of Object.entries(saved.holdUntil ?? {})) {
      if (!holdUntil.has(Number(tabId))) holdUntil.set(Number(tabId), until);
    }
  })
  .catch(() => {});

function persistState() {
  chrome.storage.session
    .set({ lastRule: Object.fromEntries(lastRule), holdUntil: Object.fromEntries(holdUntil) })
    .catch(() => {});
}

function rememberRule(tabId, ruleId) {
  lastRule.set(tabId, ruleId);
  persistState();
}

function forgetRule(tabId) {
  if (lastRule.delete(tabId)) persistState();
}

function forgetTab(tabId) {
  const hadRule = lastRule.delete(tabId);
  const hadHold = holdUntil.delete(tabId);
  if (hadRule || hadHold) persistState();
}

/* ---------- Helpers ---------- */

// All tasks run one after another – so even many tabs opened at the same
// time never create duplicate groups.
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch((err) => console.warn('[Tab Groups]', err));
  return run;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const messageOf = (err) => String(err?.message ?? err);
const isBusy = (err) => /dragging|cannot be edited right now/i.test(messageOf(err));
const isGone = (err) => /no (tab|group|window) with id/i.test(messageOf(err));

/** Retries an action as long as Chrome blocks the tab strip (e.g. while a tab is being dragged). */
async function retry(action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (err) {
      if (attempt < 6 && isBusy(err)) {
        await sleep(120 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
}

/** The New Tab page & co. never trigger anything. */
function isNeutralUrl(url) {
  return !url || /^(about:blank|chrome:\/\/new-?tab|chrome-search:\/\/)/i.test(url);
}

const tabUrl = (tab) => tab.url || tab.pendingUrl || '';

async function isNormalWindow(windowId) {
  try {
    return (await chrome.windows.get(windowId)).type === 'normal';
  } catch {
    return false;
  }
}

/* ---------- Grouping ---------- */

/**
 * Puts `tabs` (all from the same window) into the group `def`.
 * Returns the number of tabs actually moved.
 */
async function moveIntoGroup(windowId, tabs, def) {
  const existing = (await chrome.tabGroups.query({ windowId })).find((g) => (g.title ?? '') === def.name);

  if (!existing) {
    const groupId = await retry(() =>
      chrome.tabs.group({ tabIds: tabs.map((t) => t.id), createProperties: { windowId } }),
    );
    await retry(() => chrome.tabGroups.update(groupId, { title: def.name, color: def.color }));
    return tabs.length;
  }

  const toMove = tabs.filter((t) => t.groupId !== existing.id);
  if (toMove.length) {
    await retry(() => chrome.tabs.group({ groupId: existing.id, tabIds: toMove.map((t) => t.id) }));
  }
  const update = {};
  if (existing.color !== def.color) update.color = def.color;
  if (existing.collapsed && toMove.some((t) => t.active)) update.collapsed = false;
  if (Object.keys(update).length) await retry(() => chrome.tabGroups.update(existing.id, update));
  return toMove.length;
}

/** Takes a tab out of its group – but only if it is a group we manage. */
async function ungroupIfManaged(tab, config) {
  if (tab.groupId === NO_GROUP) return false;
  const group = await chrome.tabGroups.get(tab.groupId).catch(() => null);
  if (!group || !config.managedNames.has(group.title ?? '')) return false;
  await retry(() => chrome.tabs.ungroup(tab.id));
  return true;
}

/**
 * Checks a single tab.
 * force: act even if the matching rule hasn't changed
 *        or automatic grouping is paused (explicit action).
 */
async function processTab(tabId, { force = false } = {}) {
  await stateReady;
  const config = await getConfig();
  if (!config.settings.enabled && !force) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const url = tabUrl(tab);
  if (isNeutralUrl(url)) return;

  const match = findMatch(config.compiled, url);
  const ruleId = match ? match.group.id : null;

  const hold = holdUntil.get(tabId);
  if (hold !== undefined && !force) {
    if (Date.now() < hold) {
      rememberRule(tabId, ruleId); // opened via "Open group": only observe
      return;
    }
    holdUntil.delete(tabId);
  }

  if (!force && lastRule.has(tabId) && lastRule.get(tabId) === ruleId) return;
  rememberRule(tabId, ruleId);

  if (tab.pinned || !(await isNormalWindow(tab.windowId))) return;

  try {
    if (match) {
      await moveIntoGroup(tab.windowId, [tab], match.group);
    } else if (config.settings.ungroupOnLeave) {
      await ungroupIfManaged(tab, config);
    }
  } catch (err) {
    forgetRule(tabId); // try again on the next navigation
    if (!isGone(err)) throw err;
  }
}

/** Sorts all open tabs of all normal windows into their groups. */
async function sortAllTabs() {
  await stateReady;
  const config = await getConfig();
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  let moved = 0;
  let ungrouped = 0;

  for (const win of windows) {
    const buckets = new Map(); // group ID → { def, tabs }
    for (const tab of win.tabs ?? []) {
      const url = tabUrl(tab);
      if (isNeutralUrl(url)) continue;
      const match = findMatch(config.compiled, url);
      lastRule.set(tab.id, match ? match.group.id : null);
      if (tab.pinned) continue;
      if (match) {
        if (!buckets.has(match.group.id)) buckets.set(match.group.id, { def: match.group, tabs: [] });
        buckets.get(match.group.id).tabs.push(tab);
      } else if (config.settings.ungroupOnLeave) {
        try {
          if (await ungroupIfManaged(tab, config)) ungrouped++;
        } catch (err) {
          if (!isGone(err)) throw err;
        }
      }
    }
    // Create the groups in the order of the configuration
    for (const def of config.groups) {
      const bucket = buckets.get(def.id);
      if (!bucket) continue;
      try {
        moved += await moveIntoGroup(win.id, bucket.tabs, bucket.def);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
  }
  persistState();
  return { moved, ungrouped };
}

/* ---------- Open group ---------- */

/** Freshly opened tab: remember the rule of its start URL and hold it for a moment. */
function holdTab(tabId, url, config) {
  lastRule.set(tabId, findMatch(config.compiled, url)?.group.id ?? null);
  holdUntil.set(tabId, Date.now() + HOLD_MS);
}

async function targetWindow(windowId) {
  if (Number.isInteger(windowId)) {
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (win?.type === 'normal') return win;
  }
  return chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
}

/**
 * Opens a group's URLs as a tab group in window `windowId`.
 *  - Pages that are already open in this group are not opened twice.
 *  - If the active tab is an empty "New Tab", it is used for the first URL.
 *  - Afterwards the group is expanded and its (first new) tab is active.
 */
async function openGroup(groupId, windowId) {
  await stateReady;
  const config = await getConfig();
  const def = config.groups.find((g) => g.id === groupId && g.name);
  if (!def) throw new Error('This group no longer exists.');
  const { urls } = urlsToOpen(def);
  if (!urls.length) throw new Error(`There is no URL to open for “${def.name}”.`);

  const win = await targetWindow(windowId);
  if (!win) {
    // No normal window open → new window with all URLs
    const created = await chrome.windows.create({ url: urls, focused: true });
    const ids = created.tabs.map((t) => t.id);
    ids.forEach((id, i) => holdTab(id, urls[i], config));
    persistState();
    const chromeGroupId = await retry(() =>
      chrome.tabs.group({ tabIds: ids, createProperties: { windowId: created.id } }),
    );
    await retry(() => chrome.tabGroups.update(chromeGroupId, { title: def.name, color: def.color }));
    return { name: def.name, opened: ids.length, alreadyOpen: 0, failed: [] };
  }

  const tabs = await chrome.tabs.query({ windowId: win.id });
  const existing = (await chrome.tabGroups.query({ windowId: win.id })).find((g) => (g.title ?? '') === def.name);
  const groupTabs = existing ? tabs.filter((t) => t.groupId === existing.id) : [];
  const missing = missingUrls(urls, groupTabs.map(tabUrl));

  const opened = [];
  const failed = [];
  const active = tabs.find((t) => t.active);
  const reuseActive =
    active &&
    !active.pinned &&
    isNeutralUrl(tabUrl(active)) &&
    (active.groupId === NO_GROUP || active.groupId === existing?.id);

  for (const [index, url] of missing.entries()) {
    try {
      if (index === 0 && reuseActive) {
        holdTab(active.id, url, config);
        await chrome.tabs.update(active.id, { url });
        opened.push(active.id);
      } else {
        const tab = await chrome.tabs.create({ windowId: win.id, url, active: false });
        holdTab(tab.id, url, config);
        opened.push(tab.id);
      }
    } catch {
      failed.push(url);
    }
  }
  persistState();

  let chromeGroupId = existing?.id ?? null;
  if (opened.length) {
    chromeGroupId = await retry(() =>
      existing
        ? chrome.tabs.group({ groupId: existing.id, tabIds: opened })
        : chrome.tabs.group({ tabIds: opened, createProperties: { windowId: win.id } }),
    );
  }
  if (chromeGroupId !== null) {
    await retry(() =>
      chrome.tabGroups.update(chromeGroupId, { title: def.name, color: def.color, collapsed: false }),
    );
  }

  // Show the group: its first new tab – or, if everything was already open, its first tab
  const focusId = opened[0] ?? (groupTabs.some((t) => t.active) ? null : groupTabs[0]?.id);
  if (focusId != null) await chrome.tabs.update(focusId, { active: true }).catch(() => {});
  if (!win.focused) await chrome.windows.update(win.id, { focused: true }).catch(() => {});

  return { name: def.name, opened: opened.length, alreadyOpen: urls.length - missing.length, failed };
}

/** Name/color changed in the settings → update open groups to match. */
async function applyGroupEdits(edits) {
  const groups = await chrome.tabGroups.query({});
  for (const group of groups) {
    const edit = edits.find((e) => e.from.name === (group.title ?? ''));
    if (!edit) continue;
    const update = {};
    if (edit.to.name && group.title !== edit.to.name) update.title = edit.to.name;
    if (group.color !== edit.to.color) update.color = edit.to.color;
    if (!Object.keys(update).length) continue;
    try {
      await retry(() => chrome.tabGroups.update(group.id, update));
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }
}

/* ---------- Toolbar icon ---------- */

async function updateBadge() {
  const { settings } = await getConfig();
  await chrome.action.setBadgeText({ text: settings.enabled ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#5F6368' });
  await chrome.action.setTitle({
    title: settings.enabled ? 'Tab Groups by URL' : 'Tab Groups by URL (paused)',
  });
}

/* ---------- Events ---------- */

chrome.tabs.onCreated.addListener((tab) => {
  if (tabUrl(tab)) enqueue(() => processTab(tab.id));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) enqueue(() => processTab(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (lastRule.has(removedTabId)) lastRule.set(addedTabId, lastRule.get(removedTabId));
  if (holdUntil.has(removedTabId)) holdUntil.set(addedTabId, holdUntil.get(removedTabId));
  forgetTab(removedTabId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  configPromise = null;

  const edits = [];
  for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
    if (!key.startsWith(GROUP_PREFIX) || !oldValue?.name || !newValue) continue;
    if (oldValue.name !== newValue.name || oldValue.color !== newValue.color) {
      edits.push({ from: oldValue, to: newValue });
    }
  }
  if (edits.length) enqueue(() => applyGroupEdits(edits));
  if (SETTINGS_KEY in changes) updateBadge().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  let job = null;
  if (message?.type === 'sortAll') job = () => sortAllTabs();
  if (message?.type === 'sortTab' && Number.isInteger(message.tabId)) {
    job = () => processTab(message.tabId, { force: true });
  }
  if (message?.type === 'openGroup' && typeof message.groupId === 'string') {
    job = () => openGroup(message.groupId, message.windowId);
  }
  if (!job) return false;

  configPromise = null; // the page may have just saved → load fresh
  enqueue(job).then(
    (result) => sendResponse({ ok: true, ...(result ?? {}) }),
    (err) => sendResponse({ ok: false, error: messageOf(err) }),
  );
  return true; // the response is sent asynchronously
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  updateBadge().catch(() => {});
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge().catch(() => {});
});
