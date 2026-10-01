// Run with:  npm test   – checks that all languages have the same texts and that every text is used
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { t, plural } from '../extension/lib/i18n.js';

const EXT = new URL('../extension/', import.meta.url);
const read = (path) => readFileSync(new URL(path, EXT), 'utf8');
const locales = readdirSync(new URL('_locales/', EXT));
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
const en = messages.en;

/** All source files of the extension, as text */
function sources(dir = '') {
  return readdirSync(new URL(dir || '.', EXT), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return entry.name === '_locales' || entry.name === 'icons' ? [] : sources(`${path}/`);
    return /\.(js|html|json)$/.test(entry.name) ? [{ path, text: read(path) }] : [];
  });
}
const files = sources();
const allText = files.map((f) => f.text).join('\n');

test('There is an English and a German translation', () => {
  assert.ok(locales.includes('en') && locales.includes('de'), locales.join());
  assert.equal(JSON.parse(read('manifest.json')).default_locale, 'en');
});

test('Every language has the same keys and placeholders as English', () => {
  for (const [locale, list] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(list).sort(), Object.keys(en).sort(), `${locale}: different keys`);
    for (const [key, entry] of Object.entries(en)) {
      assert.deepEqual(list[key].placeholders ?? {}, entry.placeholders ?? {}, `${locale}.${key}: different placeholders`);
      const used = (text) => [...text.matchAll(/\$([a-z0-9_]+)\$/gi)].map((m) => m[1].toLowerCase()).sort();
      assert.deepEqual(used(list[key].message), used(entry.message), `${locale}.${key}: different placeholders in the text`);
      assert.ok(list[key].message.trim(), `${locale}.${key}: empty`);
    }
  }
});

test('Keys are valid and unique regardless of case', () => {
  const seen = new Set();
  for (const key of Object.keys(en)) {
    assert.match(key, /^[A-Za-z0-9_]+$/, key);
    assert.ok(!seen.has(key.toLowerCase()), `${key} exists twice (keys are case-insensitive)`);
    seen.add(key.toLowerCase());
  }
});

test('Every text that is used exists', () => {
  const missing = [];
  const need = (key, where) => {
    if (!(key in en)) missing.push(`${key} (${where})`);
  };
  for (const { path, text } of files) {
    for (const [, key] of text.matchAll(/\b(?:t|tParts|mutedParts)\(\s*'([A-Za-z0-9_]+)'/g)) need(key, path);
    for (const [, key] of text.matchAll(/\bplural\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'([A-Za-z0-9_]+)'/g)) {
      need(`${key}_one`, path);
      need(`${key}_other`, path);
    }
    for (const [, key] of text.matchAll(/data-i18n(?:-html)?="([A-Za-z0-9_]+)"/g)) need(key, path);
    for (const [, list] of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of list.split(';')) {
        const key = pair.split(':')[1]?.trim();
        if (/^[A-Za-z0-9_]+$/.test(key)) need(key, path);
      }
    }
    for (const [, key] of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) need(key, path);
  }
  assert.deepEqual(missing, []);
});

test('Every text is used somewhere', () => {
  const unused = Object.keys(en).filter((key) => {
    const base = key.replace(/_(one|other)$/, '');
    return ![`'${key}'`, `'${base}'`, `"${key}"`, `__MSG_${key}__`, `: ${key}`].some((form) => allText.includes(form));
  });
  assert.deepEqual(unused, []);
});

test('t() fills in the placeholders, plural() picks the form', () => {
  assert.equal(t('valCategoryExists', 'Work'), 'The category “Work” already exists.');
  assert.equal(t('lineIssue', 2, 'x y', 'Bad.'), 'Line 2 “x y”: Bad.');
  assert.equal(plural(1, 'group'), '1 group');
  assert.equal(plural(3, 'group'), '3 groups');
  assert.equal(plural(2, 'categoryRemovedMoved', 'Old', 'New'), 'Category “Old” removed – its 2 groups were moved to “New”. Click “Discard” to undo.');
  assert.equal(t('noSuchKey'), 'noSuchKey');
});
