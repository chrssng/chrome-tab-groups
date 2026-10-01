/**
 * Loaded before the unit tests (npm test → node --import): gives lib/i18n.js
 * the English texts from _locales/en/messages.json, resolved like Chrome's
 * chrome.i18n.getMessage – named placeholders ($NAME$ → "$1"), then the
 * substitutions $1…$9, and $$ for a literal $.
 */
import { readFileSync } from 'node:fs';

const messages = JSON.parse(readFileSync(new URL('../extension/_locales/en/messages.json', import.meta.url), 'utf8'));
const byKey = new Map(Object.entries(messages).map(([key, entry]) => [key.toLowerCase(), entry])); // keys are case-insensitive

export function getMessage(key, substitutions = []) {
  const entry = byKey.get(String(key).toLowerCase());
  if (!entry) return '';
  const subs = [].concat(substitutions ?? []).map(String);
  const placeholders = new Map(
    Object.entries(entry.placeholders ?? {}).map(([name, { content }]) => [name.toLowerCase(), content]),
  );
  return entry.message
    .replace(/\$([a-z0-9_@]+)\$/gi, (match, name) => placeholders.get(name.toLowerCase()) ?? match)
    .replace(/\$(\$|[1-9])/g, (_, c) => (c === '$' ? '$' : (subs[Number(c) - 1] ?? '')));
}

globalThis.chrome = { ...globalThis.chrome, i18n: { getMessage, getUILanguage: () => 'en' } };
