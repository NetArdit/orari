# CLAUDE REPORT 04 — Batch 3: client foundation

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

## 1. Status

**VERIFIED COMPLETE** against the acceptance criteria of `docs/agent-handoff/codex/04-batch-2-verdict.md`, "Batch 3 authorization". No live AI call. No screen of the planner was built; the page at `/app` is a plain status page that proves the foundation in a real browser. Nothing pushed or deployed.

Also done since your last verdict: your design conditions (`codex/05-design-review.md`) are applied and the two directions are with the owner, with the four questions you listed. The owner has not answered yet.

## 2. What was asked, and where each part is

1. Legacy journey extended to plan creation, exact assertions for re-plan summaries → `e2e/legacy-create.mjs` (24 checks); `docs/agent-handoff/evidence/batch-2/replan-journey.mjs` (15 checks, exact arrays, done in the previous cycle).
2. `client/` with Vite, React, Tailwind, strict TypeScript → `client/vite.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/`.
3. Typed API client → `client/src/api/types.ts`, `client.ts`, `client.test.ts`.
4. Versioned IndexedDB storage and the legacy migration → `client/src/storage/model.ts`, `store.ts`, `idb.ts`, `repository.ts`, `legacy.ts`, `storage.test.ts`.
5. Router → `client/src/router/routes.ts`, `routes.test.ts`, `useRoute.ts`.
6. Production build served at `/app` with SPA routing, `/` unchanged → `lib/app.js` (one block), `test/routes.test.js` (7 new tests).
7. Vitest for the client, `node:test` kept for the server → `npm run client:test`, `npm test`, `npm run test:all`.

Commits: `23463c9` (creation journey and shared browser helper `e2e/browser.mjs`), `2eb3900` (the foundation), plus the report commit.

## 3. Official documentation consulted before configuring

- Tailwind, "Installing Tailwind CSS with Vite" (tailwindcss.com/docs/installation/using-vite, v4.3): packages `tailwindcss` and `@tailwindcss/vite`, the plugin in `vite.config`, `@import "tailwindcss";` in the CSS. Followed exactly.
- Vite guide (vite.dev/guide, v8.3.4): Node 20.19+ or 22.12+; `index.html` at the project root as the entry; production target "Baseline Widely Available" (browsers from about mid-2023). I did not find the `base` option on that page; `base: "/app/"` is used from my knowledge of Vite and verified by the build's output and the browser journey, not from a page I read today.
- Vitest guide (vitest.dev/guide, v5.0.4): requires Vite ≥ 6.4 and Node ≥ 22.12; reads `vite.config.*` by default.
- Not consulted: React 19 documentation (nothing version-specific is used beyond `createRoot`, `StrictMode`, `useSyncExternalStore`); TypeScript 7 release notes. TypeScript 7.0.2 is a new major: it type-checks this project and rejects wrong code (section 6), which is all that is asked of it here, since Vite does the transform.

Installed versions: react and react-dom 19.3.0; vite 8.3.4; @vitejs/plugin-react 6.1.2; tailwindcss and @tailwindcss/vite 4.3.3; typescript 7.0.2; vitest 5.0.4; @types/react and @types/react-dom 19.3.0. All MIT except TypeScript (Apache-2.0). `npm audit`: 0 vulnerabilities. No router, state, form, date or IndexedDB library was added.

## 4. Design of the foundation

**Types.** `client/src/api/types.ts` imports the server's zod schemas with `import type` and derives request types with `z.input` and response types with `z.output`. Nothing from `lib/` is bundled. If a schema changes, the client stops compiling where it disagrees.

**API client.** `createApiClient({ baseUrl, fetch, aiTimeoutMs, timeoutMs })` returns `health`, `parse`, `createPlan`, `adjustPlan`. Every call resolves to `{ ok: true, data }` or `{ ok: false, kind, message, status?, fields?, retryAfterSeconds? }` and never throws. Kinds: `validation`, `rate_limited`, `busy`, `timeout`, `aborted`, `not_configured`, `ai_failed`, `offline`, `server`. The client waits 85 s on AI routes (the server gives up at 75 s) and 10 s on health. One weakness to rule on: the server answers 503 for three different situations (no key, server busy, the provider's own limit), and the client tells them apart by comparing the server's message text. A machine-readable `code` in error bodies would be sturdier; it is an additive contract change, so I did not make it.

**Storage.** A `KeyValueStore` interface (`get`, `keys(prefix)`, `commit(writes)` all-or-nothing) with two implementations: IndexedDB for the browser, memory for tests. The repository on top of it validates everything it reads with zod (stored data is treated as input), keeps the schema version in a `meta` record, refuses data written by a newer version, reports plans it cannot read without deleting them, and offers `exportBackup` / `restoreBackup` (restore validates the whole file before touching anything and replaces in one write). Keys: `meta`, `profile`, `plan:<id>`.

**Migration.** `migrateFromLegacy(repository, localStorage)` runs on every start and does something only when the new storage is empty. It reads the old keys without ever throwing on damaged JSON; if the two copies of the user differ it takes the one with more plans; if several signed-out accounts exist it returns `choose` with their names and copies nothing until one is chosen. It carries over name, education level, school, creation time, and every plan with its inputs and sessions. It leaves out the password and the e-mail. It gives a fresh id to any session whose id repeats inside a plan (the old server's `a1` collisions) and to a plan whose id repeats. A plan that fails validation is listed by subject with the failing field, and the other plans still come over. It never writes to or removes the old keys.

**Router.** `parsePath` and `hrefFor` are pure functions over a `Route` union; `useRoute` reads `location.pathname` through `useSyncExternalStore`; ordinary `<a href>` links are intercepted only for plain left clicks on `/app` addresses. Addresses: `/app/`, `/app/orari`, `/app/plan-i-ri`, `/app/planet`, `/app/planet/:id`, `/app/planet/:id/seanca/:id`, `/app/une`. About 70 lines instead of a dependency.

**Server.** When `client/dist/index.html` exists: `/app/assets/*` served with `immutable, max-age=1y` (file names carry a content hash) and 404 for a missing asset; other build files as themselves; every other address under `/app` gets `index.html` with `Cache-Control: no-cache`. Without a build, `/app` is a 404 and nothing else changes. The existing content security policy needed no change: the build has no inline script.

## 5. Evidence

- `npm test` → **141 tests, 141 pass** (was 134; 7 new for `/app`).
- `npm run client:typecheck` → clean. `npm run client:test` → **64 tests in 3 files, 64 pass**, about 1 s (api 17, storage 32, router 15).
- `npm run check`, `npm audit` (0 vulnerabilities) → pass.
- **Does the type checker bite?** A probe file with three deliberate errors against the server's shapes (an invalid plan mode, an invalid session kind, a number where a string list is required) produced three `TS2322` errors naming the server's own enum values; removed afterwards.
- **Mutation check of the client**: 20 single deliberate bugs. 18 caught. The two survivors were the same matter seen from both sides: adding the password to the migrated profile, and letting the profile schema keep unknown keys, each change nothing alone because the other guard still strips it. I added a test that pins the schema guard at all three places a profile enters storage (initialise, save, restore); with it the schema mutant fails. The other (the migration naming its fields explicitly) remains an equivalent mutant while the schema guard exists; the end-to-end assertion that the secret appears nowhere in storage covers the two together.
- **Browser, built client** (`e2e/app-foundation.mjs`, Edge 155 headless, real IndexedDB read back with the browser's own API): **26 of 26**. A never-used device writes nothing. With the old page's data (a user with password and e-mail, two plans, one with a duplicated session id): migrated on first start; storage holds exactly `meta`, `profile`, `plan:plan-1`, `plan:plan-2`; the profile equals the five expected fields; the secret and the e-mail appear nowhere in the database; every session keeps status, times, tasks and material; the duplicate id is repaired and the first keeps its id; the old keys are byte-identical afterwards; a second start copies nothing and storage is identical. Links change address and screen without a reload, Back works, a deep address opens directly, an unknown address says so. Tab reaches the first link with a visible outline and a 44 px target. At 360 px the page is 360 px wide. The old page at `/` still opens with the same user and counts its two plans. No console errors, so the security policy blocks nothing.
- **Browser, old page**: `e2e/legacy-create.mjs` **24 of 24**; re-plan journey **15 of 15**; Batch 0 baseline: all 21 screens and the keyboard walk measure identically to Batch 0.

**What the creation journey recorded about the old page** (behaviour the new client must match or deliberately improve): the form sends one field as both `materialAmount` and `goal`; malformed availability windows and unknown day codes are dropped without a word; a half-filled commitment row is dropped; the confirmation takes `goal` from its field and `materialAmount` from the AI; the AI's clarifying question is not shown when dates were found (pinned as "KNOWN GAP"); a refused request shows the server's message by `alert`, stores nothing and keeps the form's contents. Unlike re-plan, creation saves correctly.

## 6. Resource footprint (you asked for it)

- `node_modules`: 28 MB → 125 MB (+97 MB). 
- Production build: `index.html` 0.43 kB; CSS 6.36 kB (2.08 kB gzip); JS **290.11 kB (86.57 kB gzip)**; `client/dist` 293 kB on disk. Most of the JS is React and react-dom; zod is in the bundle because storage validates what it reads. Not yet split or analysed per package.
- `npm run client:build` (type-check and build): **4.3 s, peak 258 MB** working set summed over the process tree, sampled every 250 ms. Vite's own step reported 458 ms.
- Free disk: 1,970 MB before the install, 1,799 MB after it, **1,444 MB now**. The further 355 MB did not go to the project (`node_modules` is still 125 MB): I removed my leftover browser profiles and it did not come back, so it is caches outside the repository (npm's and the browser's). I have not investigated further; if disk becomes the constraint, `npm cache clean` is the first candidate and needs no approval from you but I would tell the owner first.

## 7. Deviations and judgment calls

1. **E-mail is not migrated**, as well as the password. You ruled "do not migrate the password"; I went one step further because a local profile has no use for an e-mail address and the less personal data is kept the better. It remains in the old keys until cutover. Say if you want it kept.
2. **`stats` and the `profile` echo inside old plans are not stored.** Statistics are derived from the sessions; storing them invites the disagreement the old page has between its counters. "Plans round-trip" therefore means subject, dates, mode, strategy, explanations, warnings, inputs and sessions.
3. **Tolerant reading of old sessions**: an unknown status is read as `pending`, an unknown kind as `learning`, rather than rejecting the whole plan. Dates and times are strict: a session with a bad time rejects its plan, which is then reported by subject.
4. **No router dependency** (you wrote "a router").
5. **`/app` redirects to `/app/`** (a 301 from the static file handling). Both work; the canonical address is `/app/`.
6. **`npm test` now names its files** (`test/**/*.test.js`): without that, Node's runner also picked up the client's Vitest files and failed on them.
7. **The status page's Albanian text** is temporary and will go with the page; it is not offered as product copy.
8. **Several old accounts on one device**: the code returns the list, but there is no screen yet to choose from, so such a device currently shows "Duhet zgjedhur njëra" and copies nothing. Only the signed-in or sole account is handled end to end today.

## 8. Known gaps and risks

- The IndexedDB adapter (`idb.ts`, 60 lines) has no unit test, by your instruction to keep Vitest in the Node environment; it is covered by the browser journey only (open, read, write, reopen). Failure paths in a real browser (quota exceeded, private mode, a blocked upgrade) are NOT TESTED.
- Two tabs: the old page and the new client can both be open; after the one-time copy they diverge, by design during coexistence (the old page keeps writing its own keys, the new client does not read them again). At cutover the migration has to run against the then-current old data, which the present "only when empty" rule does not do for a device that already opened `/app`. This needs a decision before cutover: re-copy at cutover and replace, or merge. I recommend re-copy-and-replace, since nothing can be created in the new client before cutover anyway.
- React components have no tests yet (there is one, the status page, exercised by the journey).
- Nothing AI-backed has been run live. Still no key.
- The bundle is 87 kB gzip before any screen exists.

## 9. Git

Branch `main`, no remote, working tree clean after the report commit.

## 10. Recommended next batch

Blocked on the owner for anything visual. What can proceed without the choice of direction, in order of value:

- **Batch 4a, domain logic for the client as pure, tested functions**: the plan merge on re-plan (the rule the old page now follows), progress and streak statistics with one stated meaning each, "today" and "next session" selection, building the request inputs from form state (including day chips and time ranges instead of free text), parsing and editing availability and commitments, an `.ics` export of a plan. Each specified per section 10 of the operating system before it is written. No UI.
- **Batch 4b, the state layer**: one store over the repository with optimistic session marking and rollback on a failed write, the create and re-plan flows as state machines (idle, working with cancel, failed with kind, done) tested against a fake API client.
- **Then, once the owner has chosen**: tokens and base components from the chosen direction, and the screens.

Questions for you: whether error bodies should gain a `code` (section 4); what cutover does on a device that has already opened `/app` (section 8); whether the bundle size needs a budget now.

## 11. Handoff

Report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/06-batch-3-report.md`. Codex has not read this yet.
