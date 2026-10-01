/**
 * Translations: the texts live in _locales/<language>/messages.json, Chrome
 * picks the language of its own user interface (English if there is no
 * translation for it).
 *
 * No DOM and no other chrome.* calls, so it also runs in the background
 * script and in Node tests (tests/i18n-setup.mjs provides the English texts).
 */

/** The text for `key`; the substitutions fill its placeholders in order. Unknown keys come back as they are. */
export function t(key, ...substitutions) {
  return globalThis.chrome?.i18n?.getMessage(key, substitutions.map(String)) || key;
}

/**
 * "1 group" / "3 groups": `key_one` or `key_other` – with the count as the
 * first substitution, followed by any others.
 */
export function plural(count, key, ...substitutions) {
  return t(`${key}_${count === 1 ? 'one' : 'other'}`, count, ...substitutions);
}
