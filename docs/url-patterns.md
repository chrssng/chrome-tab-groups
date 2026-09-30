[← Documentation](README.md)

# URL patterns

Each group has a list of URL patterns, one per line. A URL belongs to a group if it matches **at least one** of its patterns and **none** of its exclusions.

## Quick reference

| Pattern | Matches |
|---|---|
| `github.com` | github.com and all subdomains (www., gist., …), any path |
| `*.atlassian.net` | same as `atlassian.net` |
| `github.com/my-company` | only URLs that start with this path |
| `github.com/*/issues` | `*` stands for any number of characters |
| `localhost:3000` | only this port |
| `https://intranet.example.com/wiki` | with scheme – `http://` doesn't match then |
| `/\.pdf$/i` | regular expression, tested against the full URL |
| `!mail.google.com` | exclusion: if the URL matches it, the group is skipped |
| `# note` | comment, ignored |

General rules:

- Matching is **case-insensitive**.
- A leading `www.` is ignored – `www.example.com` and `example.com` are the same pattern.
- Patterns (except regular expressions) match the **beginning** of the URL – anything after that matches automatically.

## Domains

`github.com` matches the domain **and all its subdomains**, with any path, scheme and port:

| URL | `github.com` |
|---|---|
| `https://github.com/` | ✔ |
| `https://www.github.com/nodejs` | ✔ |
| `https://gist.github.com/x` | ✔ |
| `https://notgithub.com/` | ✘ – subdomains only count at a dot |

- `*.atlassian.net` is the same as `atlassian.net`.
- International domain names can be written as they are: `münchen.de` matches `https://xn--mnchen-3ya.de/`.
- `*` inside a domain stands for any characters, dots included: `jira.*.de` matches `jira.foo.de` and `jira.foo.bar.de`.
- `*` alone matches **every** URL – useful as a catch-all group at the very bottom of the list.

## Ports

- **Without a port**, any port matches: `localhost` matches `localhost:3000` and `localhost:8080`.
- **With a port**, only that port matches: `localhost:3000` doesn't match `localhost:3001`.

## Paths

A path turns the pattern into a prefix: `github.com/my-company` matches every URL that starts with `github.com/my-company` – including query string and `#fragment`.

- `*` matches any characters, slashes included: `github.com/*/issues` matches `github.com/a/issues` and `github.com/a/b/issues/1`.
- `?` or `#` right after the domain work as well: `github.com?tab=x` is the same as `github.com/?tab=x`.
- Percent-encoded characters are decoded before comparing, so `de.wikipedia.org/wiki/Köln` matches `…/wiki/K%C3%B6ln`.

> **Watch out:** the prefix is compared character by character. `github.com/my-company` also matches `github.com/my-company-archive`. If that's not wanted, add an exclusion (`!github.com/my-company-archive`) or use a regular expression.

## Schemes

- **Without a scheme**, any scheme matches (`http`, `https`, …).
- **With a scheme**, it has to match: `https://intranet.example.com/wiki` doesn't match `http://intranet.example.com/wiki`.
- `*` works in the scheme too: `http*://example.com` matches `http` and `https`.
- **Local files:** `file:///C:/Users/me/Documents/` matches all files in that folder.

## Regular expressions

A pattern in slashes – `/…/` with optional flags – is a regular expression:

```
/\.pdf([?#]|$)/i
```

- It's tested against the **full URL** including the scheme, e.g. `https://example.com/report.pdf?download=1`.
- It isn't anchored – use `^` and `$` if needed.
- Spaces are allowed inside a regular expression (unlike in other patterns).
- An invalid expression is marked as an error, e.g. *Invalid regular expression (Unterminated character class).*

## Exclusions

Any pattern with a leading `!` is an exclusion. If a URL matches an exclusion, **this group is skipped** – the next group below gets its chance.

Example “everything from Google except Gmail”:

| Group | Patterns |
|---|---|
| *Google* | `google.com`<br>`!mail.google.com` |
| *Mail* | `mail.google.com` |

`https://mail.google.com` is excluded from *Google* and lands in *Mail*, no matter which of the two groups is further up.

## Comments and blank lines

Lines starting with `#` and blank lines are ignored. Use comments to explain why a pattern is there:

```
# wildcards – must stay above “GitHub”, otherwise that group wins
github.com/*/issues
github.com/*/pulls
```

## Which group wins

The groups are checked **from top to bottom** – across all [categories](categories.md), in the order they're shown in the settings. The first **active** group that has a matching pattern – and no matching exclusion – wins. The number in each group's header is its priority.

So put specific groups above general ones: *Issues & PRs* (`github.com/*/issues`) has to be above *GitHub* (`github.com`), otherwise *GitHub* catches every GitHub URL first. The order of the categories counts too – a catch-all group like *Google* (`google.com`) belongs in a category further down.

Reorder groups by dragging them by their header or with ↑ ↓, and categories with ↑ ↓ in their header – see [Settings](settings.md#groups) and [Priority](categories.md#priority).

If a pattern can never win because a group further up already catches it, the settings page warns you:

> “github.com/*/issues” is already caught by “GitHub” further up – move this group up or add an exclusion pattern (!) there.

## Errors

These lines are marked in red with their line number and block saving:

| Line | Error |
|---|---|
| `example.com/a b` | Patterns must not contain spaces. |
| `!` | Empty exclusion pattern. |
| `/[a/` | Invalid regular expression (…). |
| `/wiki` (a path without a domain) | Domain missing (use * for any domain). |
| `exa$mple.com` | Invalid domain “exa$mple.com”. |

## Trying out patterns

Settings → **Test a URL**: type any URL and see immediately which group it lands in and through which pattern – including your unsaved changes. See [Test a URL](settings.md#test-a-url).
