// Run with:  npm test   (or: node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePattern,
  compileGroups,
  findMatch,
  explainMatch,
  sampleUrl,
  suggestPattern,
  suggestName,
  canonicalPattern,
  toOpenUrl,
  urlsToOpen,
  missingUrls,
  shortUrl,
} from '../extension/lib/patterns.js';

const matches = (pattern, url) => compilePattern(pattern).test(new URL(url));

test('Domain matches incl. subdomains, but not similar domains', () => {
  assert.ok(matches('github.com', 'https://github.com/'));
  assert.ok(matches('github.com', 'https://gist.github.com/abc'));
  assert.ok(matches('github.com', 'http://a.b.github.com/x?y=1'));
  assert.ok(!matches('github.com', 'https://evilgithub.com/'));
  assert.ok(!matches('github.com', 'https://github.com.evil.org/'));
});

test('*. and www. are ignored, case does not matter', () => {
  assert.ok(matches('*.atlassian.net', 'https://acme.atlassian.net/jira'));
  assert.ok(matches('*.atlassian.net', 'https://atlassian.net/'));
  assert.ok(matches('www.example.com', 'https://example.com/'));
  assert.ok(matches('GitHub.COM', 'https://github.com/'));
});

test('Path patterns are prefixes', () => {
  assert.ok(matches('github.com/acme', 'https://github.com/acme/repo/issues'));
  assert.ok(matches('github.com/Acme', 'https://github.com/acme'));
  assert.ok(!matches('github.com/acme', 'https://github.com/other/repo'));
  assert.ok(matches('youtube.com/watch?v=', 'https://www.youtube.com/watch?v=abc'));
  assert.ok(matches('github.com/*/issues', 'https://github.com/a/issues/3'));
  assert.ok(matches('example.org?lang=de', 'https://example.org/?lang=de&x=1'));
  assert.ok(!matches('example.org?lang=de', 'https://example.org/page?lang=de'));
  assert.ok(matches('example.org#faq', 'https://example.org/#faq'));
});

test('Scheme, port and wildcards', () => {
  assert.ok(matches('https://intranet.acme.com/wiki/*', 'https://intranet.acme.com/wiki/Start'));
  assert.ok(!matches('https://intranet.acme.com/wiki/*', 'http://intranet.acme.com/wiki/Start'));
  assert.ok(matches('localhost:3000', 'http://localhost:3000/app'));
  assert.ok(!matches('localhost:3000', 'http://localhost:8080/app'));
  assert.ok(matches('localhost', 'http://localhost:8080/app'));
  assert.ok(matches('jira.*.com', 'https://jira.acme.com/browse/X-1'));
  assert.ok(matches('file:///home/*', 'file:///home/chris/notes.txt'));
  assert.ok(matches('*', 'https://anything.org/'));
});

test('Non-ASCII characters in domain and path', () => {
  assert.ok(matches('müller.de', 'https://www.xn--mller-kva.de/'));
  assert.ok(matches('de.wikipedia.org/wiki/Köln', 'https://de.wikipedia.org/wiki/K%C3%B6ln'));
});

test('Regular expressions', () => {
  assert.ok(matches('/\\.pdf$/i', 'https://example.org/file.PDF'));
  assert.ok(!matches('/\\.pdf$/', 'https://example.org/file.html'));
  assert.throws(() => compilePattern('/[/'), /Invalid regular expression/);
});

test('Blank lines, comments and errors', () => {
  assert.equal(compilePattern(''), null);
  assert.equal(compilePattern('   '), null);
  assert.equal(compilePattern('# comment'), null);
  assert.throws(() => compilePattern('!'), /Empty exclusion pattern/);
  assert.throws(() => compilePattern('git hub.com'), /spaces/);
  assert.throws(() => compilePattern('/path-without-domain'), /Domain missing/);
  assert.throws(() => compilePattern('user@host.de'), /Invalid domain/);
});

test('Order and exclusions', () => {
  const groups = compileGroups([
    { id: 'acme', name: 'Acme', patterns: ['github.com/acme'], enabled: true },
    { id: 'google', name: 'Google', patterns: ['google.com', '!mail.google.com'], enabled: true },
    { id: 'off', name: 'Paused', patterns: ['example.org'], enabled: false },
    { id: 'gh', name: 'GitHub', patterns: ['github.com'], enabled: true },
    { id: 'mail', name: 'Mail', patterns: ['mail.google.com'], enabled: true },
  ]);
  assert.equal(findMatch(groups, 'https://github.com/acme/x').group.id, 'acme');
  assert.equal(findMatch(groups, 'https://github.com/other').group.id, 'gh');
  assert.equal(findMatch(groups, 'https://docs.google.com/').group.id, 'google');
  assert.equal(findMatch(groups, 'https://mail.google.com/').group.id, 'mail');
  assert.equal(findMatch(groups, 'https://example.org/'), null);
  assert.equal(findMatch(groups, 'not-even-a-url'), null);

  const why = explainMatch(groups, 'https://mail.google.com/');
  assert.equal(why.excluded[0].group.id, 'google');
  assert.equal(why.match.group.id, 'mail');
  assert.equal(explainMatch(groups, 'https://example.org/').disabled[0].group.id, 'off');
});

test('Sample URLs and suggestions', () => {
  assert.equal(sampleUrl('github.com'), 'https://github.com/');
  assert.equal(sampleUrl('*.atlassian.net'), 'https://atlassian.net/');
  assert.equal(sampleUrl('github.com/*/issues'), 'https://github.com/x/issues');
  assert.equal(sampleUrl('example.org?lang=de'), 'https://example.org/?lang=de');
  assert.equal(sampleUrl('!github.com'), null);
  assert.equal(sampleUrl('/regex/'), null);
  assert.equal(suggestPattern('https://www.github.com/foo'), 'github.com');
  assert.equal(suggestPattern('http://localhost:3000/'), 'localhost:3000');
  assert.equal(suggestPattern('chrome://settings/'), null);
  assert.equal(suggestName('mail.google.com'), 'Google');
  assert.equal(suggestName('www.bbc.co.uk'), 'Bbc');
  assert.equal(suggestName('localhost:3000'), 'Localhost');
});

test('URLs to open: the scheme is added sensibly', () => {
  assert.equal(toOpenUrl('github.com'), 'https://github.com/');
  assert.equal(toOpenUrl('github.com/acme/repo?tab=1#x'), 'https://github.com/acme/repo?tab=1#x');
  assert.equal(toOpenUrl('https://jira.acme.com/board'), 'https://jira.acme.com/board');
  assert.equal(toOpenUrl('localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(toOpenUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(toOpenUrl('intranet/wiki'), 'http://intranet/wiki');
  assert.equal(toOpenUrl('müller.de'), 'https://xn--mller-kva.de/');
  assert.equal(toOpenUrl('chrome://settings'), 'chrome://settings');
  assert.equal(toOpenUrl('  '), null);
  assert.equal(toOpenUrl('# just a note'), null);
});

test('URLs to open: patterns and nonsense are rejected', () => {
  assert.throws(() => toOpenUrl('*.atlassian.net'), /Wildcards/);
  assert.throws(() => toOpenUrl('/\\.pdf$/'), /no patterns/);
  assert.throws(() => toOpenUrl('!mail.google.com'), /no patterns/);
  assert.throws(() => toOpenUrl('git hub.com'), /spaces/);
  assert.throws(() => toOpenUrl('javascript:alert(1)'), /Not a valid URL/);
  assert.throws(() => toOpenUrl('mailto:a@b.de'), /Not a valid URL/);
  assert.throws(() => toOpenUrl('ftp://server/file'), /Only http/);
  assert.throws(() => toOpenUrl('https://user:secret@x.de/'), /credentials/);
});

test('Which URLs “Open group” loads', () => {
  const fromPatterns = urlsToOpen({
    patterns: ['github.com', '*.atlassian.net', '/regex/', '!x.de', '# note', 'https://intranet.de/wiki/*', 'github.com'],
    openUrls: [],
  });
  assert.equal(fromPatterns.source, 'patterns');
  assert.deepEqual(fromPatterns.urls, ['https://github.com/', 'https://intranet.de/wiki/']);

  const own = urlsToOpen({ patterns: ['github.com'], openUrls: ['jira.acme.com/board', '', '# x', 'confluence.acme.com'] });
  assert.equal(own.source, 'own');
  assert.deepEqual(own.urls, ['https://jira.acme.com/board', 'https://confluence.acme.com/']);

  // only comments in the group's own list → fall back to the patterns
  assert.equal(urlsToOpen({ patterns: ['a.de'], openUrls: ['# later'] }).source, 'patterns');
});

test('Pages that are already open are detected (even after a redirect)', () => {
  const urls = ['https://github.com/', 'https://github.com/acme/repo', 'https://jira.acme.com/board'];
  assert.deepEqual(missingUrls(urls, []), urls);
  // exact match + subpage; each tab counts only once
  assert.deepEqual(
    missingUrls(urls, ['https://github.com/acme/repo', 'https://jira.acme.com/board?selectedIssue=X-1']),
    ['https://github.com/'],
  );
  assert.deepEqual(missingUrls(urls, ['https://github.com/acme/repo', 'https://github.com/acme/repo/pulls', 'https://jira.acme.com/board/']), []);
  assert.deepEqual(missingUrls(['https://a.de/x'], ['https://a.de/xyz']), ['https://a.de/x']);
  assert.equal(shortUrl('https://www.github.com/acme/'), 'github.com/acme');
});

test('Equivalent patterns are detected', () => {
  const same = (a, b) => canonicalPattern(a) === canonicalPattern(b);
  assert.ok(same('github.com', '*.GitHub.com'));
  assert.ok(same('github.com', 'www.github.com/'));
  assert.ok(same(' github.com/acme ', 'github.com/acme/'));
  assert.ok(!same('github.com', 'gist.github.com'));
  assert.ok(!same('www.de', 'de'));
});
