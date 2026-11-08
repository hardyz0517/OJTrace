# Contest Schedule

## Goal and scope

Add an independent first-level page that combines public contest listings from Luogu, Codeforces, and AtCoder into a local-time agenda. The default view includes contests starting within 30 days, every contest whose end time is still in the future, and contests that ended within the last 7 days. It supports platform and phase filters, manual refresh, persistent per-platform cache, and links to the original contest pages.

The first release does not include reminders, favorites, participation tracking, recommendations, or a calendar grid. It does not change submission collection, timeline storage, OJ enhancements, CNOI transformation, or PDF rendering.

## Audit and source research (Phase 0)

- **Navigation and pages:** WXT discovers HTML entrypoints under `entrypoints/`. `entrypoints/shared/AppHeader.tsx` is shared by the independent `timeline.html` and `settings.html` pages. The timeline is a dedicated page and settings use a separate hash-based workspace; contest schedule can be a third entrypoint without changing routing.
- **Background, content scripts, and network:** `entrypoints/background.ts` owns submission sync and runtime messages. Site-specific submission adapters live under `src/adapters/`; the OJ enhancement content scripts have their own entrypoints. Contest collection must stay outside both paths. Contest providers will be standalone and call the public sources from the schedule page.
- **Persistence:** `browser.storage.local` is the existing extension-local persistent store. Timeline data is stored under `ojtrace:data`; contest caches will use three separate keys, so timeline schemas and submission records remain untouched.
- **Timeline data:** `StoredData.submissions`, `syncStates`, and `activitySchedules` are timeline/sync concerns. No contest data will be added to `StoredData`.
- **Codeforces source (verified 2026-11-04):** `GET https://codeforces.com/api/contest.list?gym=false` returned HTTP 200 JSON (`status`, `result[]`) with `id`, `name`, `phase`, `startTimeSeconds`, and `durationSeconds`. Time fields are Unix seconds. The live response contained future contests and is sorted by source-defined ordering, so the unified layer sorts independently.
- **AtCoder source (verified 2026-11-04):** `GET https://atcoder.jp/contests/` returned HTTP 200 HTML. `#contest-table-action`, `#contest-table-upcoming`, `#contest-table-daily`, and `#contest-table-recent` contain rows with `/contests/{id}` links, `time.fixtime-full` values carrying a `+0900` offset, `HH:MM` duration (including values over 24 hours), and a rated-range cell. This page is the source; selectors and parsing stay inside the AtCoder provider.
- **Luogu source (verified 2026-11-04):** `GET https://www.luogu.com.cn/contest/list` returned HTTP 200 HTML with `script#lentille-context` JSON. `data.contests` exposes `perPage: 20`, `count`, and `result[]` rows containing numeric `id`, Unix-second `startTime`, Unix-second `endTime`, and `name`. The page uses `?page=N`; an observed `perPage` query did not change the 20-row page size. Provider pagination is bounded to avoid dozens of requests per refresh.
- **Luogu problem count (verified 2026-11-05):** the same public `result[]` records also contain `problemCount`; a live sample returned counts 4, 4, 4, 13, and 7 for the first five contests. The parser now keeps only positive safe integers, so absent or malformed values stay unknown and require no extra request.
- **Luogu evaluation marker (verified 2026-11-05):** public list records contain a numeric `rated` bitmask. The current public frontend bundle defines `RATED=1`, `ELO_RATED=2`, and `ELO_DONE=65536`; live list DOM showed no trophy at `rated=0`, a green trophy at `rated=1`, and a gold trophy when the ELO bit is present (for example, `rated=3`). Contest Schedule normalizes the first two participation flags in the Luogu Provider and shows a combined accessible label for records carrying both.
- **Permissions:** Luogu is already a required host permission. Codeforces and AtCoder are already declared optional host permissions; the page requests them together only after the user clicks refresh. The manifest permission set does not need to grow.

## Module map and responsibilities

| Path                                                     | Responsibility                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/features/contest-schedule/core/types.ts`            | Shared platform, contest, phase, cache and provider result types.                                                          |
| `src/features/contest-schedule/core/contest-status.ts`   | Derive phase and enforce time-window boundaries from start/end timing.                                                     |
| `src/features/contest-schedule/core/contest-filter.ts`   | Deduplicate by platform plus ID, filter by platform/phase and sort by start time.                                          |
| `src/features/contest-schedule/core/contest-manager.ts`  | Load caches and refresh providers independently; a failed provider never overwrites its prior cache.                       |
| `src/features/contest-schedule/providers/*`              | Isolated requests and parsing for each public OJ source.                                                                   |
| `src/features/contest-schedule/storage/contest-cache.ts` | Validated per-platform `browser.storage.local` cache entries.                                                              |
| `entrypoints/contest-schedule/*`                         | Independent first-level agenda page, filtering, refresh, and display; uses the Timeline shell and compact filter controls. |
| `entrypoints/shared/AppHeader.tsx`                       | Minimal navigation link and page-transition integration.                                                                   |

The cache stores epoch milliseconds for timestamps (converting source Unix seconds at provider boundaries), duration in seconds, source phase when present, fetched time, and optional AtCoder rated range. Phase is recomputed from local current time whenever the schedule is shown. Missing end timing is not guessed; an upcoming row can still be shown with an incomplete-timing label, while a past row with no reliable end cannot be placed into the recent-history window.

## Plan and task status

### Phase 0 — audit and design: complete

- [x] Inspect navigation, entrypoints, background/content scripts, network stack, and persistence.
- [x] Inspect timeline-specific data boundaries.
- [x] Probe all three public contest sources and confirm fields, timestamps, and pagination.
- [x] Establish isolated modules and separate cache keys.

### Phase 1 — data layer: complete

- [x] Add unified types, time-window/status logic, filtering, provider manager, and cache.
- [x] Add and test the three independent providers, including pagination and malformed response handling.
- [x] Test window boundaries, long-running contests, independent failures, and cache preservation.

### Phase 2 — page and navigation: complete

- [x] Add the schedule HTML/React entrypoint and first-level navigation item.
- [x] Add local-date agenda groups, OJ/status filters, original-site links, cache timestamps, and per-provider state.
- [x] Add user-initiated permission requests for optional site access and a disabled-while-refreshing action.
- [x] Add narrow viewport layout and page-transition integration.

### Phase 3 — acceptance: complete

- [x] Run targeted provider tests, typecheck, lint, and production build.
- [x] Run the full test suite, formatting check, architecture/manifest audits, and inspect the resulting manifest permission set.
- [x] Recheck the live-source parsers and timeline/settings entrypoints.

## Tests and current results

- Live read-only source probes completed on 2026-11-04: Codeforces 200 JSON, AtCoder 200 HTML, Luogu 200 HTML with embedded JSON and page metadata.
- Automated provider/core tests: 8 passed; schedule UI tests: 3 passed; timeline and settings regression tests: 14 passed.
- Initial implementation full suite: 1170 passed, 1 skipped across 115 files.
- Typecheck and feature-scoped lint: passed.
- Production build: passed; it reports existing dependency directive and chunk-size warnings.
- Architecture and manifest permission audits: passed. The new `contest-schedule.html` entrypoint is emitted and the optional host permission set is unchanged.
- Formatting and diff checks for the updated feature and documentation: passed.

### UI alignment follow-up

- [x] Match the Timeline page's centered white shell and spacing.
- [x] Remove the duplicated page title/eyebrow and use the shared compact OJ/status dropdowns.
- [x] Keep update information and refresh action in the same filter toolbar.
- [x] Add UI regression checks for the shared shell, compact filters, and absence of the duplicate heading.

### Agenda, time, and problem-count follow-up (2026-11-05)

- [x] Audit the existing Core, provider, cache, UI, and refresh paths before editing.
- The existing independent page, three providers, OJ/status filters, manual refresh, and per-platform cache were already in place and remain the foundation. The review identified a single flat sort, time-plus-duration display, no problem-count enrichment, and refresh feedback that did not distinguish partial from total failure; those gaps were addressed within Contest Schedule Core, its OJ providers, and its page.
- [x] Verify Codeforces `problemset.problems`: one batch response returned 11,495 problem rows with contest IDs; the current official `contest.list` had 2,025 finished contests represented in that mapping. The newest mapped finished examples had 7, 7, 7, 7, and 10 distinct problem indices. A standings probe with extra pagination parameters returned HTTP 400 because anonymous standings only permits the unparameterized request; standings is not used because it would require one request per contest.
- [x] Verify AtCoder Problems datasets: `contests.json` had 6,650 rows, `problems.json` 9,890 rows, and `contest-problem.json` 41,005 explicit contest/problem relations. Recent ARC sample mappings produced 4–6 unique problem IDs. Count enrichment consumes the explicit relation file and deduplicates problem IDs; it does not infer counts from titles or indices.
- [x] Keep Codeforces and AtCoder counts optional and asynchronous, with provider-local parsers and a six-hour cached refresh timestamp. Luogu counts come directly from the contest-list records. Missing/unpublished counts remain absent; count-provider errors do not fail the contest refresh.
- [x] Replace the global list sort with Core-owned running/upcoming/recently-ended sections and date grouping. Running sorts by end time, upcoming by start time, and finished by end time descending. Phase is recomputed from epoch timestamps on each render.
- [x] Add local-time full start/end formatting; duration-derived end time takes precedence. Missing end times are shown as incomplete.
- [x] Tighten agenda spacing, unify status labels, remove the redundant range note and permanent source status row, keep whole-row source links, and add on-demand partial-failure details.
- [x] Run feature, UI, full-suite, type, format, architecture/manifest, and production-build verification.

### Verification results (2026-11-05)

- Contest Schedule Core/UI and messaging tests after Luogu count parsing: 39 passed across 3 files.
- Full suite from the preceding verification: 1,223 passed, 2 failed, 1 skipped across 123 files. Both failures are in `tests/ui/timeline-copy.test.tsx`, where the test cannot find its expected filter button; the Contest Schedule tests pass. No timeline changes were made as part of this follow-up.
- TypeScript typecheck, Contest Schedule lint, targeted Prettier check, architecture audit, and manifest permission audit: passed.
- Production build: passed and emitted `contest-schedule.html` plus its CSS/JS chunks. Existing dependency-directive and large-chunk warnings remain.
- Built manifest retains the existing optional host permission set; the manifest audit passed against the completed build output.
- Luogu count follow-up: typecheck, production build, feature lint, formatting, architecture/manifest audits, and the 39 targeted tests passed.
- Luogu metadata follow-up: added a cache data-version marker so pre-change caches trigger one non-blocking refresh on page entry; records now retain the normalized rating/estimate flags and the matching gold/green trophy marker. Live page DOM confirmed the list itself shows problem counts such as `4题` and `13题`. Typecheck and 41 schedule/messaging tests passed after these changes.

## Known limitations and follow-up

- Luogu currently exposes 20 rows per page and does not honor an observed `perPage` query. The first release caps pagination to five pages (100 rows) per refresh; source ordering and the time filter prioritize the current/future window, but a very old, unusually long-running contest beyond the page cap could be omitted. If this becomes a real case, investigate a documented source-side date filter or safe request budget before raising the cap.
- Optional Codeforces/AtCoder permissions are needed for cross-origin fetches. Existing cached data remains readable without those grants; manual refresh requests missing origins from the user gesture.
- AtCoder publishes no structured official JSON contest endpoint on the tested listing page; its HTML parser is provider-local and should be adjusted if that page changes.
- OJ pages can be unavailable, rate-limited, or structurally changed. Refresh errors are isolated, shown per source, and do not erase that source's last successful cache.
- Manual refreshes are serialized by the page and the manager applies a short per-source cooldown (2 seconds for Codeforces, 500 ms for the HTML sources) to avoid accidental request bursts.
