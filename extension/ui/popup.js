import { nextFreeColor } from '../lib/colors.js';
import {
  loadConfig,
  saveConfig,
  saveSettings,
  normalizeGroup,
  newId,
  groupTitle,
  ownerOf,
  sortBySection,
  categoryName,
} from '../lib/config.js';
import { t, plural } from '../lib/i18n.js';
import {
  compileGroups,
  findMatch,
  suggestPattern,
  suggestName,
  parseUrl,
  canonicalPattern,
  urlsToOpen,
  shortUrl,
} from '../lib/patterns.js';
import { h, icon, chip, swatches, note, loadIds, storeIds, localize, tParts, mutedParts } from './dom.js';

localize();

const $ = (selector) => document.querySelector(selector);
const NEW = '__new__';
/** Collapsed category blocks under “Open group” – remembered on this device, apart from the settings page */
const COLLAPSED_KEY = 'popupCollapsedCategories';
const collapsed = loadIds(COLLAPSED_KEY);

const els = {
  enabled: $('#enabled'),
  paused: $('#paused'),
  launch: $('#launch'),
  launchList: $('#launch-list'),
  foldAll: $('#fold-all'),
  host: $('#host'),
  status: $('#status'),
  assign: $('#assign'),
  assignLabel: $('#assign-label'),
  target: $('#target'),
  newGroup: $('#new-group'),
  newName: $('#new-name'),
  newCategory: $('#new-category'),
  newColor: $('#new-color'),
  newError: $('#new-error'),
  assignBtn: $('#assign-btn'),
  sortAll: $('#sort-all'),
  manage: $('#manage'),
  msg: $('#msg'),
};

let config = null;
let tab = null;
let url = '';
let pattern = null; // suggested pattern for the current tab's domain

const namedGroups = () => config.groups.filter((g) => g.name);
const titleOf = (group) => groupTitle(group, config.categories);
const categoryLabel = (id) => categoryName(config.categories, id) || t('unnamedCategory');
/** Headings only make sense if the groups are spread over several categories. */
const severalCategories = (groups) => new Set(groups.map((g) => g.category)).size > 1;
const sameText = (a, b) => a.trim().toLocaleLowerCase('en') === b.trim().toLocaleLowerCase('en');

function matchFor(groups) {
  return url ? findMatch(compileGroups(groups.filter((g) => g.name)), url) : null;
}

async function getActiveTab() {
  // ?tab=<id> is only meant for testing (popup opened as a normal tab)
  const param = new URLSearchParams(location.search).get('tab');
  if (param) return chrome.tabs.get(Number(param)).catch(() => null);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active ?? null;
}

function describePage(address) {
  const parsed = parseUrl(address);
  if (!parsed) return t('unknownPage');
  if (/^chrome:\/\/new-?tab/i.test(address)) return t('newTab');
  if (parsed.protocol === 'file:') return t('localFile');
  return parsed.host || address;
}

async function groupTitleOf(currentTab) {
  if (!currentTab || currentTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
  const group = await chrome.tabGroups.get(currentTab.groupId).catch(() => null);
  return group?.title ?? null;
}

function showMessage(kind, text) {
  els.msg.replaceChildren(text ? note(kind, text) : '');
}

/* ---------- Display ---------- */

/** IDs of the configured groups that are open in the window. */
async function openGroupIds(windowId) {
  if (!Number.isInteger(windowId)) return new Set();
  const { owners = {} } = await chrome.storage.session.get('owners').catch(() => ({}));
  const ids = (await chrome.tabGroups.query({ windowId })).map((g) => ownerOf(g, config, owners[g.id])?.id);
  return new Set(ids.filter(Boolean));
}

/** "Open group" list: every group with URLs is a single click – with categories under their headings. */
async function renderLaunch() {
  const entries = namedGroups()
    .map((group) => ({ group, urls: urlsToOpen(group).urls }))
    .filter((entry) => entry.urls.length);
  els.launch.hidden = !entries.length;
  if (!entries.length) return;

  const openHere = await openGroupIds(tab?.windowId);
  const rows = (list) =>
    list.map(({ group, urls }) => {
      const count = plural(urls.length, 'page');
      const isOpen = openHere.has(group.id);
      return h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: 'launch-row',
            dataset: { id: group.id },
            title: urls.join('\n'),
            'aria-label': t(isOpen ? 'launchLabelOpen' : 'launchLabel', titleOf(group), count),
            onclick: () => launch({ type: 'openGroup', groupId: group.id }),
          },
          h(
            'span',
            { class: 'launch-head' },
            chip(titleOf(group), group.color),
            h('span', { class: 'launch-count' }, count),
            isOpen
              ? h('span', { class: 'tag', title: t('tagOpenHint') }, t('tagOpen'))
              : null,
            group.enabled ? null : h('span', { class: 'tag is-muted', title: t('tagPausedHint') }, t('tagPaused')),
          ),
          h('span', { class: 'launch-urls' }, urls.map(shortUrl).join(' · ')),
          icon('launch'),
        ),
      );
    });

  if (!severalCategories(entries.map((e) => e.group))) {
    els.launchList.replaceChildren(...rows(entries));
    updateFoldAll();
    return;
  }
  // One block per category: heading with folder icon (a click on it collapses the block), its groups inside
  const blocks = [];
  for (const category of config.categories) {
    const inside = entries.filter((e) => e.group.category === category.id);
    if (!inside.length) continue;
    const name = category.name || t('unnamedCategory');
    const folded = collapsed.has(category.id);
    blocks.push(
      h(
        'li',
        { class: `launch-block${folded ? ' is-collapsed' : ''}`, dataset: { category: category.id } },
        h(
          'div',
          { class: 'launch-cat' },
          h(
            'button',
            {
              type: 'button',
              class: 'launch-fold',
              title: t(folded ? 'expand' : 'collapse'),
              'aria-expanded': String(!folded),
              onclick: (event) => toggleCategory(event.currentTarget),
            },
            icon('chevron'),
            icon('folder'),
            h('span', { class: 'launch-cat-name' }, name),
            h('span', { class: 'launch-cat-count' }, plural(inside.length, 'group')), // only while collapsed
          ),
          inside.length > 1
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'link-btn launch-all',
                  'aria-label': t('openAllOf', inside.length, name),
                  onclick: () => launch({ type: 'openCategory', categoryId: category.id }),
                },
                t('openAll'),
              )
            : null,
        ),
        h('ul', { class: 'launch-sublist', 'aria-label': name }, rows(inside)),
      ),
    );
  }
  els.launchList.replaceChildren(...blocks);
  updateFoldAll();
}

/* Collapsed blocks stay that way the next time the popup opens */
const launchBlocks = () => [...els.launchList.querySelectorAll('.launch-block')];

function setFolded(block, folded) {
  block.classList.toggle('is-collapsed', folded);
  const button = block.querySelector('.launch-fold');
  button.setAttribute('aria-expanded', String(!folded));
  button.title = t(folded ? 'expand' : 'collapse');
  if (folded) collapsed.add(block.dataset.category);
  else collapsed.delete(block.dataset.category);
}

function toggleCategory(button) {
  const block = button.closest('.launch-block');
  setFolded(block, !block.classList.contains('is-collapsed'));
  storeIds(COLLAPSED_KEY, collapsed);
  updateFoldAll();
}

/** The button next to “Open group”: collapses all categories – or, if all are collapsed, expands them. */
function updateFoldAll() {
  const blocks = launchBlocks();
  const anyOpen = blocks.some((b) => !b.classList.contains('is-collapsed'));
  els.foldAll.hidden = !blocks.length;
  els.foldAll.replaceChildren(icon('chevron'), t(anyOpen ? 'collapseAll' : 'expandAll'));
  els.foldAll.classList.toggle('is-folded', !anyOpen);
  els.foldAll.setAttribute('aria-label', t(anyOpen ? 'collapseAllCategories' : 'expandAllCategories'));
}

els.foldAll.addEventListener('click', () => {
  const blocks = launchBlocks();
  const fold = blocks.some((b) => !b.classList.contains('is-collapsed'));
  for (const block of blocks) setFolded(block, fold);
  storeIds(COLLAPSED_KEY, collapsed);
  updateFoldAll();
});

async function renderStatus() {
  els.host.textContent = describePage(url);
  els.host.title = url;
  const match = matchFor(config.groups);
  const parts = [];

  if (match) {
    // “in Work” – unless there is only one category, or the title already shows it
    const inCategory = severalCategories(namedGroups()) && !match.group.showCategory;
    parts.push(
      h(
        'div',
        { class: 'status-line' },
        inCategory
          ? mutedParts(
              'belongsToIn',
              chip(titleOf(match.group), match.group.color),
              h('span', { class: 'status-cat' }, icon('folder'), categoryLabel(match.group.category)),
              h('code', {}, match.pattern),
            )
          : mutedParts('belongsTo', chip(titleOf(match.group), match.group.color), h('code', {}, match.pattern)),
      ),
    );
    if (!tab.pinned && (await groupTitleOf(tab)) !== titleOf(match.group)) {
      parts.push(
        h(
          'button',
          { type: 'button', class: 'link-btn', onclick: sortThisTab },
          t('moveItThere'),
        ),
      );
    }
  } else {
    parts.push(h('span', { class: 'muted' }, t(pattern ? 'noGroupMatches' : 'notAssignable')));
  }
  if (tab?.pinned) parts.push(h('span', { class: 'muted small' }, t('pinnedNeverGrouped')));
  els.status.replaceChildren(...parts);
}

function renderAssign() {
  els.assign.hidden = !pattern;
  if (!pattern) return;

  els.assignLabel.replaceChildren(...tParts('assignDomain', h('code', {}, pattern)));
  const groups = namedGroups();
  const match = matchFor(config.groups);
  const options = [];
  if (groups.length && !match) options.push(h('option', { value: '', disabled: true }, t('chooseGroup')));
  const option = (g) => h('option', { value: g.id }, g.enabled ? g.name : t('groupPaused', g.name));
  if (severalCategories(groups)) {
    for (const category of config.categories) {
      const inside = groups.filter((g) => g.category === category.id);
      if (inside.length) options.push(h('optgroup', { label: category.name || t('unnamedCategory') }, inside.map(option)));
    }
  } else {
    options.push(...groups.map(option));
  }
  options.push(h('option', { value: NEW }, t('newGroupOption')));
  els.target.replaceChildren(...options);
  els.target.value = match ? match.group.id : groups.length ? '' : NEW;
  onTargetChange();
}

function onTargetChange() {
  const value = els.target.value;
  const isNew = value === NEW;
  els.newGroup.hidden = !isNew;
  els.newError.hidden = true;
  if (isNew && !els.newName.value) els.newName.value = suggestName(parseUrl(url)?.host ?? '');
  if (isNew && !els.newColor.firstChild) {
    els.newColor.append(swatches('new-color', nextFreeColor(config.groups), { label: t('newGroupColor') }));
  }
  const match = matchFor(config.groups);
  if (isNew && !els.newCategory.options.length) {
    // Preselected: the category of the group that catches the page now – so the new group can go in front of it
    els.newCategory.replaceChildren(...config.categories.map((c) => h('option', { value: c.id }, categoryLabel(c.id))));
    els.newCategory.value = match?.group.category ?? config.categories[0].id;
  }
  els.newCategory.hidden = config.categories.length < 2;

  const already = !isNew && match && match.group.id === value;
  els.assignBtn.disabled = !value || already;
  els.assignBtn.textContent = t(already ? 'alreadyAssigned' : isNew ? 'createAndAssign' : 'assign');
}

/* ---------- Actions ---------- */

/** message: { type: 'openGroup', groupId } or { type: 'openCategory', categoryId } */
async function launch(message) {
  const rows = [...els.launchList.querySelectorAll('button')];
  rows.forEach((row) => (row.disabled = true));
  try {
    const result = await chrome.runtime.sendMessage({ ...message, windowId: tab?.windowId });
    if (!result?.ok) throw new Error(result?.error ?? t('unknownError'));
    if (result.failed?.length) {
      showMessage(
        'warn',
        `${plural(result.opened, 'pagesOpened')} – ${t('couldNotOpen', result.failed.map(shortUrl).join(', '))}`,
      );
      return;
    }
    window.close(); // the group is open and active – the popup is no longer needed
  } catch (err) {
    showMessage('error', t('openingFailed', err.message));
  } finally {
    rows.forEach((row) => (row.disabled = false));
  }
}

async function refreshTab() {
  tab = (await chrome.tabs.get(tab.id).catch(() => null)) ?? tab;
  url = tab.url || tab.pendingUrl || '';
}

async function sortThisTab() {
  const result = await chrome.runtime.sendMessage({ type: 'sortTab', tabId: tab.id });
  if (!result?.ok) {
    showMessage('error', result?.error ?? t('sortTabFailed'));
    return;
  }
  await refreshTab();
  await renderStatus();
}

async function assign(event) {
  event.preventDefault();
  const targetId = els.target.value;
  if (!targetId) return;

  let groups = structuredClone(config.groups);
  let target;

  if (targetId === NEW) {
    const name = els.newName.value.trim();
    const category = els.newCategory.value || config.categories[0].id;
    const error = !name
      ? t('valGroupName')
      : groups.some((g) => g.category === category && sameText(g.name, name))
        ? config.categories.length > 1
          ? t('nameExistsIn', name, categoryLabel(category))
          : t('nameExists', name)
        : null;
    if (error) {
      els.newError.textContent = error;
      els.newError.hidden = false;
      els.newName.focus();
      return;
    }
    const color = document.querySelector('input[name="new-color"]:checked')?.value;
    target = normalizeGroup({ id: newId(), name, color, patterns: [], category });
    groups = sortBySection([...groups, target], config.categories); // at the end of its category
  } else {
    target = groups.find((g) => g.id === targetId);
    if (!target) return;
  }

  // The domain "moves": remove equivalent patterns from other groups …
  const key = canonicalPattern(pattern);
  for (const g of groups) {
    if (g !== target) g.patterns = g.patterns.filter((p) => canonicalPattern(p) !== key);
  }
  if (!target.patterns.some((p) => canonicalPattern(p) === key)) target.patterns.push(pattern);
  target.enabled = true;

  // … and if a group further up still wins (e.g. google.com before mail.google.com),
  // the target group is moved right in front of it – within its category.
  const winner = matchFor(groups);
  if (winner && winner.group.id !== target.id && winner.group.category === target.category) {
    groups.splice(groups.indexOf(target), 1);
    groups.splice(groups.findIndex((g) => g.id === winner.group.id), 0, target);
  }

  els.assignBtn.disabled = true;
  try {
    config = await saveConfig({ settings: config.settings, categories: config.categories, groups });
    await chrome.runtime.sendMessage({ type: 'sortTab', tabId: tab.id });
    await refreshTab();
    const final = matchFor(config.groups);
    if (final?.group.id === target.id) {
      showMessage('ok', t('assignedOk', pattern, target.name));
    } else if (final) {
      showMessage('warn', t('assignedShadowed', final.group.name, target.name));
    } else {
      showMessage('warn', t('assignedExcluded', target.name));
    }
    els.newName.value = '';
    els.newColor.replaceChildren();
    els.newCategory.replaceChildren();
    await renderStatus();
    renderAssign();
    await renderLaunch();
  } catch (err) {
    showMessage('error', err.message);
    els.assignBtn.disabled = false;
  }
}

els.target.addEventListener('change', onTargetChange);
els.newName.addEventListener('input', () => (els.newError.hidden = true));
els.assign.addEventListener('submit', assign);

els.enabled.addEventListener('change', async () => {
  const enabled = els.enabled.checked;
  config.settings.enabled = enabled;
  els.paused.hidden = enabled;
  try {
    await saveSettings({ enabled });
  } catch (err) {
    showMessage('error', err.message);
  }
});

els.sortAll.append(icon('sort'), t('sortAll'));
els.sortAll.addEventListener('click', async () => {
  els.sortAll.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'sortAll' });
    if (!result?.ok) throw new Error(result?.error ?? t('unknownError'));
    const parts = [];
    if (result.moved) parts.push(plural(result.moved, 'tabsSorted'));
    if (result.ungrouped) parts.push(plural(result.ungrouped, 'tabsUngrouped'));
    showMessage('ok', parts.length ? `${parts.join(', ')}.` : t('alreadySorted'));
    await refreshTab();
    await renderStatus();
  } catch (err) {
    showMessage('error', t('sortingFailed', err.message));
  } finally {
    els.sortAll.disabled = false;
  }
});

els.manage.append(icon('sliders'), t('manageGroups'));
els.manage.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

/* ---------- Start ---------- */

async function init() {
  [config, tab] = await Promise.all([loadConfig(), getActiveTab()]);
  // Forget collapsed categories that no longer exist
  for (const id of collapsed) if (!config.categories.some((c) => c.id === id)) collapsed.delete(id);
  storeIds(COLLAPSED_KEY, collapsed);
  els.enabled.checked = config.settings.enabled;
  els.paused.hidden = config.settings.enabled;
  await renderLaunch();
  if (!tab) {
    els.host.textContent = t('noTabFound');
    return;
  }
  url = tab.url || tab.pendingUrl || '';
  pattern = suggestPattern(url);
  await renderStatus();
  renderAssign();
}

init().catch((err) => showMessage('error', err.message));
