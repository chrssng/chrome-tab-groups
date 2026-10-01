/**
 * Loading, saving and validating the configuration.
 *
 * Stored in chrome.storage.sync (so it follows your Chrome account):
 *   settings        → { enabled, ungroupOnLeave, openInListOrder, order: [ids],
 *                       categories: [{ id, name, openCollapsed }] }
 *   group:<id>      → { name, color, patterns: [...], openUrls: [...], enabled,
 *                       category, showCategory, openCollapsed }
 * Each group lives in its own entry because Chrome sync only allows
 * 8 KB per entry.
 *
 * Categories are sections of the list, and every group belongs to one. There
 * is always at least one category – without any, there is “Default”. The
 * groups are always ordered section by section, because the order decides
 * which group wins.
 */
import { COLOR_IDS, isValidColor } from './colors.js';
import { t } from './i18n.js';
import { compileGroups, findMatch, sampleUrl, toOpenUrl } from './patterns.js';

export const SETTINGS_KEY = 'settings';
export const GROUP_PREFIX = 'group:';
/**
 * Fixed ID, so every part of the extension means the same “Default” before it
 * is ever saved. Its name is in the language of the browser (“Standard” in German).
 */
export const DEFAULT_CATEGORY = Object.freeze({ id: 'default', name: t('defaultCategory'), openCollapsed: false });
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, ungroupOnLeave: false, openInListOrder: false });

const storage = () => chrome.storage.sync;

export function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Names are unique regardless of case and surrounding spaces. */
const nameKey = (name) => String(name ?? '').trim().toLocaleLowerCase('en');

/** Group names only have to be unique within their category. */
const scopedNameKey = (group) => `${group.category ?? ''}\u0000${nameKey(group.name)}`;

const cleanLines = (lines) => (Array.isArray(lines) ? lines.map((l) => String(l).trim()).filter(Boolean) : []);

export function normalizeGroup(input = {}) {
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    name: String(input.name ?? '').trim(),
    color: isValidColor(input.color) ? input.color : COLOR_IDS[1],
    patterns: cleanLines(input.patterns),
    openUrls: cleanLines(input.openUrls), // "Pages to open" – empty = URLs from the patterns
    enabled: input.enabled !== false,
    category: typeof input.category === 'string' ? input.category : '', // "" → assigned by normalizeConfig
    showCategory: input.showCategory === true, // tab strip title "Category · Name"
    openCollapsed: input.openCollapsed === true, // opened on its own ("Open now", popup): tab group collapsed
  };
}

function normalizeSettings(input = {}) {
  return {
    enabled: input?.enabled !== false,
    ungroupOnLeave: input?.ungroupOnLeave === true,
    openInListOrder: input?.openInListOrder === true,
  };
}

/**
 * [{ id, name, openCollapsed }] – never empty: without categories there is “Default”.
 * openCollapsed: “Open all” creates the category's tab groups collapsed.
 * An entry with the ID "" (an earlier format for “no category”) becomes
 * “Default” at its position.
 */
export function normalizeCategories(list) {
  const categories = [];
  const seen = new Set();
  let legacyAt = -1;
  for (const entry of Array.isArray(list) ? list : []) {
    const id = typeof entry?.id === 'string' ? entry.id : null;
    if (id === '') {
      if (legacyAt === -1) legacyAt = categories.length;
      continue;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    categories.push({ id, name: String(entry.name ?? '').trim(), openCollapsed: entry.openCollapsed === true });
  }
  if (legacyAt !== -1 && !seen.has(DEFAULT_CATEGORY.id)) categories.splice(legacyAt, 0, { ...DEFAULT_CATEGORY });
  if (!categories.length) categories.push({ ...DEFAULT_CATEGORY });
  return categories;
}

export function categoryName(categories, id) {
  return (categories ?? []).find((c) => c.id === id)?.name ?? '';
}

/** Orders the groups section by section (stable within a section). */
export function sortBySection(groups, categories) {
  const rank = new Map(categories.map((c, i) => [c.id, i]));
  const rankOf = (g) => rank.get(g.category) ?? categories.length;
  return [...groups].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * Brings a configuration into shape: every group in a known category (if
 * not: “Default” – or else the first category), groups ordered by section.
 */
export function normalizeConfig(config) {
  const categories = normalizeCategories(config.categories);
  const known = new Set(categories.map((c) => c.id));
  const fallback = known.has(DEFAULT_CATEGORY.id) ? DEFAULT_CATEGORY.id : categories[0].id;
  const groups = (config.groups ?? []).map((input) => {
    const group = normalizeGroup(input);
    if (!known.has(group.category)) group.category = fallback;
    return group;
  });
  return { settings: normalizeSettings(config.settings), categories, groups: sortBySection(groups, categories) };
}

/** Builds the configuration from the raw storage entries. */
export function configFromItems(all) {
  const stored = all[SETTINGS_KEY] ?? {};
  const byId = new Map();
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(GROUP_PREFIX) || !value) continue;
    const id = key.slice(GROUP_PREFIX.length);
    byId.set(id, { ...value, id });
  }
  const groups = [];
  for (const id of Array.isArray(stored.order) ? stored.order : []) {
    if (byId.has(id)) {
      groups.push(byId.get(id));
      byId.delete(id);
    }
  }
  groups.push(...byId.values()); // entries without a position (e.g. after a sync conflict) go to the end
  return normalizeConfig({ settings: stored, categories: stored.categories, groups });
}

export async function loadConfig() {
  return configFromItems(await storage().get(null));
}

export async function saveConfig(config) {
  const existing = await storage().get(null);
  // Without categories (e.g. an older caller), the stored ones stay
  const { settings, categories, groups } = normalizeConfig({
    ...config,
    categories: config.categories ?? existing[SETTINGS_KEY]?.categories,
  });
  const items = {
    [SETTINGS_KEY]: { ...settings, order: groups.map((g) => g.id), categories },
  };
  for (const g of groups) {
    items[GROUP_PREFIX + g.id] = {
      name: g.name,
      color: g.color,
      patterns: g.patterns,
      openUrls: g.openUrls,
      enabled: g.enabled,
      category: g.category,
      showCategory: g.showCategory,
      openCollapsed: g.openCollapsed,
    };
  }
  const stale = Object.keys(existing).filter((key) => key.startsWith(GROUP_PREFIX) && !(key in items));
  try {
    await storage().set(items);
    if (stale.length) await storage().remove(stale);
  } catch (err) {
    throw new Error(explainStorageError(err));
  }
  return { settings, categories, groups };
}

/** Change only the settings (e.g. the on/off switch in the popup). */
export async function saveSettings(patch) {
  const { [SETTINGS_KEY]: stored = {} } = await storage().get(SETTINGS_KEY);
  await storage().set({ [SETTINGS_KEY]: { ...stored, ...patch } });
}

function explainStorageError(err) {
  const message = String(err?.message ?? err);
  if (/QUOTA_BYTES_PER_ITEM/i.test(message)) {
    return t('errTooManyPatterns');
  }
  if (/QUOTA_BYTES/i.test(message)) {
    return t('errSettingsTooLarge');
  }
  if (/MAX_WRITE_OPERATIONS/i.test(message)) {
    return t('errTooManySaves');
  }
  return t('errSaveFailed', message);
}

/* ---------- Titles in the tab strip ---------- */

/** "Name" – or "Category · Name" if the group shows its category. */
export function groupTitle(group, categories) {
  const category = group.showCategory && group.category ? categoryName(categories, group.category) : '';
  return category ? `${category} · ${group.name}` : group.name;
}

/**
 * Which configured group does an open Chrome tab group belong to? By its
 * title – if several groups have that title (same name in different
 * categories), the remembered owner decides, otherwise the color.
 */
export function ownerOf(chromeGroup, config, ownerId) {
  const title = chromeGroup.title ?? '';
  const same = config.groups.filter((g) => g.name && groupTitle(g, config.categories) === title);
  if (same.length <= 1) return same[0] ?? null;
  return same.find((g) => g.id === ownerId) ?? same.find((g) => g.color === chromeGroup.color) ?? null;
}

/* ---------- Export / Import ---------- */

export const EXPORT_FORMAT = 'tab-groups-by-url';

export function toExport(config) {
  const { settings, categories, groups } = normalizeConfig(config);
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    categories: categories.map((c) => ({ name: c.name, openCollapsed: c.openCollapsed })),
    groups: groups.map((g) => ({
      name: g.name,
      category: categoryName(categories, g.category),
      showCategory: g.showCategory,
      color: g.color,
      patterns: g.patterns,
      openUrls: g.openUrls,
      enabled: g.enabled,
      openCollapsed: g.openCollapsed,
    })),
  };
}

/**
 * Reads an exported file. Categories are referenced by name there; groups
 * without a category (older files) go to “Default”. The list of categories
 * holds { name, openCollapsed } – or just the names (older files).
 */
export function fromImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('errImportJson'));
  }
  const list = Array.isArray(data) ? data : data?.groups;
  if (!Array.isArray(list)) throw new Error(t('errImportNoGroups'));

  const categories = [];
  const categoryFor = (name) => {
    const clean = (typeof name === 'string' ? name.trim() : '') || DEFAULT_CATEGORY.name;
    let category = categories.find((c) => nameKey(c.name) === nameKey(clean));
    if (!category) {
      category = { id: newId(), name: clean };
      categories.push(category);
    }
    return category;
  };
  // An empty entry (earlier format for “no category”) is where “Default” goes
  for (const entry of Array.isArray(data?.categories) ? data.categories : []) {
    const category = categoryFor(typeof entry === 'string' ? entry : entry?.name);
    if (entry?.openCollapsed === true) category.openCollapsed = true;
  }
  const groups = list.map((g) => normalizeGroup({ ...g, id: undefined, category: categoryFor(g?.category).id }));
  return normalizeConfig({ settings: data?.settings, categories, groups });
}

/**
 * Import in "add" mode: the imported groups are added to the current ones,
 * the current settings stay. Categories with the same name are merged (and
 * keep their own options), new ones go to the end. Groups whose name already
 * exists in their category are skipped – otherwise saving would be blocked by
 * the duplicate name.
 */
export function mergeImport(current, imported) {
  const base = normalizeConfig(current);
  const categories = base.categories.map((c) => ({ ...c }));
  const mapped = new Map();
  for (const c of normalizeCategories(imported.categories)) {
    const same = categories.find((x) => nameKey(x.name) === nameKey(c.name));
    if (same) {
      mapped.set(c.id, same.id);
      continue;
    }
    const id = categories.some((x) => x.id === c.id) ? newId() : c.id; // never take over an existing ID
    categories.push({ ...c, id });
    mapped.set(c.id, id);
  }

  const taken = new Set(base.groups.map(scopedNameKey));
  const added = [];
  const skipped = [];
  for (const group of imported.groups) {
    const moved = { ...group, category: mapped.get(group.category) ?? categories[0].id };
    const key = scopedNameKey(moved);
    if (nameKey(moved.name) && taken.has(key)) {
      skipped.push(moved);
      continue;
    }
    if (nameKey(moved.name)) taken.add(key);
    added.push(moved);
  }
  return {
    config: normalizeConfig({ settings: { ...base.settings }, categories, groups: [...base.groups, ...added] }),
    added,
    skipped,
  };
}

/* ---------- Validation ---------- */

/**
 * Validates the configuration.
 *  - errors:   block saving (missing/duplicate name of a group or category,
 *              broken pattern, line under "Pages to open" that is not a
 *              concrete URL)
 *  - warnings: hints (no patterns, pattern shadowed by a group further up,
 *              same title in the tab strip as a group of another category)
 */
export function validateConfig(config) {
  const categories = normalizeCategories(config.categories);
  const compiled = compileGroups(config.groups);
  const report = new Map();
  const categoryErrors = new Map();
  let ok = true;

  const seenCategories = new Set();
  for (const c of categories) {
    const key = nameKey(c.name);
    const error = !key
      ? t('valCategoryName')
      : seenCategories.has(key)
        ? t('valCategoryExists', c.name.trim())
        : null;
    seenCategories.add(key);
    if (error) {
      categoryErrors.set(c.id, error);
      ok = false;
    }
  }

  // Groups that end up with the same title in the tab strip
  const byTitle = new Map();
  for (const g of config.groups) {
    if (!nameKey(g.name)) continue;
    const title = groupTitle(g, categories);
    byTitle.set(title, [...(byTitle.get(title) ?? []), g]);
  }

  const seenNames = new Set();
  compiled.forEach((entry, index) => {
    const { group } = entry;
    const item = { nameError: null, titleWarning: null, patternErrors: entry.errors, openErrors: [], warnings: [] };
    report.set(group.id, item);

    (group.openUrls ?? []).forEach((line, lineIndex) => {
      try {
        toOpenUrl(line);
      } catch (err) {
        item.openErrors.push({ index: lineIndex, line, message: err.message });
      }
    });

    const key = nameKey(group.name);
    if (!key) {
      item.nameError = t('valGroupName');
    } else if (seenNames.has(scopedNameKey(group))) {
      item.nameError = t('valGroupExists', group.name.trim());
    } else {
      seenNames.add(scopedNameKey(group));
    }
    if (item.nameError || item.patternErrors.length || item.openErrors.length) ok = false;

    const twins = key ? (byTitle.get(groupTitle(group, categories)) ?? []).filter((g) => g !== group) : [];
    if (twins.length && !item.nameError) {
      const where = twins.map((g) => t('quoted', categoryName(categories, g.category) || t('unnamedCategory'))).join(', ');
      item.titleWarning = `${t('valTitleTwin', group.name.trim(), where)} ${
        twins.some((g) => g.color === group.color) ? t('valTitleTwinSameColor') : t('valTitleTwinByColor')
      }`;
    }

    const hasOpenUrls = (group.openUrls ?? []).some((l) => String(l).trim() && !String(l).trim().startsWith('#'));
    if (!entry.include.length) {
      if (!hasOpenUrls) item.warnings.push(t('valNoPatterns'));
    } else if (group.enabled !== false) {
      const above = compiled.slice(0, index);
      for (const pattern of entry.include) {
        const sample = sampleUrl(pattern.raw);
        const hit = sample && findMatch(above, sample);
        if (hit) {
          item.warnings.push(t('valShadowed', pattern.raw, hit.group.name || t('unnamed')));
        }
      }
    }
  });

  return { ok, report, categoryErrors };
}
