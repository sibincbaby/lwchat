# Decision records (ADRs)

> Why the design is the way it is. If a future change feels obvious but contradicts an ADR here, **read the ADR first** — it usually captures a constraint the obvious choice would break. Update an ADR (don't delete it) when its conclusion is overturned by new evidence.
>
> See [ARCHITECTURE.md](ARCHITECTURE.md) for *how* things work and [ROADMAP.md](ROADMAP.md) for *what's next*.

ADRs are numbered and dated. Older context is preserved even when superseded.

---

## ADR-001: Standalone Node CLI, not a wrapper around `gws`
**Date:** 2026-05-26 · **Status:** Accepted

### Context

The original lwchat was a Bash wrapper around the [Google Workspace CLI](https://github.com/googleworkspace/cli) (`gws`). That gave us a working tool fast but locked us to a 40 MB Rust binary the user needed installed separately, and tangled our identity with `gws` ("gws-cli" appeared as the sender label in Chat).

### Decision

Rewrite lwchat as a standalone Node.js ESM CLI that talks directly to the Google Chat + People APIs over plain `fetch`, with its own OAuth2 loopback flow. No npm dependencies. No required external tools (`lwr` is optional enrichment).

### Consequences

- **+** Single-step install (`node install.mjs install`) once published
- **+** Own product identity in Google Cloud (own OAuth client, own Chat app config)
- **+** ~600 lines of JS replacing transitive dependencies on `gws`'s 40 MB
- **−** We re-implement bits `gws` already had (token refresh, paginated message scans). Acceptable: those bits are small and our surface is narrow
- **−** Convenience for existing `gws` users: solved with the `--import-gws` shortcut

---

## ADR-002: One single data directory at `~/.lwchat/`
**Date:** 2026-05-29 · **Status:** Accepted

### Context

An earlier version split state across `~/.config/lwchat/` (config + tokens) and `~/.cache/lwchat/` (caches). Tidy by XDG standards but it made `backup`/`restore`/install paths inconsistent, and the skill snapshot had no obvious home.

### Decision

Consolidate every piece of lwchat runtime state under `~/.lwchat/` — matches the sibling tool `lw-redmine`'s `~/.lwr/` and `lw-db`'s `~/.lwdb/` convention. See [ARCHITECTURE.md §2](ARCHITECTURE.md#2-data-directory-lwchat).

### Consequences

- **+** Uninstall preserves data by simply leaving `~/.lwchat/` alone
- **+** Backup is "everything except the skill snapshot" — easy
- **+** Single permission rule covers the whole tool (`Read(~/.lwchat/**)`)
- **−** Doesn't strictly follow XDG. Tolerated — sibling tools also don't, and the consistency win across our toolset wins out

---

## ADR-003: Cache thread *locations*, never message content
**Date:** 2026-05-29 · **Status:** Accepted

### Context

The user asked whether the cache could go stale and return old messages. Real concern — but it also raised the design question of whether we *should* cache messages for speed.

### Decision

`cache/thread-index.json` stores only the **stable thread location** (space + thread ID). Message content is **always fetched live** by `read`/`reply`/`search`. The cache exists purely to avoid re-running the expensive multi-space scan on every command.

### Consequences

- **+** "Did my cache go stale?" is a non-question for messages — they can't go stale because they're never cached
- **+** Cache survives stale gracefully: thread IDs are immutable in Google Chat, so a stale location is still valid
- **+** TTL only governs when we re-scan to *catch new locations* (a thread newly cross-posted to another space) — see [ARCHITECTURE.md §3](ARCHITECTURE.md#3-the-thread-location-cache-the-most-subtle-piece)
- **−** Every `read` does at least one live API call. Acceptable — `read` is invoked deliberately, not in tight loops

---

## ADR-004: Multi-space per issue, with `reply` refusing ambiguous targets
**Date:** 2026-05-29 · **Status:** Accepted

### Context

The original cache shape was `issue_id → { single space, single thread }`. The user discovered that the same Redmine issue is sometimes cross-posted in multiple spaces (dev-analysis *and* exam-controller, for instance). The old shape silently overwrote — a `reply` could land in the wrong space.

### Decision

Cache shape becomes `issue_id → { space_alias → location }`. Every path is multi-space aware:

| Command | Behaviour with N matching locations |
|---|---|
| `find` | reports all N |
| `read` | reads all N, or one if `--space` is given |
| `reply` | N == 1 → posts; N > 1 + no `--space` → **refuses with a clear error** |
| `index` | accumulates per-space entries, never overwrites |

### Consequences

- **+** Reply hazard eliminated — the tool physically cannot land a message in the wrong space when ambiguity exists
- **+** Agents using `--json` get a list, not a guess
- **−** `read` of a multi-space issue is more verbose by default. Mitigated by `--space` to scope when you want one
- **−** Slight cache-shape upgrade path needed (handled by `normalizeLocations` which auto-converts the legacy single-entry shape on first read)

---

## ADR-005: Cache TTL with stale-but-valid fallback
**Date:** 2026-05-29 · **Status:** Accepted

### Context

Two competing goals: (a) lookups should be fast, so the cache should be sticky; (b) if an issue gets newly cross-posted to a second space after we cached it, we want to catch the new location.

### Decision

`cache_ttl_seconds` (default 300 s = 5 min) controls only when `resolveLocations` does a fresh live scan. Stale cache is **always usable as a fallback** — thread IDs don't change once created, and a network failure during the refresh scan drops back to the cache. Scan merges new findings with cached ones (scanned wins overlap; cached-only locations are preserved).

### Consequences

- **+** Frequent use within 5 min stays instant (no scan, no API call)
- **+** A newly cross-posted thread is caught within ~5 min without explicit user action
- **+** Network blips don't break `read`/`reply` for issues already cached
- **−** First lookup after the TTL window pays the full scan cost. Acceptable — that's once every 5 min in practice

---

## ADR-006: No JavaScript plugin / hook surface
**Date:** 2026-05-30 · **Status:** Accepted

### Context

While planning how to extend lwchat with org-specific behaviour (`#qa_release`/`#prod_release` templates, mention guidelines), one option was to support a plugin loaded from `~/.lwchat/plugins/*.js`.

### Decision

**No plugin/hook surface.** All org customization is expressed as **data** (config + Markdown recipes + an `org.md` overlay) that the core *reads*, not as code the core *executes*.

### Reasoning

- Nothing org-specific actually needs to *run code*. Templates and mention guidelines are advice an agent reads, not logic the CLI executes.
- A plugin mechanism that auto-loads JS from `~/.lwchat/plugins/` is an attack surface (`require()`-ing arbitrary user files).
- Markdown overlay + config keys covers 100% of the org-customization use cases identified in the design analysis.

### Consequences

- **+** Smaller attack surface, simpler core
- **+** Org customizations stay version-controllable as data files
- **−** If a customization genuinely needs executable code in the future, we'd need a different escape hatch — see ADR-009 for the escalation path

---

## ADR-007: Naming — `lwchat` everywhere (not `lw-chat`)
**Date:** 2026-05-29 · **Status:** Accepted

### Context

Mixed naming existed: command was `lw-chat`, data dir was `~/.lwchat`, package was `lw-chat`. Inconsistent.

### Decision

`lwchat` (no hyphen) everywhere — command, npm package name, skill name, data directory. Matches sibling tools `lwr` and `lwdb`'s short binary-name convention.

### Consequences

- **+** Tab-completion-friendly (one word, no shift needed)
- **+** Consistent with the `lw*` family (lwr, lwdb, lwchat)
- **−** Slightly less Google-able than the hyphenated form. Trade-off accepted

---

## ADR-008: Frozen public core + Linways fork for ongoing work
**Date:** 2026-05-30 · **Status:** Accepted

### Context

The user wants to publish lwchat to their personal GitHub for portfolio/community use, *and* continue evolving the Linways-specific use cases. Two repos with different cadences.

### Decision

1. Build the **full Linways-flavoured** lwchat in this repo (current state).
2. When stable, cut a `core` branch and trim Linways-specific values (real names, real space IDs, `#prod_release` strings, the `feedbacks/` dir, the default `redmine.linways.com` URL pattern).
3. Publish the trimmed `core` branch as the user's **personal GitHub repo** and **freeze** it.
4. Create a **separate Linways repo** as a fork from the frozen personal repo. All ongoing Linways work happens there.
5. Credit/attribution always points back to the personal repo (LICENSE, README, package.json `author`).

### Reasoning

The "frozen core" assumption removes the classic fork-merge-cost problem: with no upstream changes, there is nothing to merge back into the fork. We considered an alternative data-only overlay model but it would have required a two-step install for Linways users (core *plus* overlay), which the user vetoed. See conversation history 2026-05-30 for the full debate.

### Consequences

- **+** Single-step install for Linways users (one repo)
- **+** Public repo is a clean portfolio/showcase
- **−** If the core ever needs a security fix or bug fix later, we'd have to update both repos. Acceptable: lwchat's surface is narrow and v0.1 is intended to be stable
- **−** Linways repo carries all the install machinery a downstream fork would, even though "no one is forking it" in practice. Cost is essentially zero

---

## ADR-009: Optional executable enrichment via `enrichment_command` (deferred)
**Date:** 2026-05-30 · **Status:** Deferred (planned for v0.2 if needed)

### Context

When ADR-006 closed the door on a JS plugin surface, we left open: what if some org-specific behaviour genuinely needs to *run code*, not just read templates? Today the only such case is the Redmine-issue enrichment (which shells out to `lwr issue view <id> --json`).

### Decision (deferred)

If the need arises, add a `config.enrichment_command` key (a single shell-out template like `"lwr issue view {ref} --json"`) that replaces today's hardcoded `lwr` call. The output is fed back into `threads --json` and the doctor `integration.enrichment` check.

### Reasoning

- Keeps the core data-driven (no JS plugin surface — ADR-006 still holds)
- Lets a fork point to anything that emits JSON (`gh`, `jira`, custom scripts)
- Until then: `lib/redmine.js` is the org-specific code, and that's acceptable

### Status

Not implemented in v0.1.0 because there's no second org / second tracker to support yet. Captured here so a future implementer doesn't redesign it from scratch.

---

## ADR-010: Don't request the `chat.memberships` write scope for DM creation
**Date:** 2026-05-31 · **Status:** Accepted (revisitable)

### Context

`dm <user> "<msg>"` would ideally work even when no DM space with `<user>` exists yet. Creating a DM space requires the `chat.memberships` *write* scope, which we don't currently request.

### Decision

Request only the **readonly** memberships scope. If `findDirectMessage` returns 404, error with a clear hint: "Open a DM in Chat once, then retry."

### Reasoning

Requesting an additional write scope forces every user through another consent screen on auth and grants more authority than the tool generally needs. The friction of "open a DM in Chat once" is one-time per recipient; we judge that's better than the broader scope grant.

### Consequences

- **+** Smaller token authority footprint
- **+** Less scary consent screen on install
- **−** First-time DM to a person isn't a single step from lwchat
- This is **revisitable** in v0.2 if real usage shows the friction is too high — add the scope, re-auth users (one-time), and ship.

---

## ADR-011: Annotation-based member name resolution (not `spaces.members.list`)
**Date:** 2026-05-26 · **Status:** Accepted

### Context

`@mention` resolution needs a `name → users/<id>` map per space. The official endpoint is `chat.spaces.members.list` — but with **user OAuth** (which we use), it **does not return `displayName` for members**. It returns only `users/<id>`. Display names are only populated under app authentication (a service account).

### Decision

Build the member map by scanning past messages for USER_MENTION annotations and reading the name out of `argumentText[startIndex : startIndex + length]`. Cache the result in `~/.lwchat/cache/members.json` with a 24 h TTL.

### Reasoning

- Service-account auth would unlock `displayName` but requires Workspace admin to set up domain-wide delegation and complicates `dm`/`post` semantics
- Annotation scraping requires no extra scope or admin action and gives us the names actually used in chat (i.e. the names people would type after `@`)
- The known gap (people who have *never* been @mentioned aren't in the map) is acceptable — those people don't appear when an agent or user is composing a mention anyway

### Consequences

- **+** Works with stock user OAuth, no admin involvement
- **+** Names are the user-facing names exactly as Chat renders them
- **−** Cold-start: empty map until the cache is built. Mitigated by background build on `members refresh` or first `reply`
- **−** Coverage gap as noted above. Documented, not a blocker

---

## How to add a new ADR

1. Bump the number (ADR-012, etc.).
2. Capture **Context** (what problem), **Decision** (what we chose), **Reasoning** (why), and **Consequences** (good and bad).
3. Mark **Status**: `Accepted`, `Deferred`, `Superseded by ADR-NNN`, or `Rejected`.
4. **Never delete** an ADR. If overturned, write a new one referencing the old one and mark the old one `Superseded`.

ADRs are how a future Claude session knows what was deliberate vs what was an accident.
