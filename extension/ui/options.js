import { nextFreeColor } from '../lib/colors.js';
import {
  loadConfig,
  saveConfig,
  normalizeGroup,
  newId,
  validateConfig,
  toExport,
  fromImport,
  mergeImport,
  normalizeConfig,
  sortBySection,
  categoryName,
  groupTitle,
} from '../lib/config.js';
import { t, plural } from '../lib/i18n.js';
import { compileGroups, explainMatch, urlsToOpen, shortUrl } from '../lib/patterns.js';
import { h, icon, chip, swatches, note, toast, loadIds, storeIds, localize, tParts, mutedParts } from './dom.js';

localize();

const $ = (selector) => document.querySelector(selector);

const els = {
  groups: $('#groups'),
  collapseAll: $('#collapse-all'),
  addGroup: $('#add-group'),
  addCategory: $('#add-category'),
  testUrl: $('#test-url'),
  testResult: $('#test-result'),
  setEnabled: $('#set-enabled'),
  setUngroup: $('#set-ungroup'),
  setListOrder: $('#set-list-order'),
  sortAll: $('#sort-all'),
  exportBtn: $('#export'),
  importBtn: $('#import'),
  importFile: $('#import-file'),
  importDialog: $('#import-dialog'),
  importSummary: $('#import-summary'),
  resetBtn: $('#reset'),
  resetDialog: $('#reset-dialog'),
  savebar: $('#savebar'),
  savebarText: $('#savebar-text'),
  save: $('#save'),
  discard: $('#discard'),
  external: $('#external-change'),
  reload: $('#reload'),
};

/** Last saved state and working copy */
let saved = normalizeConfig({ settings: {}, groups: [] });
let draft = clone(saved);
let validation = validateConfig(draft);
let saving = false;

function clone(value) {
  return structuredClone(value);
}

const normalized = (config) => normalizeConfig(config);
const sameConfig = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const isDirty = () => !sameConfig(draft, saved);
const findGroup = (id) => draft.groups.find((g) => g.id === id);
const findCategory = (id) => draft.categories.find((c) => c.id === id);
const titleOf = (group) => groupTitle(group, draft.categories);

/** Keeps the groups ordered section by section – the order decides which group wins. */
function resort() {
  draft.groups = sortBySection(draft.groups, draft.categories);
}

/* Collapsed categories and group cards (only on this device, only a view setting) */
const collapsed = loadIds('collapsedCategories');
const collapsedCards = loadIds('collapsedGroups');
const storeCollapsed = () => storeIds('collapsedCategories', collapsed);
const storeCollapsedCards = () => storeIds('collapsedGroups', collapsedCards);

/* ---------- Rendering ---------- */

function renderAll() {
  els.setEnabled.checked = draft.settings.enabled;
  els.setUngroup.checked = draft.settings.ungroupOnLeave;
  els.setListOrder.checked = draft.settings.openInListOrder;
  renderGroups();
  refresh();
}

/** One section per category, each with a head – every group belongs to a category. */
function renderGroups() {
  const noGroups = !draft.groups.length;
  const sections = draft.categories.map((category, sectionIndex) => {
    const groups = draft.groups.filter((g) => g.category === category.id);
    const list = h(
      'ol',
      { class: 'groups', dataset: { category: category.id }, 'aria-label': category.name || t('unnamedCategory') },
      groups.map((group, i) => groupCard(group, { index: draft.groups.indexOf(group), first: i === 0, last: i === groups.length - 1 })),
      h(
        'li',
        { class: 'cat-empty' },
        noGroups
          ? [
              h('p', { class: 'empty-title' }, t('noGroupsTitle')),
              h('p', {}, t('noGroupsText')),
            ]
          : t('categoryEmpty'),
      ),
    );
    return h(
      'section',
      { class: `cat-section${collapsed.has(category.id) ? ' is-collapsed' : ''}`, dataset: { category: category.id } },
      categoryHead(category, sectionIndex),
      h('div', { class: 'issues cat-issues' }),
      list,
    );
  });
  els.groups.replaceChildren(...sections);
  els.groups.querySelectorAll('.cat-section:not(.is-collapsed) .group-card:not(.is-collapsed) textarea').forEach(autoGrow);
}

/** A chevron button that collapses/expands a category or a group card. */
function toggleButton(expanded, name, dataset) {
  return h(
    'button',
    {
      type: 'button',
      class: 'icon-btn fold',
      title: t(expanded ? 'collapse' : 'expand'),
      'aria-label': t(expanded ? 'collapseNamed' : 'expandNamed', name),
      'aria-expanded': String(expanded),
      dataset: { ...dataset, name },
    },
    icon('chevron'),
  );
}

/** A ⋮ button with a menu of menuItem()s and menuSep()s – see “Menu behind ⋮” below. */
function moreMenu(name, ...items) {
  return h(
    'div',
    { class: 'menu-wrap' },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn menu-btn',
        title: t('moreActions'),
        'aria-label': t('moreActionsFor', name),
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
      icon('more'),
    ),
    h('div', { class: 'menu', role: 'menu', 'aria-label': t('moreActions'), tabindex: '-1', hidden: true }, items),
  );
}

/** dataset: { action } in a group card, { catAction } in a category head. checked: true/false makes it a switch. */
function menuItem(iconName, label, dataset, { disabled = false, title = null, extraClass = '', checked = null } = {}) {
  return h(
    'button',
    {
      type: 'button',
      role: checked === null ? 'menuitem' : 'menuitemcheckbox',
      'aria-checked': checked === null ? null : String(checked),
      class: `menu-item ${extraClass}`.trim(),
      tabindex: '-1', // ↓ ↑ move between the items, Tab leaves the menu
      title,
      disabled,
      dataset,
    },
    icon(iconName),
    label,
    checked !== null && h('span', { class: 'switch', 'aria-hidden': 'true' }, h('span', { class: 'track' })),
  );
}

const menuSep = () => h('div', { class: 'menu-sep', role: 'separator' });

function categoryHead(category, index) {
  const id = category.id;
  const button = (iconName, label, action) =>
    h(
      'button',
      { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, dataset: { catAction: action } },
      icon(iconName),
    );
  const only = draft.categories.length === 1;
  return h(
    'div',
    { class: 'cat-head' },
    toggleButton(!collapsed.has(id), category.name || t('unnamedCategory'), { catAction: 'toggle' }),
    h('span', { class: 'cat-icon', title: t('category'), 'aria-hidden': 'true' }, icon('folder')),
    h('input', {
      class: 'input cat-name',
      type: 'text',
      value: category.name,
      maxlength: '40',
      autocomplete: 'off',
      placeholder: t('categoryName'),
      'aria-label': t('categoryName'),
    }),
    h('span', { class: 'cat-count' }),
    h(
      'div',
      { class: 'cat-tools' },
      h(
        'label',
        { class: 'switch compact', title: t('categorySwitch') },
        h('input', { type: 'checkbox', class: 'cat-enabled' }),
        h('span', { class: 'track', 'aria-hidden': 'true' }),
        h('span', { class: 'switch-label' }),
      ),
      h('button', { type: 'button', class: 'btn small', dataset: { catAction: 'open' } }, icon('launch'), t('openAll')),
      h('span', { class: 'tools-sep', 'aria-hidden': 'true' }),
      button('foldAll', t('collapseCategoryGroups'), 'fold-cards'),
      // The rarer actions wait behind ⋮
      moreMenu(
        category.name || t('unnamedCategory'),
        menuItem('plus', t('addGroup'), { catAction: 'add' }),
        menuItem('up', t('moveCategoryUp'), { catAction: 'up' }, { disabled: index === 0 }),
        menuItem('down', t('moveCategoryDown'), { catAction: 'down' }, { disabled: index === draft.categories.length - 1 }),
        menuSep(),
        menuItem('launch', t('openAllCollapsed'), { catAction: 'open-collapsed' }, {
          checked: category.openCollapsed === true,
          title: t('openAllCollapsedHint'),
        }),
        menuSep(),
        menuItem('trash', t('deleteCategory'), { catAction: 'delete' }, {
          disabled: only,
          title: only ? t('lastCategory') : null,
          extraClass: 'danger',
        }),
      ),
    ),
  );
}

/** Count, on/off switch and “Open all” of a category head follow the groups. */
function updateCategoryHead(section) {
  const head = section.querySelector('.cat-head');
  if (!head) return;
  const groups = draft.groups.filter((g) => g.category === section.dataset.category);
  const active = groups.filter((g) => g.enabled).length;
  const toggle = head.querySelector('.cat-enabled');
  toggle.checked = groups.length > 0 && active === groups.length;
  toggle.indeterminate = active > 0 && active < groups.length;
  toggle.closest('.switch').hidden = !groups.length; // nothing to turn on or off
  head.querySelector('.switch-label').textContent = t(!active ? 'paused' : active === groups.length ? 'active' : 'mixed');
  head.querySelector('.cat-count').textContent = plural(groups.length, 'group');
  head.querySelector('[data-cat-action="open"]').disabled = !groups.some((g) => g.name.trim() && urlsToOpen(g).urls.length);
  // One button collapses all cards of the category – or, if all are collapsed, expands them
  const anyOpen = groups.some((g) => !collapsedCards.has(g.id));
  const label = t(anyOpen ? 'collapseCategoryGroups' : 'expandCategoryGroups');
  const foldCards = head.querySelector('[data-cat-action="fold-cards"]');
  foldCards.replaceChildren(icon(anyOpen ? 'foldAll' : 'unfoldAll'));
  foldCards.title = label;
  foldCards.setAttribute('aria-label', label);
  foldCards.disabled = !groups.length;
}

function preview(group) {
  return h(
    'div',
    { class: 'preview', dataset: { color: group.color }, 'aria-hidden': 'true' },
    chip(titleOf(group), group.color),
    h('span', { class: 'ghost-tab' }),
    h('span', { class: 'ghost-tab' }),
  );
}

function categoryField(group) {
  const id = group.id;
  return [
    h('label', { class: 'field-label', for: `category-${id}` }, t('category')),
    h(
      'div',
      { class: 'field category-field' },
      h(
        'select',
        { class: 'select category', id: `category-${id}` },
        draft.categories.map((c) => h('option', { value: c.id, selected: c.id === group.category }, c.name || t('unnamedCategory'))),
      ),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', class: 'show-category', checked: group.showCategory }),
        t('showCategory'),
      ),
    ),
  ];
}

function groupCard(group, { index, first, last }) {
  const id = group.id;
  const folded = collapsedCards.has(id);
  return h(
    'li',
    { class: `group-card${group.enabled ? '' : ' is-disabled'}${folded ? ' is-collapsed' : ''}`, dataset: { id } },
    h(
      'div',
      { class: 'card-head', draggable: 'true' },
      toggleButton(!folded, group.name || t('unnamed'), { action: 'fold' }),
      h('span', { class: 'drag-handle', title: t('dragToReorder') }, icon('grip')),
      h('span', { class: 'order', title: t('priority', index + 1) }, String(index + 1)),
      preview(group),
      h(
        'div',
        { class: 'card-tools' },
        h(
          'label',
          { class: 'switch compact' },
          h('input', { type: 'checkbox', class: 'enabled', checked: group.enabled }),
          h('span', { class: 'track', 'aria-hidden': 'true' }),
          h('span', { class: 'switch-label' }, t(group.enabled ? 'active' : 'paused')),
        ),
        h('span', { class: 'tools-sep', 'aria-hidden': 'true' }),
        moreMenu(
          group.name || t('unnamed'),
          menuItem('up', t('moveUp'), { action: 'up' }, { disabled: first }),
          menuItem('down', t('moveDown'), { action: 'down' }, { disabled: last }),
          menuSep(),
          menuItem('launch', t('openCollapsed'), { action: 'open-collapsed' }, {
            checked: group.openCollapsed === true,
            title: t('openCollapsedHint'),
          }),
          menuSep(),
          menuItem('trash', t('deleteGroup'), { action: 'delete' }, { extraClass: 'danger' }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card-body' },
      h('label', { class: 'field-label', for: `name-${id}` }, t('name')),
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
          placeholder: t('namePlaceholder'),
        }),
        h('div', { class: 'issues name-issues' }),
      ),
      categoryField(group),
      h('span', { class: 'field-label', id: `color-label-${id}` }, t('color')),
      h('div', { class: 'field' }, swatches(`color-${id}`, group.color)),
      h(
        'label',
        { class: 'field-label top', for: `patterns-${id}` },
        t('urlPatterns'),
        h('span', { class: 'field-hint' }, t('onePerLine')),
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
        t('pagesToOpen'),
        h('span', { class: 'field-hint' }, t('optional')),
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
          placeholder: t('openUrlsPlaceholder'),
          value: (group.openUrls ?? []).join('\n'),
        }),
        h(
          'div',
          { class: 'open-row' },
          h('p', { class: 'open-preview' }),
          h('button', { type: 'button', class: 'btn small', dataset: { action: 'open' } }, icon('launch'), t('openNow')),
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
      h('strong', {}, plural(urls.length, 'opensPages')),
      source === 'patterns' ? ` ${t('fromThePatterns')}: ` : ': ',
      urls.map(shortUrl).join(' · '),
    );
  } else {
    preview.replaceChildren(t('nothingToOpenHint'));
  }
  card.querySelector('[data-action="open"]').disabled = !urls.length;
}

/** Update errors/hints, test result and save bar */
function refresh() {
  validation = validateConfig(draft);
  for (const section of els.groups.querySelectorAll('.cat-section')) {
    updateCategoryHead(section);
    const error = validation.categoryErrors.get(section.dataset.category);
    section.querySelector('.cat-name')?.setAttribute('aria-invalid', String(!!error));
    section.querySelector('.cat-issues')?.replaceChildren(...(error ? [note('error', error)] : []));
  }
  for (const card of els.groups.querySelectorAll('.group-card')) {
    const item = validation.report.get(card.dataset.id);
    if (!item) continue;
    const group = findGroup(card.dataset.id);
    card.querySelector('.chip').replaceWith(chip(titleOf(group), group.color));
    card.classList.toggle('has-errors', !!(item.nameError || item.patternErrors.length || item.openErrors.length));
    const nameInput = card.querySelector('.name');
    const textarea = card.querySelector('.patterns');
    const openArea = card.querySelector('.open-urls');
    nameInput.setAttribute('aria-invalid', String(!!item.nameError));
    textarea.setAttribute('aria-invalid', String(item.patternErrors.length > 0));
    openArea.setAttribute('aria-invalid', String(item.openErrors.length > 0));
    card.querySelector('.name-issues').replaceChildren(
      ...(item.nameError ? [note('error', item.nameError)] : []),
      ...(item.titleWarning ? [note('warn', item.titleWarning)] : []),
    );
    card.querySelector('.pattern-issues').replaceChildren(
      ...item.patternErrors.map((e) => note('error', t('lineIssue', e.index + 1, e.line, e.message))),
      ...item.warnings.map((w) => note('warn', w)),
    );
    card.querySelector('.open-issues').replaceChildren(
      ...item.openErrors.map((e) => note('error', t('lineIssue', e.index + 1, e.line, e.message))),
    );
    renderOpenPreview(card, findGroup(card.dataset.id));
  }
  updateCollapseAll();
  renderTest();
  updateSavebar();
}

function updateSavebar() {
  const dirty = isDirty();
  els.savebar.classList.toggle('is-visible', dirty);
  els.savebar.setAttribute('aria-hidden', String(!dirty));
  els.savebar.inert = !dirty;
  els.savebarText.textContent = t(validation.ok ? 'unsavedChanges' : 'unsavedWithErrors');
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
    lines.push(note('error', t('testInvalidUrl')));
  } else if (result.match) {
    const { group, pattern } = result.match;
    lines.push(
      h(
        'div',
        { class: 'test-hit' },
        mutedParts(
          'testHit',
          [
            chip(titleOf(group), group.color),
            group.category && !group.showCategory
              ? h('span', { class: 'muted' }, `(${categoryName(draft.categories, group.category) || t('unnamedCategory')})`)
              : null,
          ],
          h('code', {}, pattern),
        ),
      ),
    );
  } else {
    lines.push(note('info', t('testNoMatch')));
  }
  for (const { group, pattern } of result.excluded) {
    lines.push(h('p', { class: 'test-aside' }, tParts('testSkipped', group.name || t('unnamed'), h('code', {}, pattern))));
  }
  for (const { group } of result.disabled) {
    lines.push(h('p', { class: 'test-aside' }, t('testPaused', group.name || t('unnamed'))));
  }
  els.testResult.replaceChildren(...lines);
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 360)}px`;
}

/* ---------- Editing ---------- */

els.groups.addEventListener('input', (event) => {
  if (event.target.matches('.cat-name')) {
    const id = event.target.closest('.cat-section').dataset.category;
    findCategory(id).name = event.target.value;
    for (const option of els.groups.querySelectorAll(`select.category option[value="${id}"]`)) {
      option.textContent = event.target.value.trim() || t('unnamedCategory');
    }
    refresh();
    return;
  }
  const card = event.target.closest('.group-card');
  const group = card && findGroup(card.dataset.id);
  if (!group) return;

  if (event.target.matches('.name')) {
    group.name = event.target.value;
  } else if (event.target.matches('.patterns')) {
    group.patterns = event.target.value.split('\n');
    autoGrow(event.target);
  } else if (event.target.matches('.open-urls')) {
    group.openUrls = event.target.value.split('\n');
    autoGrow(event.target);
  }
  refresh();
});

const cardOf = (id) => els.groups.querySelector(`.group-card[data-id="${id}"]`);
const sectionOf = (id) => [...els.groups.querySelectorAll('.cat-section')].find((s) => s.dataset.category === id);

/* ---------- Collapsing (categories and group cards) ---------- */

/** Shows a category section or a group card collapsed or expanded. */
function setFolded(element, folded) {
  element.classList.toggle('is-collapsed', folded);
  const button = element.querySelector(':scope > .cat-head > .fold, :scope > .card-head > .fold');
  if (button) {
    button.setAttribute('aria-expanded', String(!folded));
    button.title = t(folded ? 'expand' : 'collapse');
    button.setAttribute('aria-label', t(folded ? 'expandNamed' : 'collapseNamed', button.dataset.name));
  }
  // Textareas that were hidden have no height yet
  if (!folded) element.querySelectorAll('textarea').forEach((t) => t.offsetParent && autoGrow(t));
}

/** Briefly highlights a category – e.g. when groups were moved into it while it's collapsed. */
function flash(section) {
  if (!section) return;
  section.classList.remove('is-flashing');
  void section.offsetWidth; // restart the animation
  section.classList.add('is-flashing');
  section.addEventListener('animationend', () => section.classList.remove('is-flashing'), { once: true });
}

function expandCategory(id) {
  if (!collapsed.delete(id)) return;
  storeCollapsed();
  const section = sectionOf(id);
  if (section) setFolded(section, false);
  updateCollapseAll();
}

function expandCard(id) {
  if (!collapsedCards.delete(id)) return;
  storeCollapsedCards();
  const card = cardOf(id);
  if (!card) return;
  setFolded(card, false);
  updateCategoryHead(card.closest('.cat-section'));
}

/** The button above the list: collapses all categories – or, if all are collapsed, expands them. */
function updateCollapseAll() {
  const anyOpen = draft.categories.some((c) => !collapsed.has(c.id));
  els.collapseAll.replaceChildren(icon('chevron'), t(anyOpen ? 'collapseAll' : 'expandAll'));
  els.collapseAll.classList.toggle('is-folded', !anyOpen);
  els.collapseAll.setAttribute('aria-label', t(anyOpen ? 'collapseAllCategories' : 'expandAllCategories'));
}

els.collapseAll.addEventListener('click', () => {
  const fold = draft.categories.some((c) => !collapsed.has(c.id));
  for (const c of draft.categories) {
    if (fold) collapsed.add(c.id);
    else collapsed.delete(c.id);
  }
  storeCollapsed();
  for (const section of els.groups.querySelectorAll('.cat-section')) setFolded(section, fold);
  updateCollapseAll();
});

els.groups.addEventListener('change', (event) => {
  if (event.target.matches('.cat-enabled')) {
    const id = event.target.closest('.cat-section').dataset.category;
    for (const g of draft.groups) if (g.category === id) g.enabled = event.target.checked;
    renderGroups();
    refresh();
    sectionOf(id)?.querySelector('.cat-enabled').focus();
    return;
  }
  const card = event.target.closest('.group-card');
  const group = card && findGroup(card.dataset.id);
  if (!group) return;

  if (event.target.matches('input[type="radio"]')) {
    group.color = event.target.value;
    card.querySelector('.preview').dataset.color = group.color;
  } else if (event.target.matches('.enabled')) {
    group.enabled = event.target.checked;
    card.classList.toggle('is-disabled', !group.enabled);
    card.querySelector('.switch-label').textContent = t(group.enabled ? 'active' : 'paused');
  } else if (event.target.matches('.show-category')) {
    group.showCategory = event.target.checked;
  } else if (event.target.matches('select.category')) {
    // Into the other category – at its end
    group.category = event.target.value;
    draft.groups.splice(draft.groups.indexOf(group), 1);
    draft.groups.push(group);
    resort();
    expandCategory(group.category);
    renderGroups();
    refresh();
    const moved = cardOf(group.id);
    moved.querySelector('select.category').focus({ preventScroll: true });
    moved.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  refresh();
});

/* ---------- Menu behind ⋮ (category head and group card) ---------- */

/** The ⋮ button whose menu is open – only one at a time. */
let menuOwner = null;

const menuItems = (menu) => [...menu.querySelectorAll('.menu-item:not(:disabled)')];

function openMenu(button, focusLast = false) {
  closeMenu();
  const menu = button.nextElementSibling;
  menu.hidden = false;
  menu.classList.remove('opens-up');
  button.setAttribute('aria-expanded', 'true');
  menuOwner = button;
  // Upwards if it doesn't fit below – at the bottom of the window, or behind the save bar
  const bar = els.savebar.classList.contains('is-visible') && els.savebar.querySelector('.savebar-inner');
  const limit = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  menu.classList.toggle('opens-up', menu.getBoundingClientRect().bottom > limit);
  const items = menuItems(menu);
  (focusLast ? items.at(-1) : items[0]).focus();
}

function closeMenu(returnFocus = false) {
  const button = menuOwner;
  if (!button) return;
  menuOwner = null;
  button.nextElementSibling.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (returnFocus) button.focus();
}

// A click elsewhere closes it: the focus leaves the menu
els.groups.addEventListener('focusout', (event) => {
  if (menuOwner && !menuOwner.parentElement.contains(event.relatedTarget)) closeMenu();
});

// Keyboard as in a native menu: ↓ ↑ open it and move between the items, Esc and Tab close it
els.groups.addEventListener('keydown', (event) => {
  const { key, target } = event;
  if (menuOwner && key === 'Tab') {
    closeMenu(true); // Tab then moves on from ⋮
    return;
  }
  if (menuOwner && key === 'Escape') {
    closeMenu(true);
  } else if (target.matches('.menu-btn') && (key === 'ArrowDown' || key === 'ArrowUp')) {
    openMenu(target, key === 'ArrowUp');
  } else if (target.closest('.menu')) {
    const items = menuItems(target.closest('.menu'));
    const at = items.indexOf(target); // -1: the menu itself has the focus (clicked between the items)
    const next = { ArrowDown: items[(at + 1) % items.length], ArrowUp: items.at(Math.max(at, 0) - 1), Home: items[0], End: items.at(-1) }[key];
    if (!next) return;
    next.focus();
  } else {
    return;
  }
  event.preventDefault();
});

els.groups.addEventListener('click', (event) => {
  const menuButton = event.target.closest('.menu-btn');
  if (menuButton) {
    if (menuOwner === menuButton) closeMenu();
    else openMenu(menuButton);
    return;
  }
  if (event.target.closest('[role="menuitem"]')) closeMenu(true); // the chosen action follows – a switch keeps the menu open
  const catButton = event.target.closest('button[data-cat-action]');
  if (catButton) {
    categoryAction(catButton);
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.group-card');
  const index = draft.groups.findIndex((g) => g.id === card.dataset.id);
  if (index === -1) return;
  const action = button.dataset.action;

  if (action === 'fold') {
    const folded = !collapsedCards.has(card.dataset.id);
    if (folded) collapsedCards.add(card.dataset.id);
    else collapsedCards.delete(card.dataset.id);
    storeCollapsedCards();
    setFolded(card, folded);
    updateCategoryHead(card.closest('.cat-section'));
    return;
  }

  if (action === 'open-collapsed') {
    const group = draft.groups[index];
    group.openCollapsed = !group.openCollapsed;
    button.setAttribute('aria-checked', String(group.openCollapsed));
    refresh();
    return;
  }

  if (action === 'up' || action === 'down') {
    // Within the category – the neighbour in the same section
    const group = draft.groups[index];
    const target = action === 'up' ? index - 1 : index + 1;
    if (draft.groups[target]?.category !== group.category) return;
    [draft.groups[index], draft.groups[target]] = [draft.groups[target], draft.groups[index]];
    renderGroups();
    refresh();
    const moved = cardOf(group.id);
    moved.querySelector('.card-head .menu-btn').focus(); // the menu is closed – back to its ⋮
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
    const cards = els.groups.querySelectorAll('.group-card');
    const next = cards[Math.min(index, cards.length - 1)];
    (next?.querySelector('.name') ?? els.addGroup).focus();
    toast(t('groupRemoved', removed.name || t('unnamed')));
  }
});

function categoryAction(button) {
  const section = button.closest('.cat-section');
  const id = section.dataset.category;
  const index = draft.categories.findIndex((c) => c.id === id);
  const action = button.dataset.catAction;

  if (action === 'toggle') {
    const folded = !collapsed.has(id);
    if (folded) collapsed.add(id);
    else collapsed.delete(id);
    storeCollapsed();
    setFolded(section, folded);
    updateCollapseAll();
    return;
  }

  if (action === 'open') {
    openCategoryNow(id, button);
    return;
  }

  if (action === 'add') {
    addGroup(id);
    return;
  }

  if (action === 'open-collapsed') {
    const category = draft.categories[index];
    category.openCollapsed = !category.openCollapsed;
    button.setAttribute('aria-checked', String(category.openCollapsed));
    refresh();
    return;
  }

  if (action === 'fold-cards') {
    const ids = draft.groups.filter((g) => g.category === id).map((g) => g.id);
    const fold = ids.some((groupId) => !collapsedCards.has(groupId));
    for (const groupId of ids) {
      if (fold) collapsedCards.add(groupId);
      else collapsedCards.delete(groupId);
    }
    storeCollapsedCards();
    if (!fold) expandCategory(id); // expanding the groups also shows a collapsed category
    for (const card of section.querySelectorAll('.group-card')) setFolded(card, fold);
    updateCategoryHead(section);
    return;
  }

  if (action === 'up' || action === 'down') {
    const target = action === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= draft.categories.length) return;
    [draft.categories[index], draft.categories[target]] = [draft.categories[target], draft.categories[index]];
    resort();
    renderGroups();
    refresh();
    sectionOf(id).querySelector('.cat-head .menu-btn').focus(); // the menu is closed – back to its ⋮
    sectionOf(id).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }

  if (action === 'delete') {
    // Every group needs a category: its groups join the neighbouring category.
    // Above → at its end, below → at its start – so the order stays the same.
    if (draft.categories.length === 1) return;
    const target = draft.categories[index - 1] ?? draft.categories[index + 1];
    const [removed] = draft.categories.splice(index, 1);
    const moved = draft.groups.filter((g) => g.category === id);
    for (const g of moved) g.category = target.id;
    resort();
    collapsed.delete(id);
    storeCollapsed();
    renderGroups();
    refresh();
    // A collapsed target stays collapsed – it's only highlighted briefly
    sectionOf(target.id).querySelector('.fold').focus();
    if (moved.length) flash(sectionOf(target.id));
    const removedName = removed.name || t('unnamed');
    toast(
      moved.length
        ? plural(moved.length, 'categoryRemovedMoved', removedName, target.name || t('unnamedCategory'))
        : t('categoryRemoved', removedName),
    );
  }
}

/* ---------- Drag and drop (the card head is the handle) ---------- */

let dragged = null; // card being dragged
let dropped = false; // released on the page (not cancelled with Esc)

els.groups.addEventListener('dragstart', (event) => {
  const head = event.target.closest?.('.card-head');
  if (!head) return; // e.g. text dragged out of an input
  dragged = head.closest('.group-card');
  dropped = false;
  event.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => dragged?.classList.add('is-dragging')); // after the drag image was taken
});

// The card moves along while dragging: before/after the card under the pointer, depending on its half.
// Over a category head or an empty category it goes into that category.
document.addEventListener('dragover', (event) => {
  if (!dragged) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const over = event.target.closest?.('.group-card, .cat-head, .cat-empty');
  if (!over || over === dragged) return;
  if (!over.matches('.group-card')) {
    const list = over.closest('.cat-section').querySelector('.groups');
    if (list.firstElementChild !== dragged) list.prepend(dragged);
    return;
  }
  const { top, height } = over.getBoundingClientRect();
  if (event.clientY > top + height / 2) {
    if (over.nextElementSibling !== dragged) over.after(dragged);
  } else if (over.previousElementSibling !== dragged) {
    over.before(dragged);
  }
});

document.addEventListener('drop', (event) => {
  if (!dragged) return;
  event.preventDefault();
  dropped = true;
});

els.groups.addEventListener('dragend', () => {
  if (!dragged) return;
  const { id } = dragged.dataset;
  dragged = null;
  if (dropped) {
    const cards = [...els.groups.querySelectorAll('.group-card')];
    for (const card of cards) findGroup(card.dataset.id).category = card.closest('.cat-section').dataset.category;
    const order = cards.map((card) => card.dataset.id);
    draft.groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    resort();
  }
  renderGroups(); // cancelled (Esc) → back to the previous order
  refresh();
  const card = cardOf(id);
  if (card?.offsetParent) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else if (dropped) flash(card?.closest('.cat-section')); // dropped onto a collapsed category – it stays collapsed
});

/** New, empty group at the end of a category. */
function addGroup(categoryId) {
  const group = normalizeGroup({
    id: newId(),
    name: '',
    color: nextFreeColor(draft.groups),
    patterns: [],
    category: categoryId,
  });
  draft.groups.push(group);
  resort();
  collapsed.delete(categoryId);
  storeCollapsed();
  renderGroups();
  refresh();
  const card = cardOf(group.id);
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.querySelector('.name').focus({ preventScroll: true });
}

els.addGroup.append(icon('plus'), t('addGroup'));
els.addGroup.addEventListener('click', () => addGroup(draft.categories.at(-1).id)); // at the bottom, next to the button

els.addCategory.append(icon('folder'), t('addCategory'));
els.addCategory.addEventListener('click', () => {
  const category = { id: newId(), name: '', openCollapsed: false };
  draft.categories.push(category);
  renderGroups();
  refresh();
  const section = sectionOf(category.id);
  section.scrollIntoView({ block: 'center', behavior: 'smooth' });
  section.querySelector('.cat-name').focus({ preventScroll: true });
});

els.setEnabled.addEventListener('change', () => {
  draft.settings.enabled = els.setEnabled.checked;
  refresh();
});
els.setUngroup.addEventListener('change', () => {
  draft.settings.ungroupOnLeave = els.setUngroup.checked;
  refresh();
});
els.setListOrder.addEventListener('change', () => {
  draft.settings.openInListOrder = els.setListOrder.checked;
  refresh();
});

els.testUrl.addEventListener('input', renderTest);

/* ---------- Save / discard ---------- */

async function save() {
  refresh();
  if (!validation.ok) {
    toast(t('fixErrorsFirst'), 'error');
    const invalid = els.groups.querySelector('[aria-invalid="true"]');
    if (invalid) {
      expandCategory(invalid.closest('.cat-section').dataset.category);
      const card = invalid.closest('.group-card');
      if (card) expandCard(card.dataset.id);
    }
    invalid?.focus();
    return false;
  }
  saving = true;
  els.save.disabled = true;
  try {
    saved = await saveConfig(draft);
    toast(t('saved'));
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
  toast(t('changesDiscarded'));
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
    if (!result?.ok) throw new Error(result?.error ?? t('unknownError'));
    const parts = [result.opened ? plural(result.opened, 'pagesOpened') : t('allAlreadyOpen')];
    if (result.failed?.length) parts.push(t('couldNotOpen', result.failed.map(shortUrl).join(', ')));
    toast(t('openResult', result.name, parts.join(' – ')), result.failed?.length ? 'error' : 'ok');
  } catch (err) {
    toast(t('openingFailed', err.message), 'error');
  } finally {
    button.disabled = false;
    refresh();
  }
}

async function openCategoryNow(categoryId, button) {
  if (isDirty() && !(await save())) return;
  button.disabled = true;
  try {
    const win = await chrome.windows.getCurrent();
    const result = await chrome.runtime.sendMessage({ type: 'openCategory', categoryId, windowId: win.id });
    if (!result?.ok) throw new Error(result?.error ?? t('unknownError'));
    const parts = [
      plural(result.groups, 'group'),
      result.opened ? plural(result.opened, 'pagesOpened') : t('allAlreadyOpen'),
    ];
    if (result.failed?.length) parts.push(t('couldNotOpen', result.failed.map(shortUrl).join(', ')));
    toast(t('openResult', result.name, parts.join(' – ')), result.failed?.length ? 'error' : 'ok');
  } catch (err) {
    toast(t('openingFailed', err.message), 'error');
  } finally {
    button.disabled = false;
    refresh();
  }
}

/* ---------- Sort all tabs ---------- */

els.sortAll.append(icon('sort'), t('sortAllNow'));
els.sortAll.addEventListener('click', async () => {
  if (isDirty() && !(await save())) return;
  els.sortAll.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'sortAll' });
    if (!result?.ok) throw new Error(result?.error ?? t('unknownError'));
    const parts = [];
    if (result.moved) parts.push(plural(result.moved, 'tabsSorted'));
    if (result.ungrouped) parts.push(plural(result.ungrouped, 'tabsUngrouped'));
    toast(parts.length ? parts.join(', ') : t('alreadySorted'));
  } catch (err) {
    toast(t('sortingFailed', err.message), 'error');
  } finally {
    els.sortAll.disabled = false;
  }
});

/* ---------- Export / Import ---------- */

els.exportBtn.append(icon('download'), t('export'));
els.exportBtn.addEventListener('click', () => {
  const data = JSON.stringify(toExport(normalized(draft)), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const now = new Date(); // local date, e.g. 260930_tab-groups.json
  const date = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('');
  h('a', { href: url, download: `${date}_tab-groups.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/** Asks whether the import adds to or replaces the current groups: 'add' | 'replace' | '' (cancelled). */
function askImportMode(imported) {
  els.importSummary.textContent = t('importSummary', plural(imported.groups.length, 'group'), plural(draft.groups.length, 'group'));
  return ask(els.importDialog);
}

els.importBtn.append(icon('upload'), t('importButton'));
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    const imported = fromImport(await file.text());
    const mode = draft.groups.length ? await askImportMode(imported) : 'replace';
    if (mode === 'replace') {
      draft = imported;
      renderAll();
      toast(t('importLoaded'));
    } else if (mode === 'add') {
      const { config, added, skipped } = mergeImport(draft, imported);
      const skippedText = skipped.length ? plural(skipped.length, 'groupsSkipped') : '';
      if (!added.length) {
        toast(t('nothingAdded', skippedText || t('fileHasNoGroups')), 'error');
        return;
      }
      draft = config;
      renderAll();
      const parts = [plural(added.length, 'groupsAdded'), skippedText].filter(Boolean);
      toast(t('importAdded', parts.join(', ')));
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ---------- Reset ---------- */

/** Resolves with the value of the button that closed the dialog ('' = Esc). */
function ask(dialog) {
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
  });
}

els.resetBtn.append(icon('trash'), t('resetButton'));
els.resetBtn.addEventListener('click', async () => {
  if ((await ask(els.resetDialog)) !== 'reset') return;
  // As right after installing: only “Default”, no groups, default options – takes effect with “Save”
  draft = normalizeConfig({ settings: {}, groups: [] });
  collapsed.clear();
  collapsedCards.clear();
  storeCollapsed();
  storeCollapsedCards();
  renderAll();
  toast(t('resetDone'));
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
  // Forget the collapsed state of categories/groups that no longer exist
  for (const id of collapsed) if (!saved.categories.some((c) => c.id === id)) collapsed.delete(id);
  for (const id of collapsedCards) if (!saved.groups.some((g) => g.id === id)) collapsedCards.delete(id);
  storeCollapsed();
  storeCollapsedCards();
  renderAll();
}

init().catch((err) => toast(t('loadFailed', err.message), 'error'));
