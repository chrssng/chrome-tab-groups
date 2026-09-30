// Run with:  npm test   (or: node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromImport, mergeImport, validateConfig } from '../extension/lib/config.js';

const group = (name, patterns = [`${name.toLowerCase()}.com`]) => ({ name, color: 'blue', patterns, openUrls: [], enabled: true });

test('Import “add”: groups are appended, existing names and settings stay', () => {
  const current = { settings: { enabled: false, ungroupOnLeave: true }, groups: [group('GitHub'), group('Mail')] };
  const imported = fromImport(
    JSON.stringify({
      settings: { enabled: true, ungroupOnLeave: false },
      groups: [group('Docs'), group(' github '), group('News'), group('DOCS')],
    }),
  );
  const { config, added, skipped } = mergeImport(current, imported);
  assert.deepEqual(config.groups.map((g) => g.name), ['GitHub', 'Mail', 'Docs', 'News']);
  assert.deepEqual(added.map((g) => g.name), ['Docs', 'News']);
  assert.deepEqual(skipped.map((g) => g.name), ['github', 'DOCS']);
  assert.deepEqual(config.settings, current.settings);
  assert.equal(current.groups.length, 2, 'current config is not modified');
  assert.ok(validateConfig(config).ok);
});

test('Import “add”: nothing to add', () => {
  const current = { settings: { enabled: true, ungroupOnLeave: false }, groups: [group('GitHub')] };
  const { config, added, skipped } = mergeImport(current, fromImport(JSON.stringify([group('GitHub')])));
  assert.equal(added.length, 0);
  assert.equal(skipped.length, 1);
  assert.deepEqual(config.groups, current.groups);
});

test('The sample import file is valid and has no warnings', () => {
  const config = fromImport(readFileSync(new URL('./sample-groups.json', import.meta.url), 'utf8'));
  const { ok, report } = validateConfig(config);
  assert.ok(ok);
  for (const g of config.groups) assert.deepEqual(report.get(g.id).warnings, [], g.name);
});
