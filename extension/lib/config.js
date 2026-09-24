/**
 * Loading, saving and validating the configuration.
 *
 * Stored in chrome.storage.sync (so it follows your Chrome account):
 *   settings        → { enabled, ungroupOnLeave, order: [ids] }
 *   group:<id>      → { name, color, patterns: [...], openUrls: [...], enabled }
 * Each group lives in its own entry because Chrome sync only allows
 * 8 KB per entry.
 */
import { COLOR_IDS, isValidColor } from './colors.js';
import { compileGroups, findMatch, sampleUrl, toOpenUrl } from './patterns.js';

export const SETTINGS_KEY = 'settings';
export const GROUP_PREFIX = 'group:';
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, ungroupOnLeave: false });

const storage = () => chrome.storage.sync;

export function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

const cleanLines = (lines) => (Array.isArray(lines) ? lines.map((l) => String(l).trim()).filter(Boolean) : []);

export function normalizeGroup(input = {}) {
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    name: String(input.name ?? '').trim(),
    color: isValidColor(input.color) ? input.color : COLOR_IDS[1],
    patterns: cleanLines(input.patterns),
    openUrls: cleanLines(input.openUrls), // "Pages to open" – empty = URLs from the patterns
    enabled: input.enabled !== false,
  };
}

function normalizeSettings(input = {}) {
  return {
    enabled: input.enabled !== false,
    ungroupOnLeave: input.ungroupOnLeave === true,
  };
}

export async function loadConfig() {
  const all = await storage().get(null);
  const stored = all[SETTINGS_KEY] ?? {};
  const byId = new Map();
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(GROUP_PREFIX) || !value) continue;
    const id = key.slice(GROUP_PREFIX.length);
    byId.set(id, normalizeGroup({ ...value, id }));
  }
  const groups = [];
  for (const id of Array.isArray(stored.order) ? stored.order : []) {
    if (byId.has(id)) {
      groups.push(byId.get(id));
      byId.delete(id);
    }
  }
  groups.push(...byId.values()); // entries without a position (e.g. after a sync conflict) go to the end
  return { settings: normalizeSettings(stored), groups };
}

export async function saveConfig(config) {
  const groups = config.groups.map(normalizeGroup);
  const items = {
    [SETTINGS_KEY]: { ...normalizeSettings(config.settings), order: groups.map((g) => g.id) },
  };
  for (const g of groups) {
    items[GROUP_PREFIX + g.id] = {
      name: g.name,
      color: g.color,
      patterns: g.patterns,
      openUrls: g.openUrls,
      enabled: g.enabled,
    };
  }
  const existing = await storage().get(null);
  const stale = Object.keys(existing).filter((key) => key.startsWith(GROUP_PREFIX) && !(key in items));
  try {
    await storage().set(items);
    if (stale.length) await storage().remove(stale);
  } catch (err) {
    throw new Error(explainStorageError(err));
  }
  return { settings: normalizeSettings(config.settings), groups };
}

/** Change only the settings (e.g. the on/off switch in the popup). */
export async function saveSettings(patch) {
  const { [SETTINGS_KEY]: stored = {} } = await storage().get(SETTINGS_KEY);
  await storage().set({ [SETTINGS_KEY]: { ...stored, ...patch } });
}

function explainStorageError(err) {
  const message = String(err?.message ?? err);
  if (/QUOTA_BYTES_PER_ITEM/i.test(message)) {
    return 'A group has too many patterns – Chrome sync allows at most 8 KB per group. Split it into several groups.';
  }
  if (/QUOTA_BYTES/i.test(message)) {
    return 'The settings are too large for Chrome sync (max. 100 KB).';
  }
  if (/MAX_WRITE_OPERATIONS/i.test(message)) {
    return 'Too many saves in a short time – please try again in a minute.';
  }
  return `Saving failed: ${message}`;
}

/* ---------- Export / Import ---------- */

export const EXPORT_FORMAT = 'tab-groups-by-url';

export function toExport(config) {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettings(config.settings),
    groups: config.groups.map(({ name, color, patterns, openUrls, enabled }) => ({
      name,
      color,
      patterns,
      openUrls,
      enabled,
    })),
  };
}

export function fromImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const list = Array.isArray(data) ? data : data?.groups;
  if (!Array.isArray(list)) throw new Error('No groups found in the file.');
  return {
    settings: normalizeSettings(data?.settings),
    groups: list.map((g) => normalizeGroup({ ...g, id: undefined })),
  };
}

/* ---------- Validation ---------- */

/**
 * Validates the configuration.
 *  - errors:   block saving (missing/duplicate name, broken pattern,
 *              line under "Pages to open" that is not a concrete URL)
 *  - warnings: hints (no patterns, pattern shadowed by a group further up)
 */
export function validateConfig(config) {
  const compiled = compileGroups(config.groups);
  const report = new Map();
  const seenNames = new Map();
  let ok = true;

  compiled.forEach((entry, index) => {
    const { group } = entry;
    const item = { nameError: null, patternErrors: entry.errors, openErrors: [], warnings: [] };
    report.set(group.id, item);

    (group.openUrls ?? []).forEach((line, lineIndex) => {
      try {
        toOpenUrl(line);
      } catch (err) {
        item.openErrors.push({ index: lineIndex, line, message: err.message });
      }
    });

    const key = group.name.trim().toLocaleLowerCase('en');
    if (!key) {
      item.nameError = 'Please enter a name.';
    } else if (seenNames.has(key)) {
      item.nameError = `The name “${group.name.trim()}” already exists.`;
    } else {
      seenNames.set(key, group.id);
    }
    if (item.nameError || item.patternErrors.length || item.openErrors.length) ok = false;

    const hasOpenUrls = (group.openUrls ?? []).some((l) => String(l).trim() && !String(l).trim().startsWith('#'));
    if (!entry.include.length) {
      if (!hasOpenUrls) item.warnings.push('No URL pattern yet – tabs will never be added to this group automatically.');
    } else if (group.enabled !== false) {
      const above = compiled.slice(0, index);
      for (const pattern of entry.include) {
        const sample = sampleUrl(pattern.raw);
        const hit = sample && findMatch(above, sample);
        if (hit) {
          item.warnings.push(
            `“${pattern.raw}” is already caught by “${hit.group.name || 'Unnamed'}” further up – ` +
              'move this group up or add an exclusion pattern (!) there.',
          );
        }
      }
    }
  });

  return { ok, report };
}
