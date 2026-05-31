# Changelog

All notable changes to lwchat. Format inspired by [Keep a Changelog](https://keepachangelog.com); versioning follows [SemVer](https://semver.org).

## [Unreleased]

Future work tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## [0.1.1] — 2026-05-31 (review branch)

Codebase review pass on the `review/v0.1.x` branch. No behavioural change to the public commands or JSON shapes — just hygiene and small correctness fixes. See [docs/REVIEW.md](docs/REVIEW.md) for the full ranked plan; the items below are what landed on this branch.

### Added

- **`lib/util.js`** — `humanAge`, `fail`, `spacesToScan` extracted from duplicated implementations in `commands.js` and `install.mjs`.

### Changed

- **`commands.js`** — replaced ~9 sites of `if (json) out({ok:false,…}) else console.error(…); process.exit(1)` boilerplate with `fail(msg, extra, json)`.
- **`commands.js`** — replaced 4 sites of the `default_spaces fallback` ternary with `spacesToScan(config, override)`.
- **`commands.js`** — module constants (`DEFAULT_CACHE_TTL_SECONDS`, `MEMBERS_CACHE_TTL_MS`) moved to top of file.
- **`config.js`** — `loadConfig` now merges file contents over `DEFAULT_CONFIG` so older configs missing newer keys (e.g. `cache_ttl_seconds`) silently inherit defaults instead of forcing each caller to `?? defaultValue`.
- **`chat-api.js`** — `api()` errors now carry `.status` and `.body` so callers can branch on HTTP code instead of regexing the message string.
- **`chat-api.js`** — `findDirectMessage` uses `e.status === 404` instead of `/404/.test(e.message)` for the "no DM yet" case.
- **`chat-api.js`** — `getMe` now throws on non-200 (with `.status`/`.body`) instead of silently returning `null`. `generateMe` catches and continues, surfacing the cause as a stderr note ("identity lookup skipped: …").

### Fixed

- **`chat-api.js`** — `listThreadMessages` validates `threadName` shape (`spaces/<X>/threads/<Y>`) before interpolating into the API filter. Surfaces a clear error if a cache row is corrupted or a future caller constructs an invalid name.
- **`chat-api.js`** — mention regex uses `\p{L}` with the `u` flag, so names with diacritics (`Mañuel`, `Müller`, `Renée`) resolve correctly. ASCII-only `[A-Za-z]+` was a real gap for any non-Linways org.
- **`config.js`** — `createBackup` sanitizes the label (alphanumeric/`-`/`_` only, capped at 40 chars). A risky label like `../escape` becomes `--escape`, preventing path traversal out of `~/.lwchat/backups/`.
- **`config.js`** — backed-up `tokens.json` is written with mode `0o600` (matching the live file). Previously took the default umask, which weakened protection of the refresh token in backup copies.
- **`me.js`** — `aliasFromName` no longer crashes when `displayName` is falsy (auto-managed Chat spaces sometimes lack one). Falls through to base "space".
- **`redmine.js`** — `extractIssueId` caches the compiled regex per pattern. Avoids re-compiling the same pattern on every message during scans (2000+ calls per `find`).

### Documentation

- New `docs/REVIEW.md` — the review report itself: every finding, weighted by value × safety, with a numbered implementation plan and an explicit "what NOT to do" list.

### Verified

`lwchat doctor` 8 ok · 0 warn · 0 fail · 0 skip on the review branch. Smoke tests pass for `find`, `read`, `reply`, `post` (to myspace), `dm` (self error-path), `search`, `backup` (including the sanitize test), and the `threadName` shape guard.

---

## [0.1.0] — 2026-05-31

First feature-complete release. Verified end-to-end against a live Google Workspace org with `lwchat doctor` reporting 8/8 ok.

### Added — agent-facing CLI surface

- **`lwchat doctor`** — runtime self-test across 6 sections (runtime, config, auth, network, context, integration). `--json` supported; non-zero exit on failure.
- **`lwchat me`** / **`lwchat me --refresh`** — generates `~/.lwchat/me.md` with identity, configured spaces, and full space list (member counts, last-active dates).
- **`lwchat spaces`** / **`spaces fetch`** / **`spaces add`** / **`spaces remove`** — configure aliases for the spaces you use.
- **`lwchat find <issue_id>`** — reports **every** space the issue's thread appears in.
- **`lwchat read <issue_id> [--space <alias>]`** — reads matching thread(s); `--space` narrows when an issue spans multiple spaces.
- **`lwchat reply <issue_id> "<msg>" [--space <alias>]`** — threaded reply. Multi-space safety: refuses to post when an issue is in >1 space without `--space`. Auto-resolves `@mentions` to `<users/<id>>` syntax (matches first name, full name, or `@all`).
- **`lwchat post <space> "<msg>" [--thread <name>]`** — new top-level message or reply to **any** thread (non-Redmine). Space accepts an alias or raw `spaces/<id>`. Aggregated mention map across all cached spaces.
- **`lwchat dm <user> "<msg>"`** — DM by email, name, or `users/<id>`. v1 limitation: requires an *existing* DM space (error message hints to open one in Chat first). See [ADR-010](docs/DECISIONS.md#adr-010-dont-request-the-chatmemberships-write-scope-for-dm-creation).
- **`lwchat search <term> [--space|--spaces|--limit|--case-sensitive]`** — client-side message search across one, several, or all configured spaces. Honest about coverage when the limit caps results.
- **`lwchat threads [--space <alias>]`** — recent threads listing, optionally enriched with Redmine status via `lwr`.
- **`lwchat index [--space <alias>]`** — bulk-scan to warm the thread cache.
- **`lwchat members [--space <alias>]`** / **`members refresh`** — name ↔ user-ID map from message annotations.
- **`lwchat cache show`** / **`cache clear`** — inspect/drop the thread-location cache (with TTL freshness flag).
- **`lwchat backup [label]`** / **`backup list`** / **`backup delete <name>`** / **`restore [name]`** — snapshot config + tokens + me.md + caches.

### Added — installer

- **`node install.mjs install`** — npm link binary, snapshot SKILL.md + recipes to `~/.lwchat/skill/`, symlink into Claude Code / Codex / Copilot / Antigravity, inject Claude `Read(~/.lwchat/**)` + `Bash(lwchat:*)` permissions.
- **`update`** — re-link, refresh skill.
- **`install-skill`** / **`update-skill`** — skills only.
- **`status`** — what's installed where.
- **`uninstall`** — remove links + `npm unlink`, preserve `~/.lwchat/`.

### Added — infrastructure

- Standalone Node ESM CLI; **zero npm dependencies**; Node ≥ 18 stdlib only.
- Own OAuth2 loopback flow (`auth login --client-id ... --client-secret ...`).
- `auth login --import-gws` convenience to reuse existing [gws CLI](https://github.com/googleworkspace/cli) credentials.
- Consolidated data directory `~/.lwchat/` ([ADR-002](docs/DECISIONS.md#adr-002-one-single-data-directory-at-lwchat)).
- Per-`(issue, space)` thread location cache with TTL + stale-but-valid fallback ([ADR-005](docs/DECISIONS.md#adr-005-cache-ttl-with-stale-but-valid-fallback)).
- Annotation-based member-name resolution ([ADR-011](docs/DECISIONS.md#adr-011-annotation-based-member-name-resolution-not-spacesmemberslist)).
- Comprehensive documentation: README, SKILL.md (agent contract), ARCHITECTURE, DECISIONS, ROADMAP, DEVELOPMENT.

### Fixed (from prototype iterations)

- **Matcher bug**: `find` / `resolveThread` previously hardcoded `issues/<id>` as a substring search, ignoring `config.redmine_url_pattern` and producing prefix false-positives (`issues/1262350` matching `126235`). Now route through `extractIssueId(text, pattern)` like `index`/`threads` already did; full-digit capture eliminates the false-positive.
- **Trailing-flag arg bug**: `lwchat reply <id> "msg" --json` previously concatenated `--json` (and any other flag) into the **posted Chat message** because flag filtering only removed `--json` from `args.includes(...)` but not from positional joining. `bin/lwchat.js` now strips known global boolean flags (`--json`, `--verbose`, `--case-sensitive`) before computing positional args, and pops known value flags (`--space`, `--thread`, `--spaces`, `--limit`) before joining `reply` / `post` / `dm` messages.
- **Multi-space silent overwrite**: when an issue lived in multiple spaces, the old cache shape (`issue_id → single location`) silently kept whichever space scanned first. Reply could land in the wrong space. Cache shape is now `issue_id → { space_alias → location }`; multi-space scans accumulate per-space ([ADR-004](docs/DECISIONS.md#adr-004-multi-space-per-issue-with-reply-refusing-ambiguous-targets)).
- **OAuth scope gap on new project**: a clean OAuth client without inherited `gws` scopes failed `me.md` generation because `userinfo.profile`/`userinfo.email`/`openid` weren't requested. Added to `CHAT_SCOPES` so new installs work out of the box.

### Changed

- **Naming locked to `lwchat`** everywhere (command, package, skill, data dir) — was previously a mix of `lw-chat` and `lwchat` ([ADR-007](docs/DECISIONS.md#adr-007-naming--lwchat-everywhere-not-lw-chat)).
- **Repo folder renamed** `~/my-works/lw-chat` → `~/my-works/lwchat`.
- **JSON shape changes** (breaking; v0 was unreleased so acceptable):
  - `find --json` now returns `{ ok, issue_id, count, locations: [...] }` (was a flat single-location object).
  - `read --json` now returns `{ ok, issue_id, count, threads: [{ space_alias, thread, message_count, messages }] }` (was a flat single-thread shape).
  - `reply --json` includes `space_alias` on success and `available: [aliases]` on multi-space refusal.

### Documentation

- New `docs/ARCHITECTURE.md` — module map, data dir layout, cache mechanics, multi-space semantics, mention engine, auth flow, install model.
- New `docs/DECISIONS.md` — ADRs covering every consequential design choice with reasoning.
- New `docs/ROADMAP.md` — current state, publishing plan (frozen-core + Linways fork), out-of-scope list, known limitations, "what to do next" guide for a future Claude session.
- New `docs/DEVELOPMENT.md` — project structure, conventions, "how to add a command" walkthrough, debugging tips, code-style.
- `SKILL.md` rewritten as the agent contract — every command, JSON shape, multi-space rule, safety guidance, links into the deeper docs.
- New `recipes/` patterns for gather-context and reply / post / dm / search workflows.

### Security

- `~/.lwchat/tokens.json` chmod 0600.
- `client_secret*.json`, `credentials.json`, `*.tokens.json` listed in `.gitignore` even though no in-repo path writes them — belt-and-braces.

[Unreleased]: https://github.com/sibinc/lwchat/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sibinc/lwchat/releases/tag/v0.1.0
