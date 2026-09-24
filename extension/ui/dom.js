/* Small DOM helpers shared by the settings page and the popup. */
import { GROUP_COLORS } from '../lib/colors.js';

/** Build an element: h('button', { class: 'btn', onclick }, 'Text', child, …) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'value') {
      el.value = value;
    } else if (key in el && typeof value !== 'string') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  up: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  down: 'M12 5v14M18.5 12.5 12 19l-6.5-6.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  sort: 'M4 6h10M4 12h7M4 18h5M17 5v14M13.5 15.5 17 19l3.5-3.5',
  warn: 'M12 3.5 21.5 20h-19L12 3.5zM12 10v4.5M12 17.2v.3',
  error: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-6 6M9 9l6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8v.3',
  sliders: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
  search: 'M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM20.5 20.5l-4.2-4.2',
  launch: 'M14 4h6v6M20 4l-8.5 8.5M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.append(path);
  return svg;
}

/** Tab group label as Chrome shows it */
export function chip(name, color) {
  const label = name?.trim();
  return h('span', { class: `chip${label ? '' : ' is-empty'}`, dataset: { color } }, label || 'Unnamed');
}

/** Color picker as a radio group */
export function swatches(radioName, selected, { label = 'Color' } = {}) {
  return h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': label },
    GROUP_COLORS.map((c) =>
      h(
        'label',
        { class: 'swatch', dataset: { color: c.id }, title: c.label },
        h('input', { type: 'radio', name: radioName, value: c.id, checked: c.id === selected }),
        h('span', { class: 'sr-only' }, c.label),
      ),
    ),
  );
}

export function note(kind, text) {
  const iconName = { error: 'error', warn: 'warn', ok: 'check', info: 'info' }[kind] ?? 'info';
  return h('div', { class: `note ${kind}` }, icon(iconName), h('div', {}, text));
}

let toastTimer = null;
export function toast(text, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.replaceChildren(icon(kind === 'error' ? 'error' : 'check'), h('span', {}, text));
  el.dataset.kind = kind;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), kind === 'error' ? 6000 : 2600);
}
