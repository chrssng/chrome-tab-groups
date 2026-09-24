import { nextFreeColor } from '../lib/colors.js';
import {
  loadConfig,
  saveConfig,
  normalizeGroup,
  newId,
  validateConfig,
  toExport,
  fromImport,
} from '../lib/config.js';
import { compileGroups, explainMatch, urlsToOpen, shortUrl } from '../lib/patterns.js';
import { h, icon, chip, swatches, note, toast } from './dom.js';

const $ = (selector) => document.querySelector(selector);

const els = {
  groups: $('#groups'),
  empty: $('#empty'),
  addGroup: $('#add-group'),
  testUrl: $('#test-url'),
  testResult: $('#test-result'),
  setEnabled: $('#set-enabled'),
  setUngroup: $('#set-ungroup'),
  sortAll: $('#sort-all'),
  exportBtn: $('#export'),
  importBtn: $('#import'),
  importFile: $('#import-file'),
  savebar: $('#savebar'),
  savebarText: $('#savebar-text'),
  save: $('#save'),
  discard: $('#discard'),
  external: $('#external-change'),
  reload: $('#reload'),
};

/** Last saved state and working copy */
let saved = { settings: { enabled: true, ungroupOnLeave: false }, groups: [] };
let draft = clone(saved);
let validation = validateConfig(draft);
let saving = false;

function clone(value) {
  return structuredClone(value);
}

function normalized(config) {
  return {
    settings: { enabled: config.settings.enabled !== false, ungroupOnLeave: !!config.settings.ungroupOnLeave },
    groups: config.groups.map(normalizeGroup),
  };
}

const sameConfig = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const isDirty = () => !sameConfig(draft, saved);
const findGroup = (id) => draft.groups.find((g) => g.id === id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- Rendering ---------- */

function renderAll() {
  els.setEnabled.checked = draft.settings.enabled;
  els.setUngroup.checked = draft.settings.ungroupOnLeave;
  renderGroups();
  refresh();
}

function renderGroups() {
  const total = draft.groups.length;
  els.groups.replaceChildren(...draft.groups.map((group, index) => groupCard(group, index, total)));
  els.empty.hidden = total > 0;
  els.groups.querySelectorAll('textarea').forEach(autoGrow);
}

function iconButton(iconName, label, action, { disabled = false, extraClass = '' } = {}) {
  return h(
    'button',
    { type: 'button', class: `icon-btn ${extraClass}`.trim(), title: label, 'aria-label': label, disabled, dataset: { action } },
    icon(iconName),
  );
}

function preview(group) {
  return h(
    'div',
    { class: 'preview', dataset: { color: group.color }, 'aria-hidden': 'true' },
    chip(group.name, group.color),
    h('span', { class: 'ghost-tab' }),
    h('span', { class: 'ghost-tab' }),
  );
}

function groupCard(group, index, total) {
  const id = group.id;
  return h(
    'li',
    { class: `group-card${group.enabled ? '' : ' is-disabled'}`, dataset: { id } },
    h(
      'div',
      { class: 'card-head' },
      h('span', { class: 'order', title: `Priority ${index + 1}` }, String(index + 1)),
      preview(group),
      h(
        'div',
        { class: 'card-tools' },
        h(
          'label',
          { class: 'switch compact' },
          h('input', { type: 'checkbox', class: 'enabled', checked: group.enabled }),
          h('span', { class: 'track', 'aria-hidden': 'true' }),
          h('span', { class: 'switch-label' }, group.enabled ? 'Active' : 'Paused'),
        ),
        h('span', { class: 'tools-sep', 'aria-hidden': 'true' }),
        iconButton('up', 'Move up', 'up', { disabled: index === 0 }),
        iconButton('down', 'Move down', 'down', { disabled: index === total - 1 }),
        iconButton('trash', 'Delete group', 'delete', { extraClass: 'danger' }),
      ),
    ),
    h(
      'div',
      { class: 'card-body' },
      h('label', { class: 'field-label', for: `name-${id}` }, 'Name'),
      h(
        'div',
        { class: 'field' },
        h('input', {
          class: 'input name',
          id: `name-${id}`,
          type: 'text',
          value: group.name,
          maxlength: '60',
          autocomplete: 'off',
          placeholder: 'e.g. Development',
        }),
        h('div', { class: 'issues name-issues' }),
      ),
      h('span', { class: 'field-label', id: `color-label-${id}` }, 'Color'),
      h('div', { class: 'field' }, swatches(`color-${id}`, group.color, { label: 'Color' })),
      h(
        'label',
        { class: 'field-label top', for: `patterns-${id}` },
        'URL patterns',
        h('span', { class: 'field-hint' }, 'one per line'),
      ),
      h(
        'div',
        { class: 'field' },
        h('textarea', {
          class: 'textarea patterns',
          id: `patterns-${id}`,
          rows: 3,
          spellcheck: 'false',
          autocomplete: 'off',
          placeholder: 'github.com\n*.atlassian.net\nhttps://intranet.example.com/wiki',
          value: group.patterns.join('\n'),
        }),
        h('div', { class: 'issues pattern-issues' }),
      ),
      h(
        'label',
        { class: 'field-label top', for: `open-${id}` },
        'Pages to open',
        h('span', { class: 'field-hint' }, 'optional'),
      ),
      h(
        'div',
        { class: 'field' },
        h('textarea', {
          class: 'textarea open-urls',
          id: `open-${id}`,
          rows: 2,
          spellcheck: 'false',
          autocomplete: 'off',
          placeholder: 'Empty = the URLs from the URL patterns\ne.g. https://github.com/my-company/webshop/pulls',
          value: (group.openUrls ?? []).join('\n'),
        }),
        h(
          'div',
          { class: 'open-row' },
          h('p', { class: 'open-preview' }),
          h('button', { type: 'button', class: 'btn small', dataset: { action: 'open' } }, icon('launch'), 'Open now'),
        ),
        h('div', { class: 'issues open-issues' }),
      ),
    ),
  );
}

/** Preview of the pages "Open group" would load */
function renderOpenPreview(card, group) {
  const { urls, source } = urlsToOpen(group);
  const preview = card.querySelector('.open-preview');
  if (urls.length) {
    preview.replaceChildren(
      h('strong', {}, `Opens ${plural(urls.length, 'page', 'pages')}`),
      source === 'patterns' ? ' from the URL patterns: ' : ': ',
      urls.map(shortUrl).join(' · '),
    );
  } else {
    preview.replaceChildren(
      'Nothing to open – enter URLs here. (From the URL patterns, only concrete URLs count – ' +
        'no patterns with *, regular expressions or exclusions.)',
    );
  }
  card.querySelector('[data-action="open"]').disabled = !urls.length;
}

/** Update errors/hints, test result and save bar */
function refresh() {
  validation = validateConfig(draft);
  for (const card of els.groups.children) {
    const item = validation.report.get(card.dataset.id);
    if (!item) continue;
    const nameInput = card.querySelector('.name');
    const textarea = card.querySelector('.patterns');
    const openArea = card.querySelector('.open-urls');
    nameInput.setAttribute('aria-invalid', String(!!item.nameError));
    textarea.setAttribute('aria-invalid', String(item.patternErrors.length > 0));
    openArea.setAttribute('aria-invalid', String(item.openErrors.length > 0));
    card.querySelector('.name-issues').replaceChildren(...(item.nameError ? [note('error', item.nameError)] : []));
    card.querySelector('.pattern-issues').replaceChildren(
      ...item.patternErrors.map((e) => note('error', `Line ${e.index + 1} “${e.line}”: ${e.message}`)),
      ...item.warnings.map((w) => note('warn', w)),
    );
    card.querySelector('.open-issues').replaceChildren(
      ...item.openErrors.map((e) => note('error', `Line ${e.index + 1} “${e.line}”: ${e.message}`)),
    );
    renderOpenPreview(card, findGroup(card.dataset.id));
  }
  renderTest();
  updateSavebar();
}

function updateSavebar() {
  const dirty = isDirty();
  els.savebar.classList.toggle('is-visible', dirty);
  els.savebar.setAttribute('aria-hidden', String(!dirty));
  els.savebar.inert = !dirty;
  els.savebarText.textContent = validation.ok
    ? 'Unsaved changes'
    : 'Unsaved changes – please fix the marked errors first';
  els.savebar.classList.toggle('has-errors', !validation.ok);
  document.body.classList.toggle('has-savebar', dirty);
}

function renderTest() {
  let value = els.testUrl.value.trim();
  if (!value) {
    els.testResult.replaceChildren();
    return;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^(about|data|blob|mailto):/i.test(value)) {
    value = `https://${value}`;
  }
  const result = explainMatch(compileGroups(draft.groups), value);
  const lines = [];
  if (!result.valid) {
    lines.push(note('error', 'That is not a valid URL.'));
  } else if (result.match) {
    const { group, pattern } = result.match;
    lines.push(
      h(
        'div',
        { class: 'test-hit' },
        h('span', { class: 'muted' }, 'Goes to'),
        chip(group.name, group.color),
        h('span', { class: 'muted' }, 'via the pattern'),
        h('code', {}, pattern),
      ),
    );
  } else {
    lines.push(note('info', 'No group matches – the tab stays where it is.'));
  }
  for (const { group, pattern } of result.excluded) {
    lines.push(h('p', { class: 'test-aside' }, `Skipped: “${group.name || 'Unnamed'}” because of the exclusion `, h('code', {}, pattern)));
  }
  for (const { group } of result.disabled) {
    lines.push(h('p', { class: 'test-aside' }, `Would also match “${group.name || 'Unnamed'}”, but that group is paused.`));
  }
  els.testResult.replaceChildren(...lines);
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 360)}px`;
}

/* ---------- Editing ---------- */

els.groups.addEventListener('input', (event) => {
  const card = event.target.closest('.group-card');
  const group = card && findGroup(card.dataset.id);
  if (!group) return;

  if (event.target.matches('.name')) {
    group.name = event.target.value;
    card.querySelector('.chip').replaceWith(chip(group.name, group.color));
  } else if (event.target.matches('.patterns')) {
    group.patterns = event.target.value.split('\n');
    autoGrow(event.target);
  } else if (event.target.matches('.open-urls')) {
    group.openUrls = event.target.value.split('\n');
    autoGrow(event.target);
  }
  refresh();
});

els.groups.addEventListener('change', (event) => {
  const card = event.target.closest('.group-card');
  const group = card && findGroup(card.dataset.id);
  if (!group) return;

  if (event.target.matches('input[type="radio"]')) {
    group.color = event.target.value;
    card.querySelector('.preview').dataset.color = group.color;
    card.querySelector('.chip').dataset.color = group.color;
  } else if (event.target.matches('.enabled')) {
    group.enabled = event.target.checked;
    card.classList.toggle('is-disabled', !group.enabled);
    card.querySelector('.switch-label').textContent = group.enabled ? 'Active' : 'Paused';
  }
  refresh();
});

els.groups.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.group-card');
  const index = draft.groups.findIndex((g) => g.id === card.dataset.id);
  if (index === -1) return;
  const action = button.dataset.action;

  if (action === 'up' || action === 'down') {
    const target = action === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= draft.groups.length) return;
    const [group] = draft.groups.splice(index, 1);
    draft.groups.splice(target, 0, group);
    renderGroups();
    refresh();
    const moved = els.groups.querySelector(`[data-id="${group.id}"]`);
    const sameButton = moved.querySelector(`button[data-action="${action}"]`);
    (sameButton.disabled ? moved.querySelector('.name') : sameButton).focus();
    moved.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  if (action === 'open') {
    openGroupNow(card.dataset.id, button);
    return;
  }

  if (action === 'delete') {
    const [removed] = draft.groups.splice(index, 1);
    renderGroups();
    refresh();
    const next = els.groups.children[Math.min(index, draft.groups.length - 1)];
    (next?.querySelector('.name') ?? els.addGroup).focus();
    toast(`“${removed.name || 'Unnamed'}” removed – click “Discard” to undo.`);
  }
});

els.addGroup.append(icon('plus'), 'Add group');
els.addGroup.addEventListener('click', () => {
  const group = normalizeGroup({ id: newId(), name: '', color: nextFreeColor(draft.groups), patterns: [] });
  draft.groups.push(group);
  renderGroups();
  refresh();
  const card = els.groups.lastElementChild;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.querySelector('.name').focus({ preventScroll: true });
});

els.setEnabled.addEventListener('change', () => {
  draft.settings.enabled = els.setEnabled.checked;
  refresh();
});
els.setUngroup.addEventListener('change', () => {
  draft.settings.ungroupOnLeave = els.setUngroup.checked;
  refresh();
});

els.testUrl.addEventListener('input', renderTest);

/* ---------- Save / discard ---------- */

async function save() {
  refresh();
  if (!validation.ok) {
    toast('Please fix the errors marked in red first.', 'error');
    els.groups.querySelector('[aria-invalid="true"]')?.focus();
    return false;
  }
  saving = true;
  els.save.disabled = true;
  try {
    saved = await saveConfig(draft);
    toast('Saved');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  } finally {
    saving = false;
    els.save.disabled = false;
    refresh();
  }
}

function discard() {
  draft = clone(saved);
  els.external.hidden = true;
  renderAll();
  toast('Changes discarded');
}

els.save.addEventListener('click', save);
els.discard.addEventListener('click', discard);

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (isDirty()) save();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (isDirty()) event.preventDefault();
});

/* ---------- Open group ---------- */

async function openGroupNow(groupId, button) {
  if (isDirty() && !(await save())) return;
  button.disabled = true;
  try {
    const win = await chrome.windows.getCurrent();
    const result = await chrome.runtime.sendMessage({ type: 'openGroup', groupId, windowId: win.id });
    if (!result?.ok) throw new Error(result?.error ?? 'Unknown error');
    const parts = [result.opened ? `${plural(result.opened, 'page', 'pages')} opened` : 'all pages were already open'];
    if (result.failed?.length) parts.push(`could not open: ${result.failed.map(shortUrl).join(', ')}`);
    toast(`“${result.name}”: ${parts.join(' – ')}`, result.failed?.length ? 'error' : 'ok');
  } catch (err) {
    toast(`Opening failed: ${err.message}`, 'error');
  } finally {
    button.disabled = false;
    refresh();
  }
}

/* ---------- Sort all tabs ---------- */

els.sortAll.append(icon('sort'), 'Sort all tabs now');
els.sortAll.addEventListener('click', async () => {
  if (isDirty() && !(await save())) return;
  els.sortAll.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'sortAll' });
    if (!result?.ok) throw new Error(result?.error ?? 'Unknown error');
    const parts = [];
    if (result.moved) parts.push(`${plural(result.moved, 'tab', 'tabs')} sorted into groups`);
    if (result.ungrouped) parts.push(`${plural(result.ungrouped, 'tab', 'tabs')} removed from groups`);
    toast(parts.length ? parts.join(', ') : 'Everything is already sorted.');
  } catch (err) {
    toast(`Sorting failed: ${err.message}`, 'error');
  } finally {
    els.sortAll.disabled = false;
  }
});

/* ---------- Export / Import ---------- */

els.exportBtn.append(icon('download'), 'Export');
els.exportBtn.addEventListener('click', () => {
  const data = JSON.stringify(toExport(normalized(draft)), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const date = new Date().toISOString().slice(0, 10);
  h('a', { href: url, download: `tab-groups-${date}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

els.importBtn.append(icon('upload'), 'Import …');
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    const imported = fromImport(await file.text());
    if (
      draft.groups.length &&
      !confirm(
        `The import replaces your ${plural(draft.groups.length, 'group', 'groups')} with ` +
          `${plural(imported.groups.length, 'group', 'groups')} from the file.\n\n` +
          'It only takes effect once you click “Save”.',
      )
    ) {
      return;
    }
    draft = imported;
    renderAll();
    toast('Import loaded – please review and save.');
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- Changes from elsewhere (popup, other device) ---------- */

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'sync' || saving) return;
  const fresh = await loadConfig();
  if (saving || sameConfig(fresh, saved)) return;
  if (!isDirty()) {
    saved = fresh;
    draft = clone(fresh);
    renderAll();
  } else {
    els.external.hidden = false;
  }
});

els.reload.addEventListener('click', async () => {
  saved = await loadConfig();
  draft = clone(saved);
  els.external.hidden = true;
  renderAll();
});

/* ---------- Start ---------- */

async function init() {
  saved = await loadConfig();
  draft = clone(saved);
  renderAll();
}

init().catch((err) => toast(`Could not load the settings: ${err.message}`, 'error'));
