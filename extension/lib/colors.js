import { t } from './i18n.js';

/**
 * The nine colors Chrome supports for tab groups (chrome.tabGroups.Color).
 * `light`/`dark` are only used for previews in the extension's own UI.
 */
export const GROUP_COLORS = [
  { id: 'grey',   label: t('colorGrey'),   light: '#5F6368', dark: '#DADCE0' },
  { id: 'blue',   label: t('colorBlue'),   light: '#1A73E8', dark: '#8AB4F8' },
  { id: 'red',    label: t('colorRed'),    light: '#D93025', dark: '#F28B82' },
  { id: 'yellow', label: t('colorYellow'), light: '#F9AB00', dark: '#FDD663' },
  { id: 'green',  label: t('colorGreen'),  light: '#1E8E3E', dark: '#81C995' },
  { id: 'pink',   label: t('colorPink'),   light: '#D01884', dark: '#FF8BCB' },
  { id: 'purple', label: t('colorPurple'), light: '#A142F4', dark: '#D7AEFB' },
  { id: 'cyan',   label: t('colorCyan'),   light: '#007B83', dark: '#78D9EC' },
  { id: 'orange', label: t('colorOrange'), light: '#FA903E', dark: '#FCAD70' },
];

export const COLOR_IDS = GROUP_COLORS.map((c) => c.id);

export function colorLabel(id) {
  return GROUP_COLORS.find((c) => c.id === id)?.label ?? id;
}

export function isValidColor(id) {
  return COLOR_IDS.includes(id);
}

/** First color not used by any group yet (for new groups). */
export function nextFreeColor(groups) {
  const used = new Set(groups.map((g) => g.color));
  return COLOR_IDS.find((id) => id !== 'grey' && !used.has(id)) ?? 'blue';
}
