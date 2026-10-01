// Run with:  npm test   (or: node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fromImport,
  toExport,
  mergeImport,
  validateConfig,
  normalizeConfig,
  groupTitle,
  ownerOf,
} from '../extension/lib/config.js';

const group = (name, extra = {}) => ({
  id: `id-${name.toLowerCase().replace(/\W/g, '')}-${extra.category ?? ''}`,
  name,
  color: 'blue',
  patterns: [`${name.toLowerCase().replace(/\W/g, '')}.com`],
  openUrls: [],
  enabled: true,
  ...extra,
});
const names = (config) => config.groups.map((g) => g.name);

test('Import “add”: groups are appended, existing names and settings stay', () => {
  const current = normalizeConfig({ settings: { enabled: false, ungroupOnLeave: true }, groups: [group('GitHub'), group('Mail')] });
  const imported = fromImport(
    JSON.stringify({
      settings: { enabled: true, ungroupOnLeave: false },
      groups: [group('Docs'), group(' github '), group('News'), group('DOCS')],
    }),
  );
  const { config, added, skipped } = mergeImport(current, imported);
  assert.deepEqual(names(config), ['GitHub', 'Mail', 'Docs', 'News']);
  assert.deepEqual(added.map((g) => g.name), ['Docs', 'News']);
  assert.deepEqual(skipped.map((g) => g.name), ['github', 'DOCS']);
  assert.deepEqual(config.settings, current.settings);
  assert.equal(current.groups.length, 2, 'current config is not modified');
  assert.ok(validateConfig(config).ok);
});

test('Import “add”: nothing to add', () => {
  const current = normalizeConfig({ settings: {}, groups: [group('GitHub')] });
  const { config, added, skipped } = mergeImport(current, fromImport(JSON.stringify([group('GitHub')])));
  assert.equal(added.length, 0);
  assert.equal(skipped.length, 1);
  assert.deepEqual(config.groups, current.groups);
});

test('Every group is in a category – without categories there is “Default”', () => {
  const plain = normalizeConfig({ groups: [group('A'), group('B', { category: 'gone' })] });
  assert.deepEqual(plain.categories, [{ id: 'default', name: 'Default', openCollapsed: false }]);
  assert.deepEqual(plain.groups.map((g) => g.category), ['default', 'default']);

  // Ordered section by section; unknown category → the first category if there is no “Default”
  const config = normalizeConfig({
    categories: [{ id: 'w', name: 'Work' }, { id: 'p', name: 'Private' }],
    groups: [group('A'), group('B', { category: 'p' }), group('C', { category: 'w' }), group('D', { category: 'gone' })],
  });
  assert.deepEqual(names(config), ['A', 'C', 'D', 'B']);
  assert.ok(config.groups.every((g) => g.category !== ''));

  // Earlier format: an entry "" marked where the groups without a category were → “Default” there
  const legacy = normalizeConfig({
    categories: [{ id: 'w', name: 'Work' }, { id: '', name: '' }, { id: 'p', name: 'Private' }],
    groups: [group('A', { category: '' }), group('B', { category: 'p' }), group('C', { category: 'w' })],
  });
  assert.deepEqual(legacy.categories.map((c) => c.name), ['Work', 'Default', 'Private']);
  assert.deepEqual(names(legacy), ['C', 'A', 'B']);
});

test('Names only have to be unique within a category', () => {
  const categories = [{ id: 'w', name: 'Work' }, { id: 'p', name: 'Private' }];
  let result = validateConfig({ categories, groups: [group('Docs', { category: 'w' }), group('Docs', { category: 'p' })] });
  assert.ok(result.ok, 'same name in two categories is fine');
  result = validateConfig({ categories, groups: [group('Docs', { category: 'w' }), group('docs', { category: 'w', id: 'second' })] });
  assert.ok(!result.ok);
  assert.match([...result.report.values()][1].nameError, /already exists in this category/);
});

test('Category names are required and unique', () => {
  const result = validateConfig({ categories: [{ id: 'a', name: 'Work' }, { id: 'b', name: ' work ' }, { id: 'c', name: '' }], groups: [] });
  assert.ok(!result.ok);
  assert.equal(result.categoryErrors.get('a'), undefined);
  assert.match(result.categoryErrors.get('b'), /already exists/);
  assert.match(result.categoryErrors.get('c'), /enter a name/);
});

test('Title in the tab strip and the warning for equal titles', () => {
  const categories = [{ id: 'w', name: 'Work' }, { id: 'p', name: 'Private' }];
  const work = group('Docs', { category: 'w' });
  const priv = group('Docs', { category: 'p', color: 'red' });
  assert.equal(groupTitle(work, categories), 'Docs');
  assert.equal(groupTitle({ ...work, showCategory: true }, categories), 'Work · Docs');

  let { report } = validateConfig({ categories, groups: [work, priv] });
  assert.match(report.get(work.id).titleWarning, /“Private”.*told apart by their color/);
  ({ report } = validateConfig({ categories, groups: [work, { ...priv, color: 'blue' }] }));
  assert.match(report.get(work.id).titleWarning, /different colors/);
  ({ report } = validateConfig({ categories, groups: [work, { ...priv, showCategory: true }] }));
  assert.equal(report.get(work.id).titleWarning, null, 'prefix makes the titles different');
});

test('Open Chrome groups are assigned to their configured group', () => {
  const categories = [{ id: 'w', name: 'Work' }, { id: 'p', name: 'Private' }];
  const work = group('Docs', { category: 'w', color: 'blue' });
  const priv = group('Docs', { category: 'p', color: 'red' });
  const mail = group('Mail', { category: 'p', showCategory: true });
  const config = { categories, groups: [work, priv, mail] };
  assert.equal(ownerOf({ title: 'Docs', color: 'red' }, config)?.id, priv.id, 'same title → by color');
  assert.equal(ownerOf({ title: 'Docs', color: 'red' }, config, work.id)?.id, work.id, 'remembered owner wins');
  assert.equal(ownerOf({ title: 'Private · Mail', color: 'grey' }, config)?.id, mail.id, 'unique title');
  assert.equal(ownerOf({ title: 'Mail', color: 'blue' }, config), null);
  assert.equal(ownerOf({ title: 'Docs', color: 'green' }, config), null, 'ambiguous and no color match');
});

test('Export/import keeps categories by name', () => {
  const config = normalizeConfig({
    settings: { openInListOrder: true },
    categories: [{ id: 'w', name: 'Work', openCollapsed: true }, { id: 'default', name: 'Default' }],
    groups: [group('Docs', { category: 'w', showCategory: true }), group('Mail', { openCollapsed: true })],
  });
  const exported = toExport(config);
  assert.deepEqual(exported.categories, [{ name: 'Work', openCollapsed: true }, { name: 'Default', openCollapsed: false }]);
  assert.deepEqual(exported.groups.map((g) => g.category), ['Work', 'Default']);
  const back = fromImport(JSON.stringify(exported));
  assert.deepEqual(back.categories.map((c) => `${c.name}:${c.openCollapsed}`), ['Work:true', 'Default:false']);
  assert.equal(back.groups[0].category, back.categories[0].id);
  assert.equal(back.groups[0].showCategory, true);
  assert.equal(back.groups[1].category, back.categories[1].id);
  assert.deepEqual(back.groups.map((g) => g.openCollapsed), [false, true], 'a group’s own “Open collapsed”');

  // Older files: groups without a category go to “Default”; categories only named on groups are created
  const loose = fromImport(JSON.stringify({ groups: [{ name: 'X', category: 'Misc' }, { name: 'Y' }] }));
  assert.deepEqual(loose.categories.map((c) => c.name), ['Misc', 'Default']);
  assert.deepEqual(names(loose), ['X', 'Y']);
  const old = fromImport(JSON.stringify({ groups: [{ name: 'X' }], categories: ['Work', ''] }));
  assert.deepEqual(old.categories.map((c) => c.name), ['Work', 'Default'], '"" → “Default” at its position');
  assert.ok(old.categories.every((c) => c.openCollapsed === false), 'names only → expanded');
});

test('Import “add” merges categories by name', () => {
  const current = normalizeConfig({
    categories: [{ id: 'default', name: 'Default' }, { id: 'w', name: 'Work' }],
    groups: [group('Docs', { category: 'w' }), group('Docs')],
  });
  const imported = fromImport(
    JSON.stringify({
      categories: ['work', 'Private'],
      groups: [
        { name: 'Docs', category: 'WORK' },
        { name: 'Jira', category: 'Work' },
        { name: 'Docs', category: 'Private' },
        { name: 'News' },
      ],
    }),
  );
  const { config, added, skipped } = mergeImport(current, imported);
  assert.deepEqual(config.categories.map((c) => c.name), ['Default', 'Work', 'Private']);
  assert.deepEqual(skipped.map((g) => g.name), ['Docs']);
  assert.deepEqual(added.map((g) => g.name), ['Jira', 'Docs', 'News']);
  assert.deepEqual(
    config.groups.map((g) => `${config.categories.find((c) => c.id === g.category).name}/${g.name}`),
    ['Default/Docs', 'Default/News', 'Work/Docs', 'Work/Jira', 'Private/Docs'],
  );
  assert.ok(validateConfig(config).ok);
});

test('Import “add”: a merged category keeps its own “Open all collapsed”, a new one brings its own', () => {
  const current = normalizeConfig({ categories: [{ id: 'w', name: 'Work' }], groups: [group('A', { category: 'w' })] });
  const imported = fromImport(
    JSON.stringify({
      categories: [{ name: 'work', openCollapsed: true }, { name: 'Reading', openCollapsed: true }],
      groups: [{ name: 'B', category: 'Work' }, { name: 'C', category: 'Reading' }],
    }),
  );
  const { config } = mergeImport(current, imported);
  assert.deepEqual(config.categories.map((c) => `${c.name}:${c.openCollapsed}`), ['Work:false', 'Reading:true']);
});

test('Import “add”: a new category never takes over an existing ID', () => {
  const current = normalizeConfig({ categories: [{ id: 'x', name: 'Misc' }], groups: [group('A', { category: 'x' })] });
  const imported = normalizeConfig({ categories: [{ id: 'x', name: 'New' }], groups: [group('B', { category: 'x' })] });
  const { config } = mergeImport(current, imported);
  const byName = Object.fromEntries(config.categories.map((c) => [c.name, c.id]));
  assert.notEqual(byName.New, byName.Misc);
  assert.equal(config.groups.find((g) => g.name === 'B').category, byName.New);
});

test('The sample import file is valid and has no warnings', () => {
  const config = fromImport(readFileSync(new URL('./sample-groups.json', import.meta.url), 'utf8'));
  const { ok, report } = validateConfig(config);
  assert.ok(ok);
  assert.deepEqual(config.categories.map((c) => `${c.name}:${c.openCollapsed}`), ['Work:false', 'Reading:true', 'Default:false']);
  assert.deepEqual(config.groups.filter((g) => g.openCollapsed).map((g) => g.name), ['Local dev']);
  for (const g of config.groups) {
    assert.deepEqual(report.get(g.id).warnings, [], g.name);
    assert.equal(report.get(g.id).titleWarning, null, g.name);
  }
});
