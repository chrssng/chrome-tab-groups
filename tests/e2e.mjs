/**
 * End-to-end test in a real Chromium (Playwright).
 *
 *   npm install
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * All domains are redirected to a local test server via --host-resolver-rules –
 * nothing goes out to the internet.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const PORT_SUFFIX = PORT === 80 ? '' : `:${PORT}`;
/** 'git.example.test/repo' → 'http://git.example.test:8080/repo' */
const U = (hostPath) => {
  const slash = hostPath.indexOf('/');
  const host = slash === -1 ? hostPath : hostPath.slice(0, slash);
  const rest = slash === -1 ? '/' : hostPath.slice(slash);
  return `http://${host}${PORT_SUFFIX}${rest}`;
};

// ---------- local web server: every domain → 127.0.0.1 ----------
const server = http
  .createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const to = u.searchParams.get('to');
    if (u.pathname === '/redirect' && to) {
      res.writeHead(302, { location: to });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><title>${req.headers.host}${u.pathname}</title><h1>${req.headers.host}${u.pathname}</h1>` +
        (to ? `<a id="l" href="${to}" target="_blank">Link</a>` : ''),
    );
  })
  .listen(PORT);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      → ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  return last;
}

// ---------- Browser ----------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-groups-e2e-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1100, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--host-resolver-rules=MAP * 127.0.0.1',
    '--no-proxy-server',
    '--disable-features=HttpsUpgrades',
  ],
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
await sleep(500);

await sw.evaluate(() => {
  self.__logs = [];
  const orig = console.warn;
  console.warn = (...args) => {
    self.__logs.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
    orig(...args);
  };
});

const optionsPage = await waitFor(() => context.pages().find((p) => p.url().includes('options.html')));
check('Settings page opens on install', optionsPage);

const mainWindowId = await sw.evaluate(async () => (await chrome.windows.getAll())[0].id);

// ---------- Helpers in the service worker ----------
const state = () =>
  sw.evaluate(async () => {
    const groups = await chrome.tabGroups.query({});
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    const tabs = await chrome.tabs.query({});
    return {
      groups: groups.map((g) => ({ id: g.id, title: g.title, color: g.color, windowId: g.windowId, collapsed: g.collapsed })),
      tabs: tabs.map((t) => ({
        id: t.id,
        url: t.url || t.pendingUrl,
        windowId: t.windowId,
        active: t.active,
        pinned: t.pinned,
        groupId: t.groupId,
        group: t.groupId === -1 ? null : byId[t.groupId]?.title ?? '?',
        color: t.groupId === -1 ? null : byId[t.groupId]?.color,
      })),
    };
  });
const createTab = (url, extra = {}) =>
  sw.evaluate(async ({ url, extra }) => (await chrome.tabs.create({ url, active: false, ...extra })).id, {
    url,
    extra: { windowId: mainWindowId, ...extra },
  });
const navigate = (id, url) => sw.evaluate(({ id, url }) => chrome.tabs.update(id, { url }).then(() => true), { id, url });
const tabInfo = async (id) => (await state()).tabs.find((t) => t.id === id);
const waitGroup = async (id, title) =>
  waitFor(async () => {
    const t = await tabInfo(id);
    return t && t.group === title ? t : null;
  });
const writeConfig = (groups, settings = {}) =>
  sw.evaluate(
    async ({ groups, settings }) => {
      const all = await chrome.storage.sync.get(null);
      await chrome.storage.sync.remove(Object.keys(all));
      const items = { settings: { enabled: true, ungroupOnLeave: false, ...settings, order: groups.map((g) => g.id) } };
      for (const g of groups) items[`group:${g.id}`] = { name: g.name, color: g.color, patterns: g.patterns, enabled: g.enabled !== false };
      await chrome.storage.sync.set(items);
    },
    { groups, settings },
  );

// ---------- Configuration ----------
await writeConfig([
  { id: 'work', name: 'Work', color: 'purple', patterns: ['git.example.test/acme'] },
  { id: 'code', name: 'Code', color: 'blue', patterns: ['git.example.test', `gitlab.test${PORT_SUFFIX}`] },
  { id: 'google', name: 'Google', color: 'green', patterns: ['google.test', '!mail.google.test'] },
  { id: 'mail', name: 'Mail', color: 'red', patterns: ['mail.google.test'] },
  { id: 'jira', name: 'Jira', color: 'orange', patterns: ['*.atlassian.test'] },
  { id: 'paused', name: 'Paused', color: 'yellow', patterns: ['paused.test'], enabled: false },
]);
await sleep(200);

// T1 basic case
const t1 = await createTab(U('git.example.test/repo'));
let info = await waitGroup(t1, 'Code');
check('New URL lands in the matching group (name)', info?.group === 'Code', JSON.stringify(info));
check('… with the right color', info?.color === 'blue', JSON.stringify(info));

// T2 subdomain, the same group is reused
const t2 = await createTab(U('gist.git.example.test/x'));
await waitGroup(t2, 'Code');
let st = await state();
check('Subdomain lands in the same group', st.tabs.find((t) => t.id === t2).groupId === st.tabs.find((t) => t.id === t1).groupId);
check('No duplicate group', st.groups.filter((g) => g.title === 'Code').length === 1);

// T3 path rule further up wins
const t3 = await createTab(U('git.example.test/acme/project'));
info = await waitGroup(t3, 'Work');
check('Path pattern (group further up) wins', info?.group === 'Work' && info?.color === 'purple', JSON.stringify(info));

// T4 exclusion
const t4a = await createTab(U('docs.google.test/doc'));
const t4b = await createTab(U('mail.google.test/inbox'));
info = await waitGroup(t4a, 'Google');
check('docs.google.test → Google', info?.group === 'Google');
info = await waitGroup(t4b, 'Mail');
check('Exclusion: mail.google.test → Mail instead of Google', info?.group === 'Mail' && info?.color === 'red', JSON.stringify(info));

// T5 no rule
const t5 = await createTab(U('other.test/'));
await sleep(700);
check('Unknown URL stays ungrouped', (await tabInfo(t5))?.group === null);

// T6 navigation in the same tab
await navigate(t5, U('acme.atlassian.test/browse/X-1'));
info = await waitGroup(t5, 'Jira');
check('Navigating in the tab → gets grouped afterwards', info?.group === 'Jira' && info?.color === 'orange', JSON.stringify(info));

// T7 paused group
const t7 = await createTab(U('paused.test/'));
await sleep(700);
check('Paused group does not apply', (await tabInfo(t7))?.group === null);

// T8 many tabs at once
const many = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => createTab(U(`gitlab.test/p${i}`))));
await waitFor(async () => {
  const s = await state();
  return many.every((id) => s.tabs.find((t) => t.id === id)?.group === 'Code');
});
st = await state();
check('6 tabs opened at once all in “Code”', many.every((id) => st.tabs.find((t) => t.id === id)?.group === 'Code'));
check('… and still only one “Code” group in the window', st.groups.filter((g) => g.title === 'Code' && g.windowId === mainWindowId).length === 1);

// T9 removing a tab by hand is respected
await sw.evaluate((id) => chrome.tabs.ungroup(id), t2);
await sleep(300);
await navigate(t2, U('git.example.test/next'));
await sleep(900);
check('Tab removed by hand is not pulled back when navigating on', (await tabInfo(t2))?.group === null);
await navigate(t2, U('jira.atlassian.test/'));
info = await waitGroup(t2, 'Jira');
check('… once it switches to another rule, it is assigned again', info?.group === 'Jira');

// T10 second window
const win2 = await sw.evaluate(async (url) => {
  const w = await chrome.windows.create({ url });
  return { id: w.id, tabId: w.tabs[0].id };
}, U('git.example.test/w2'));
info = await waitGroup(win2.tabId, 'Code');
st = await state();
check('Second window gets its own “Code” group', info?.group === 'Code' && info.windowId === win2.id && st.groups.filter((g) => g.title === 'Code').length === 2);

// T11 pinned tabs
const t11 = await createTab(U('git.example.test/pinned'), { pinned: true });
await sleep(800);
info = await tabInfo(t11);
check('Pinned tabs are left alone', info?.pinned && info.group === null, JSON.stringify(info));

// T12 rename/recolor in the settings → open groups follow
await sw.evaluate(async () => {
  const { 'group:code': g } = await chrome.storage.sync.get('group:code');
  await chrome.storage.sync.set({ 'group:code': { ...g, name: 'Development', color: 'cyan' } });
});
const renamed = await waitFor(async () => {
  const s = await state();
  const g = s.groups.filter((x) => x.title === 'Development' && x.color === 'cyan');
  return g.length === 2 && !s.groups.some((x) => x.title === 'Code') ? g : null;
});
check('Rename + color change applies to open groups (both windows)', renamed);

// T13 tab leaves its group (option off/on) + other groups stay untouched
await navigate(t1, U('nowhere.test/'));
await sleep(800);
check('Option off: tab stays in its group when leaving', (await tabInfo(t1))?.group === 'Development');
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, ungroupOnLeave: true } });
});
await sleep(200);
const t13 = await createTab(U('git.example.test/leave'));
await waitGroup(t13, 'Development');
await navigate(t13, U('nowhere.test/2'));
info = await waitFor(async () => ((await tabInfo(t13))?.group === null ? true : null));
check('Option on: tab is taken out of the group when leaving', info);
const privateTab = await createTab(U('git.example.test/private'));
await waitGroup(privateTab, 'Development');
await sw.evaluate(async (id) => {
  const gid = await chrome.tabs.group({ tabIds: [id] });
  await chrome.tabGroups.update(gid, { title: 'Private', color: 'pink' });
}, privateTab);
await navigate(privateTab, U('private.test/b'));
await sleep(800);
check('Option on: other (user-created) groups are not touched', (await tabInfo(privateTab))?.group === 'Private');

// T14 new tab from a grouped tab (link with target=_blank)
const opener = await context.newPage();
await opener.goto(`${U('docs.google.test/links')}?to=${encodeURIComponent(U('git.example.test/from-link'))}`);
await waitFor(async () => (await state()).tabs.find((t) => t.url?.includes('/links'))?.group === 'Google');
const [popupPage] = await Promise.all([context.waitForEvent('page'), opener.click('#l')]);
await popupPage.waitForLoadState();
info = await waitFor(async () => {
  const t = (await state()).tabs.find((x) => x.url?.includes('/from-link'));
  return t?.group === 'Development' ? t : null;
});
check('Link from inside a group → lands in the right group', info);

// T15 a collapsed group expands when the active tab joins it
const mailGroup = (await state()).groups.find((g) => g.title === 'Mail' && g.windowId === mainWindowId);
await sw.evaluate(async ({ gid, win }) => {
  const [other] = await chrome.tabs.query({ windowId: win, groupId: -1, pinned: false });
  await chrome.tabs.update(other.id, { active: true });
  await chrome.tabGroups.update(gid, { collapsed: true });
}, { gid: mailGroup.id, win: mainWindowId });
check('(Setup) group “Mail” collapsed', (await state()).groups.find((g) => g.id === mailGroup.id)?.collapsed === true);
const t15 = await createTab(U('mail.google.test/new'), { active: true });
await waitGroup(t15, 'Mail');
await sleep(300);
check('Collapsed group expands when the active tab joins it', (await state()).groups.find((g) => g.id === mailGroup.id)?.collapsed === false);

// T16 automatic grouping off → nothing happens, badge “off”, “Sort all tabs” catches up
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, enabled: false, ungroupOnLeave: false } });
});
await sleep(300);
const t16 = await createTab(U('git.example.test/off'));
await sleep(900);
check('Automatic grouping off: new tab is not grouped', (await tabInfo(t16))?.group === null);
check('Automatic grouping off: icon shows “off”', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === 'off');
const sortResult = await optionsPage.evaluate(() => chrome.runtime.sendMessage({ type: 'sortAll' }));
info = await tabInfo(t16);
check('“Sort all tabs” still assigns the tab', sortResult?.ok && info?.group === 'Development', JSON.stringify({ sortResult, info }));
await sw.evaluate(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...settings, enabled: true } });
});
check('Automatic grouping back on: icon without text', await waitFor(async () => (await sw.evaluate(() => chrome.action.getBadgeText({}))) === ''));

// ---------- Settings page (UI) ----------
await optionsPage.bringToFront();
await optionsPage.reload();
await optionsPage.waitForSelector('.group-card');
check('Settings page shows all groups', (await optionsPage.locator('.group-card').count()) === 6);

await optionsPage.click('#add-group');
const docsId = await optionsPage.locator('.group-card').last().getAttribute('data-id');
const card = optionsPage.locator(`.group-card[data-id="${docsId}"]`);
await card.locator('.name').fill('Docs');
await card.locator('.swatch[data-color="pink"]').click();
await card.locator('.patterns').fill('docs.example.test\n\n# comment');
check('Save bar appears on changes', await optionsPage.locator('#savebar.is-visible').count());
check('Preview chip shows name + color', (await card.locator('.chip').textContent()) === 'Docs' && (await card.locator('.preview').getAttribute('data-color')) === 'pink');

// Errors: duplicate name and broken pattern
await card.locator('.name').fill('google');
await card.locator('.patterns').fill('docs.example.test\n/[/');
check('Duplicate name is reported', (await card.locator('.name-issues .note.error').count()) === 1);
check('Broken regular expression is reported with its line', (await card.locator('.pattern-issues').textContent()).includes('Line 2'));
await optionsPage.click('#save');
await sleep(300);
let stored = await sw.evaluate(() => chrome.storage.sync.get(null));
check('Saving with errors is prevented', !Object.values(stored).some((v) => v?.name === 'google'));

await card.locator('.name').fill('Docs');
await card.locator('.patterns').fill('docs.example.test\n\n# comment');
// Shadowing warning: a pattern that a group further up already covers
await card.locator('.patterns').fill('docs.example.test\nsub.google.test');
check('Warning when a group further up already catches the pattern', (await card.locator('.pattern-issues .note.warn').textContent())?.includes('Google'));
await card.locator('.patterns').fill('docs.example.test\n\n# comment');

// Test field
await optionsPage.fill('#test-url', 'mail.google.test/x');
const testText = await optionsPage.locator('#test-result').textContent();
check('URL test shows the match and the skipped exclusion', testText.includes('Mail') && testText.includes('!mail.google.test'), testText);

await optionsPage.keyboard.press('Control+s');
stored = await waitFor(async () => {
  const s = await sw.evaluate(() => chrome.storage.sync.get(null));
  return Object.values(s).some((v) => v?.name === 'Docs') ? s : null;
});
const docs = stored && Object.values(stored).find((v) => v?.name === 'Docs');
check('Ctrl+S saves the new group (name, color, patterns)', docs?.color === 'pink' && docs.patterns.join('|') === 'docs.example.test|# comment', JSON.stringify(docs));
check('Save bar disappears after saving', await waitFor(async () => (await optionsPage.locator('#savebar.is-visible').count()) === 0));

const t17 = await createTab(U('docs.example.test/manual'));
info = await waitGroup(t17, 'Docs');
check('Group created in the UI takes effect immediately', info?.color === 'pink', JSON.stringify(info));

// Change the order: Docs to the top
for (let i = 0; i < 6; i++) await card.locator('[data-action="up"]').click();
check('Moving up changes the order', (await optionsPage.locator('.group-card').first().locator('.name').inputValue()) === 'Docs');
await optionsPage.click('#discard');
check('Discard restores the saved state', (await optionsPage.locator('.group-card').last().locator('.name').inputValue()) === 'Docs');

// ---------- Popup: assign a domain to a group ----------
const t18 = await createTab(U('newsite.test/article'));
await sleep(400);
const popup = await context.newPage();
await popup.setViewportSize({ width: 340, height: 600 });
await popup.goto(`chrome-extension://${extId}/popup.html?tab=${t18}`);
await popup.waitForSelector('#assign:not([hidden])');
const suggested = await popup.locator('#assign-label code').textContent();
check('Popup suggests the domain', suggested === `newsite.test${PORT_SUFFIX}`, suggested);
await popup.selectOption('#target', '__new__');
check('Popup suggests a group name', (await popup.locator('#new-name').inputValue()) === 'Newsite');
await popup.fill('#new-name', 'News');
await popup.click('#assign-btn');
info = await waitGroup(t18, 'News');
check('Popup: new group created and tab sorted in', info?.group === 'News', JSON.stringify(info));
check('Popup: feedback is shown', (await popup.locator('#msg').textContent()).includes('News'));

// Automatic ordering: sub.google.test is caught by “Google” → the new group has to go in front of it
const t19 = await createTab(U('sub.google.test/x'));
await waitGroup(t19, 'Google');
await popup.goto(`chrome-extension://${extId}/popup.html?tab=${t19}`);
await popup.waitForSelector('#assign:not([hidden])');
check('Popup shows the current assignment', (await popup.locator('#status').textContent()).includes('Google'));
await popup.selectOption('#target', '__new__');
await popup.fill('#new-name', 'Sub');
await popup.click('#assign-btn');
info = await waitGroup(t19, 'Sub');
stored = await sw.evaluate(() => chrome.storage.sync.get(null));
const order = stored.settings.order.map((id) => stored[`group:${id}`].name);
check('Popup: target group is moved in front of the group that used to win', info?.group === 'Sub' && order.indexOf('Sub') < order.indexOf('Google'), order.join(' > '));

// Popup: move an existing domain to another group
const t20 = await createTab(U('gitlab.test/move'));
await waitGroup(t20, 'Development');
await popup.goto(`chrome-extension://${extId}/popup.html?tab=${t20}`);
await popup.waitForSelector('#assign:not([hidden])');
const jiraOption = await popup.locator('#target option', { hasText: 'Jira' }).getAttribute('value');
await popup.selectOption('#target', jiraOption);
await popup.click('#assign-btn');
info = await waitGroup(t20, 'Jira');
stored = await sw.evaluate(() => chrome.storage.sync.get(null));
check('Popup: domain moves to another group (and is removed from the old one)', info?.group === 'Jira' && !stored['group:code'].patterns.includes(`gitlab.test${PORT_SUFFIX}`) && stored['group:jira'].patterns.includes(`gitlab.test${PORT_SUFFIX}`), JSON.stringify({ info, code: stored['group:code'].patterns, jira: stored['group:jira'].patterns }));

// The settings page picked up the popup changes (no unsaved changes → silently reloaded)
await sleep(500);
check('Settings page picks up changes from the popup automatically', (await optionsPage.locator('.group-card .name').evaluateAll((els) => els.map((e) => e.value))).includes('Sub'));

// ---------- Open group ----------
await sw.evaluate(
  async ({ P }) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({
      settings: { ...settings, order: [...settings.order, 'start', 'tools'] },
      'group:start': {
        name: 'Start',
        color: 'purple',
        patterns: ['start.test'],
        openUrls: [`start.test${P}/a`, `start.test${P}/b`, `http://start.test${P}/c`],
        enabled: true,
      },
      'group:tools': {
        name: 'Tools',
        color: 'grey',
        patterns: [`tools.test${P}`, '*.wild.test', '/re/', '!x.tools.test', `tools2.test${P}/path`],
        openUrls: [],
        enabled: true,
      },
    });
  },
  { P: PORT_SUFFIX },
);
await sleep(300);
const openGroupMsg = (groupId, windowId) =>
  optionsPage.evaluate(({ groupId, windowId }) => chrome.runtime.sendMessage({ type: 'openGroup', groupId, windowId }), {
    groupId,
    windowId,
  });
const windowTabs = async (windowId) => (await state()).tabs.filter((t) => t.windowId === windowId);
const pathOf = (t) => new URL(t.url).pathname;

// O1: window with an empty “New Tab”
const W = await sw.evaluate(async () => {
  const w = await chrome.windows.create({ url: 'chrome://newtab/' });
  return { id: w.id, tabId: w.tabs[0].id };
});
await sleep(500);
let r = await openGroupMsg('start', W.id);
let wt = await waitFor(async () => {
  const t = await windowTabs(W.id);
  return t.length === 3 && t.every((x) => x.group === 'Start') ? t : null;
});
check('Open group: 3 pages as a group in the current window', r?.ok && r.opened === 3 && wt, JSON.stringify({ r, tabs: await windowTabs(W.id) }));
check('… the empty “New Tab” is used for the first page', wt?.some((t) => t.id === W.tabId && pathOf(t) === '/a'));
check('… order a, b, c and group color', wt?.map(pathOf).join() === '/a,/b,/c' && wt.every((t) => t.color === 'purple'), JSON.stringify(wt));
check('… the first page is active', wt?.find((t) => t.active) && pathOf(wt.find((t) => t.active)) === '/a');

// O2: open again → nothing twice
r = await openGroupMsg('start', W.id);
await sleep(400);
check('Opening again: no duplicate tabs', r?.ok && r.opened === 0 && r.alreadyOpen === 3 && (await windowTabs(W.id)).length === 3, JSON.stringify(r));

// O3: close one page → only that one is added
const tabB = (await windowTabs(W.id)).find((t) => pathOf(t) === '/b');
await sw.evaluate((id) => chrome.tabs.remove(id), tabB.id);
await sleep(300);
r = await openGroupMsg('start', W.id);
wt = await waitFor(async () => {
  const t = await windowTabs(W.id);
  return t.length === 3 && t.every((x) => x.group === 'Start') ? t : null;
});
check('Missing page is added (exactly 1 new tab)', r?.ok && r.opened === 1 && wt, JSON.stringify(r));

// O4: redirect to a URL of another group (Jira)
await sw.evaluate(
  async ({ P, target }) => {
    const { 'group:start': g } = await chrome.storage.sync.get('group:start');
    await chrome.storage.sync.set({
      'group:start': { ...g, openUrls: [...g.openUrls, `start.test${P}/redirect?to=${encodeURIComponent(target)}`] },
    });
  },
  { P: PORT_SUFFIX, target: U('jira.atlassian.test/redirected') },
);
await sleep(300);
r = await openGroupMsg('start', W.id);
await waitFor(async () => (await windowTabs(W.id)).find((x) => x.url?.includes('/redirected')));
await sleep(800);
info = (await windowTabs(W.id)).find((x) => x.url?.includes('/redirected'));
check('Redirect into another group: tab stays in the opened group', info?.group === 'Start', JSON.stringify(info));

// O5: no own list → concrete URLs from the patterns; a normal page in the active tab stays
const W2 = await sw.evaluate(async (url) => {
  const w = await chrome.windows.create({ url });
  return { id: w.id, tabId: w.tabs[0].id };
}, U('other.test/page'));
await sleep(700);
r = await openGroupMsg('tools', W2.id);
wt = await waitFor(async () => {
  const t = (await windowTabs(W2.id)).filter((x) => x.group === 'Tools');
  return t.length === 2 ? t : null;
});
const hostsAndPaths = wt?.map((t) => new URL(t.url).host + new URL(t.url).pathname).join();
check(
  'Without an own list: only concrete URLs from the patterns',
  r?.ok && r.opened === 2 && hostsAndPaths === `tools.test${PORT_SUFFIX}/,tools2.test${PORT_SUFFIX}/path`,
  JSON.stringify({ r, hostsAndPaths }),
);
const pageTab = (await windowTabs(W2.id)).find((t) => t.id === W2.tabId);
check('A normal page in the active tab is not overwritten', pageTab?.url.includes('other.test') && pageTab.group === null, JSON.stringify(pageTab));

// O6: a paused group can still be opened
r = await openGroupMsg('paused', W2.id);
wt = await waitFor(async () => ((await windowTabs(W2.id)).filter((x) => x.group === 'Paused').length === 1 ? true : null));
check('Paused groups can be opened too', r?.ok && wt, JSON.stringify(r));

// O7: popup – “Open group” list and click
const launcher = await context.newPage();
await launcher.setViewportSize({ width: 340, height: 600 });
await launcher.goto(`chrome-extension://${extId}/popup.html?tab=${W2.tabId}`);
await launcher.waitForSelector('#launch:not([hidden])');
const rowLabels = await launcher.locator('.launch-row').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
check(
  'Popup lists groups to open with page count and “already open”',
  rowLabels.some((l) => l.includes('“Start”') && l.includes('4 pages')) &&
    rowLabels.some((l) => l.includes('“Tools”') && l.includes('already open')),
  rowLabels.join(' | '),
);
await launcher.locator('.launch-row', { hasText: 'Start' }).click();
wt = await waitFor(async () => {
  const t = (await windowTabs(W2.id)).filter((x) => x.group === 'Start');
  return t.length === 4 ? t : null;
});
check('One click in the popup opens the whole group', wt, JSON.stringify(await windowTabs(W2.id)));
if (!launcher.isClosed()) await launcher.close();

// O8: settings – preview, validation, “Open now”
await optionsPage.bringToFront();
await optionsPage.reload();
await optionsPage.waitForSelector('.group-card[data-id="start"]');
const startCard = optionsPage.locator('.group-card[data-id="start"]');
const toolsCard = optionsPage.locator('.group-card[data-id="tools"]');
check('Settings: preview shows what will be opened', (await startCard.locator('.open-preview').textContent()).includes('Opens 4 pages'));
check('Settings: preview names the patterns as the source', (await toolsCard.locator('.open-preview').textContent()).includes('from the URL patterns'));
await startCard.locator('.open-urls').fill('start.test/a\n*.foo.de');
check('Settings: a pattern instead of a URL is reported with its line', (await startCard.locator('.open-issues').textContent()).includes('Line 2'));
await optionsPage.click('#discard');
const optionsWindow = await optionsPage.evaluate(async () => (await chrome.windows.getCurrent()).id);
await toolsCard.locator('[data-action="open"]').click();
wt = await waitFor(async () => {
  const t = (await windowTabs(optionsWindow)).filter((x) => x.group === 'Tools');
  return t.length === 2 ? t : null;
});
check('Settings: “Open now” opens the group in the same window', wt, JSON.stringify(await windowTabs(optionsWindow)));

// ---------- Service worker warnings ----------
const logs = (await sw.evaluate(() => self.__logs)) ?? ['(log hook lost – service worker restarted?)'];
check('No errors/warnings in the service worker', logs.length === 0, logs.join('\n'));

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await context.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(results.every((r) => r.ok) ? 0 : 1);
