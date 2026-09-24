/**
 * URL patterns – one per line:
 *
 *   github.com                   domain incl. all subdomains, any path
 *   *.atlassian.net              same as atlassian.net
 *   github.com/my-company        only URLs starting with this path
 *   localhost:3000               domain with port
 *   https://intranet.de/wiki/*   with scheme: the scheme has to match as well
 *   jira.*.de                    * stands for any number of characters
 *   /^https:\/\/.*\.pdf$/i       regular expression, tested against the full URL
 *   !mail.google.com             exclusion (any of the forms above with a leading !)
 *   # comment                    ignored
 *
 * Patterns other than regular expressions are prefixes: anything after the
 * pattern matches automatically. Matching is case-insensitive, a leading
 * "www." is ignored.
 *
 * Also: which URLs "Open group" loads (toOpenUrl, urlsToOpen) and which of
 * them are already open in a group (missingUrls).
 *
 * This file deliberately makes no chrome.* calls so it runs in the
 * background script, in the extension's pages and in Node tests.
 */

export class PatternError extends Error {}

const WILDCARD_TOKEN = 'wildcardtokenq';
const REGEX_PATTERN = /^\/(.+)\/([a-z]*)$/s;
const SCHEME_PREFIX = /^([a-z*][a-z0-9+.*-]*):\/\//i;
const HOST_CHARS = /^[\p{L}\p{N}.*:_\-[\]]*$/u;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turns a pattern with * into RegExp source (everything else is literal). */
function globSource(glob) {
  return glob.split('*').map(escapeRegExp).join('.*');
}

function safeDecode(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

/** Normalizes the host part: lowercase, drop "*." and "www.", non-ASCII → punycode. */
function normalizeHost(host) {
  let h = host.toLowerCase();
  if (h.startsWith('*.')) h = h.slice(2);
  if (h.startsWith('www.') && h.indexOf('.', 4) !== -1) h = h.slice(4);
  if (/[^\x00-\x7f]/.test(h)) {
    try {
      const placeholder = h.split('*').join(WILDCARD_TOKEN);
      h = new URL(`http://${placeholder}`).host.split(WILDCARD_TOKEN).join('*');
    } catch {
      /* pattern stays as it is and simply won't match */
    }
  }
  return h;
}

function hostMatcher(hostPattern) {
  if (hostPattern === '') return (u) => u.hostname === '';
  const comparePort = hostPattern.includes(':');
  // (?:…\.)? allows any subdomains, but only at a dot boundary.
  const re = new RegExp(`^(?:[^/]*\\.)?${globSource(hostPattern)}$`, 'i');
  return (u) => re.test(comparePort ? u.host : u.hostname);
}

function pathMatcher(pathPattern) {
  if (!pathPattern || pathPattern === '/') return () => true;
  const re = new RegExp(`^${globSource(safeDecode(pathPattern))}`, 'i');
  return (u) => re.test(safeDecode(u.pathname + u.search + u.hash));
}

function schemeMatcher(schemePattern) {
  if (!schemePattern) return () => true;
  const re = new RegExp(`^${globSource(schemePattern.toLowerCase())}:$`, 'i');
  return (u) => re.test(u.protocol);
}

/**
 * Turns a line into a matcher.
 * Returns null for blank lines/comments, throws PatternError on errors.
 */
export function compilePattern(line) {
  const raw = String(line ?? '').trim();
  let text = raw;
  if (!text || text.startsWith('#')) return null;

  let negate = false;
  if (text.startsWith('!')) {
    negate = true;
    text = text.slice(1).trim();
    if (!text) throw new PatternError('Empty exclusion pattern.');
  }

  const regex = REGEX_PATTERN.exec(text);
  if (regex) {
    let re;
    try {
      re = new RegExp(regex[1], regex[2]);
    } catch (err) {
      // "Invalid regular expression: /…/: Unterminated character class" → show only the reason
      const reason = String(err.message).split(': ').pop();
      throw new PatternError(`Invalid regular expression (${reason}).`);
    }
    return {
      raw,
      negate,
      kind: 'regex',
      test(u) {
        re.lastIndex = 0;
        return re.test(u.href);
      },
    };
  }

  if (/\s/.test(text)) throw new PatternError('Patterns must not contain spaces.');

  let scheme = null;
  let rest = text;
  const schemeMatch = SCHEME_PREFIX.exec(text);
  if (schemeMatch) {
    scheme = schemeMatch[1];
    rest = text.slice(schemeMatch[0].length);
  }

  // The domain ends at the first / ? or #  ("github.com?tab=x" = "github.com/?tab=x")
  const cut = rest.search(/[/?#]/);
  const hostPart = cut === -1 ? rest : rest.slice(0, cut);
  let pathPart = cut === -1 ? '' : rest.slice(cut);
  if (pathPart && !pathPart.startsWith('/')) pathPart = `/${pathPart}`;

  if (!scheme && !hostPart) {
    throw new PatternError('Domain missing (use * for any domain).');
  }
  if (!HOST_CHARS.test(hostPart)) {
    throw new PatternError(`Invalid domain “${hostPart}”.`);
  }

  const matchScheme = schemeMatcher(scheme);
  const matchHost = hostMatcher(normalizeHost(hostPart));
  const matchPath = pathMatcher(pathPart);

  return {
    raw,
    negate,
    kind: 'glob',
    test: (u) => matchScheme(u) && matchHost(u) && matchPath(u),
  };
}

/** Compiles all patterns of a group; broken lines end up in `errors`. */
export function compileGroup(group) {
  const include = [];
  const exclude = [];
  const errors = [];
  (group.patterns ?? []).forEach((line, index) => {
    try {
      const pattern = compilePattern(line);
      if (pattern) (pattern.negate ? exclude : include).push(pattern);
    } catch (err) {
      errors.push({ index, line, message: err.message });
    }
  });
  return { group, include, exclude, errors };
}

export function compileGroups(groups) {
  return groups.map(compileGroup);
}

export function parseUrl(url) {
  if (url instanceof URL) return url;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * First matching (enabled) group, from top to bottom.
 * @returns {{ group: object, pattern: string } | null}
 */
export function findMatch(compiledGroups, url) {
  const u = parseUrl(url);
  if (!u) return null;
  for (const entry of compiledGroups) {
    if (entry.group.enabled === false) continue;
    const hit = entry.include.find((p) => p.test(u));
    if (!hit) continue;
    if (entry.exclude.some((p) => p.test(u))) continue;
    return { group: entry.group, pattern: hit.raw };
  }
  return null;
}

/**
 * Like findMatch, but also explains which groups were skipped
 * (for the URL test on the settings page).
 */
export function explainMatch(compiledGroups, url) {
  const u = parseUrl(url);
  const result = { valid: !!u, match: null, excluded: [], disabled: [] };
  if (!u) return result;
  for (const entry of compiledGroups) {
    const hit = entry.include.find((p) => p.test(u));
    if (!hit) continue;
    if (entry.group.enabled === false) {
      result.disabled.push({ group: entry.group, pattern: hit.raw });
      continue;
    }
    const excludedBy = entry.exclude.find((p) => p.test(u));
    if (excludedBy) {
      result.excluded.push({ group: entry.group, pattern: excludedBy.raw });
      continue;
    }
    result.match = { group: entry.group, pattern: hit.raw };
    break;
  }
  return result;
}

/**
 * An example URL that matches a (non-regex, non-exclusion) pattern – used to
 * detect whether a group further up "shadows" the pattern. Returns null if
 * that doesn't make sense.
 */
export function sampleUrl(line) {
  let text = String(line ?? '').trim();
  if (!text || text.startsWith('#') || text.startsWith('!') || REGEX_PATTERN.test(text)) return null;
  let scheme = 'https';
  const schemeMatch = SCHEME_PREFIX.exec(text);
  if (schemeMatch) {
    if (!schemeMatch[1].includes('*')) scheme = schemeMatch[1];
    text = text.slice(schemeMatch[0].length);
  }
  const filled = text.replace(/\*/g, 'x');
  const cut = filled.search(/[/?#]/);
  let host = cut === -1 ? filled : filled.slice(0, cut);
  if (host.startsWith('x.')) host = host.slice(2);
  let path = cut === -1 ? '/' : filled.slice(cut);
  if (!path.startsWith('/')) path = `/${path}`;
  const candidate = `${scheme}://${host}${path}`;
  return parseUrl(candidate) ? candidate : null;
}

/** Canonical form for detecting equivalent patterns ("*.x.de" = "www.x.de" = "x.de/"). */
export function canonicalPattern(line) {
  return String(line ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^www\.(?=[^./]+\.)/, '')
    .replace(/\/$/, '');
}

/** Suggested pattern for a URL: the domain without "www.". */
export function suggestPattern(url) {
  const u = parseUrl(url);
  if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) return null;
  const host = u.hostname.replace(/^www\.(?=[^.]+\.)/, '');
  return u.port ? `${host}:${u.port}` : host;
}

/* ---------- URLs to open ---------- */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'chrome:']);
const PLAIN_HOST_CHARS = /^[\p{L}\p{N}.\-_:[\]]+$/u;

/** localhost, IP addresses, names without a dot (intranet) and addresses with a port → http, otherwise https */
function defaultScheme(hostPart) {
  const host = hostPart.replace(/:\d+$/, '').toLowerCase();
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith('[') ||
    !host.includes('.');
  return local || /:\d+$/.test(hostPart) ? 'http' : 'https';
}

/**
 * Turns a line into a URL that can be opened in a tab.
 * Without a scheme, https:// is added (or http:// for localhost & co.).
 * Returns null for blank lines/comments, throws PatternError if the line
 * is not a concrete URL.
 */
export function toOpenUrl(line) {
  const text = String(line ?? '').trim();
  if (!text || text.startsWith('#')) return null;
  if (text.startsWith('!') || REGEX_PATTERN.test(text)) {
    throw new PatternError('Only concrete URLs are allowed here, no patterns.');
  }
  if (/\s/.test(text)) throw new PatternError('URLs must not contain spaces.');
  if (text.includes('*')) {
    throw new PatternError('Wildcards (*) are not allowed here – please enter a concrete URL.');
  }

  let candidate = text;
  if (!HAS_SCHEME.test(text)) {
    const hostPart = text.split(/[/?#]/)[0];
    if (!hostPart || !PLAIN_HOST_CHARS.test(hostPart)) throw new PatternError('Not a valid URL.');
    candidate = `${defaultScheme(hostPart)}://${text}`;
  }
  const u = parseUrl(candidate);
  if (!u || (u.protocol !== 'file:' && !u.hostname)) throw new PatternError('Not a valid URL.');
  if (!OPENABLE_PROTOCOLS.has(u.protocol)) {
    throw new PatternError('Only http, https, file and chrome URLs can be opened.');
  }
  if (u.username || u.password) throw new PatternError('URLs with credentials are not supported.');
  return u.href;
}

/**
 * Which URLs "Open group" loads: the group's own list – or, if that is
 * empty, all URL patterns that are concrete URLs (a trailing * is ignored
 * for this; patterns with *, regular expressions and exclusions are skipped).
 * @returns {{ urls: string[], source: 'own' | 'patterns' }}
 */
export function urlsToOpen(group) {
  const collect = (lines) => {
    const urls = [];
    for (const line of lines) {
      try {
        const href = toOpenUrl(line);
        if (href && !urls.includes(href)) urls.push(href);
      } catch {
        /* not a concrete URL → skip */
      }
    }
    return urls;
  };
  const own = (group.openUrls ?? []).map((l) => String(l).trim()).filter((l) => l && !l.startsWith('#'));
  if (own.length) return { urls: collect(own), source: 'own' };
  const fromPatterns = (group.patterns ?? []).map((l) => String(l).trim().replace(/\*+$/, ''));
  return { urls: collect(fromPatterns), source: 'patterns' };
}

/** Comparison key for a URL: without #, without trailing slash, lowercase. */
function pageKey(url) {
  const u = parseUrl(url);
  if (!u) return String(url ?? '').toLowerCase();
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
}

/**
 * Which of the `urls` are not yet covered by the URLs of open tabs (`tabUrls`)?
 * A tab counts for a URL if it is exactly on it or on a subpage
 * (e.g. after a redirect). Each tab counts for at most one URL.
 */
export function missingUrls(urls, tabUrls) {
  const free = tabUrls.map(pageKey);
  const keys = urls.map(pageKey);
  const covered = keys.map(() => false);
  const assign = (fits) => {
    keys.forEach((key, i) => {
      if (covered[i]) return;
      const j = free.findIndex((tab) => tab !== null && fits(tab, key));
      if (j === -1) return;
      covered[i] = true;
      free[j] = null;
    });
  };
  assign((tab, key) => tab === key);
  assign((tab, key) => tab.startsWith(`${key}/`) || tab.startsWith(`${key}?`));
  return urls.filter((_, i) => !covered[i]);
}

/** Short form for display: "https://www.github.com/my-company/" → "github.com/my-company" */
export function shortUrl(url) {
  const u = parseUrl(url);
  if (!u) return String(url ?? '');
  if (u.protocol === 'file:') return u.pathname.split('/').pop() || u.href;
  const host = u.host.replace(/^www\./, '');
  const path = `${u.pathname}${u.search}`.replace(/\/$/, '');
  return host + (path.length > 24 ? `${path.slice(0, 23)}…` : path);
}

/** Suggested group name from a domain, e.g. "mail.google.com" → "Google". */
export function suggestName(host) {
  const labels = String(host ?? '').split(':')[0].split('.').filter(Boolean);
  if (!labels.length) return '';
  let index = labels.length >= 2 ? labels.length - 2 : 0;
  // bbc.co.uk, example.com.au …: the actual brand is one level further left
  if (labels.length >= 3 && labels.at(-1).length === 2 && labels[index].length <= 3) index -= 1;
  const core = labels[index];
  return core.charAt(0).toUpperCase() + core.slice(1);
}
