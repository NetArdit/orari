# CLAUDE REPORT 06 — Batch 5 results, and three owner decisions that change the plan

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

This report has two parts. Part A is Batch 5, which is complete. Part B is more important: while Batch 5 was running the owner answered the open questions, and two of the answers overturn assumptions we were building on. Part B needs your architecture ruling before any further code.

---

# PART A — Batch 5

## A1. Status

**VERIFIED COMPLETE** against `docs/agent-handoff/codex/07-batch-4-verdict.md`, "Batch 5". No screen, no live AI call, no PDF dependency, no cutover.

## A2. Commits

- `7504dfe` New plans never overwrite existing ones; safe calendar UIDs; no-study-day check. `client/src/storage/repository.ts`, `client/src/state/planStore.ts`, `flows.ts`, `client/src/domain/ics.ts`, `planForm.ts`, tests.
- `1e6dcd5` Re-plan: today is planned only from the current time on. `lib/time.js`, `lib/plan.js`, `lib/schema.js`, `lib/app.js`, `public/script.js`, `client/src/domain/replan.ts`, `clock.ts`, tests, the re-plan journey.
- `1f4a576` Two real tabs: storage journey through a harness page built only with `E2E=1`. `e2e/app-two-tabs.mjs`, `e2e/browser.mjs` (`newTab`), `e2e/build-harness.mjs`, `client/e2e-harness.html`, `client/src/e2eHarness.ts`, `client/vite.config.ts`.

## A3. What each condition became

1. **Plan-id collisions.** `repository.createPlan` writes with `onlyIfAbsent: [plan key]` inside the transaction and throws `PlanExistsError`; `savePlan` remains the deliberate replace for an existing plan. `store.addPlan` retries under another id (up to 5) and returns the id used; the create flow reports that id. Tests: a taken id in this tab; a plan another tab stored a moment ago; two simultaneous creates; no free id; a failed write.
2. **Calendar UID.** `uidFor` keeps `[A-Za-z0-9.-]` and replaces every other character by `_<code point>_`, which is one-to-one. Test: an id containing CR, LF, `ATTENDEE:` and `SUMMARY:` produces one `UID` line, one `SUMMARY` line and no injected property.
3. **Current time on re-plan.** `progress.now` (optional, a time of day, validated and tidied like every other time). `clipDayFrom` cuts the first day's windows; a window in progress keeps what is left if that is at least 20 minutes. Without `now` the behaviour is as before. Tests: before, during and after windows at function, plan and route level; a session earlier than now is dropped and reported; nothing left on the last day → 400 `NO_FREE_TIME` without calling the AI. Both clients send it; the re-plan journey checks the old page does (16 of 16).
4. **Two real tabs.** `e2e/app-two-tabs.mjs`, Edge 155, one profile, two tabs, the app's own repository over IndexedDB through a harness page that exists only in an `E2E=1` build: **8 of 8**. Twenty rounds each, with the start of one tab varied by a few milliseconds so both orders occur:
   - first set-up: every round exactly one tab won, the other got `already_set_up`, storage held the winner's data alone (A won 1, B won 19);
   - new plan under a taken id: one stored whole, the other `plan_exists` (A 1, B 19);
   - restore against a simultaneous save: no old plan ever survived and no restored plan was ever missing; the save landed after the restore 11 times and before it 9 times;
   - the app itself opened in two tabs on a device with the old page's data: both ready, one copied, the other found it done, same two plans, no password in storage.
   A normal build has no harness page (checked: `client/dist` holds `index.html` and `assets` only).
5. **No schedulable time.** `studyDatesIn(form)` counts the dates on which study is possible by the days set and the days without study, using the server's rule for unset days. Zero is refused on the availability control. It does not subtract busy time, so it catches "certainly nothing", not "nothing after commitments": that still comes back from the server as `NO_FREE_TIME`. A test confirms the server agrees on the same inputs.

## A4. Evidence

`npm test` 163 of 163. `npm run client:typecheck` clean. `npm run client:test` 174 of 174. `npm audit` 0. Journeys on the final code: app foundation 26 of 26, old-page creation 24 of 24, old-page re-plan 16 of 16, two tabs 8 of 8. Production JavaScript 87.39 kB gzip.

Your remark that a save committing after a restore appears beside the restored plans is correct and is now a recorded, accepted outcome of the two-tab journey (it is one of the two valid orders).

Deviation: the harness page and `client:build:e2e` script are additions you did not list by name; they were the only way to drive the real adapter from two tabs without putting test hooks into the normal build.

---

# PART B — Owner decisions of 2026-10-14

The owner wrote three messages (translated from Albanian; originals in my session):

1. "Orari is the name, and here is the API key." The key is in `orari-main/.env`, which git ignores; it appears in no tracked file and no commit (checked). **Please do not open `.env`.**
2. "Dark or light theme, or Fletore, Tabelë: leave them all in settings but name them differently, and the user chooses and changes it as they wish; you can name it brown/blue theme, dark/light, or however you find most reasonable. And no, make it with a user, because for example if the laptop has no battery they must open it on the phone. And do not forget the login and forgot-password part; I mentioned these earlier too. I want you to work as real engineers, not only coders who just do the job and check that the request works; no, I want engineering and then implementation. Do not forget the roles and tasks divided between you."
3. "I also want the design to be amazing; I do not want it to look like a standard AI design. Research, find across sites, look and think about what would make the application more attractive and better to use, then analyse, adapt and implement in this project. I want good performance and a truly super-satisfying solution for students, not just a basic project."

## B1. What this changes

| Was | Now |
|---|---|
| Name undecided | **Orari** |
| Owner picks one of two directions and a default theme | **Both styles and both modes ship**, chosen by the user in settings, renamed |
| Working assumption: local profile, no password, export/import | **Real accounts**: sign-up, login, forgot password, the same data on laptop and phone |
| Design directions as produced | **Research real products first**, then design; must not read as generated |
| No live AI possible | A key exists; live verification is possible once you authorise it |

What survives from Batches 3 to 5: the API client, router, domain rules, plan form, flows, error codes and the server fixes are unaffected. The IndexedDB repository changes role, from the place where data lives to a per-account cache on the device; its atomic-write design is still what a cache needs. The one-time copy from the old page's localStorage becomes "offer to import this device's plans into the account". The backup file becomes account data export.

What is now wrong in the records: "D1 working assumption: local profile without password" in `CODEX_DECISIONS.md` and `PROJECT_STATE.md` is superseded by the owner.

## B2. Accounts: the engineering questions, with my recommendations

The operating system (section 11) says no database, authentication or external service without a justified requirement and explicit approval. The owner has now given both the requirement and the approval for accounts. Zero cost remains absolute. Evidence labels: what I measured or read today is marked; the rest is engineering judgment.

**Q1. Where does the data live?**
- (a) PostgreSQL on Neon's free tier. The owner already has a Neon account from another project. Works with any host, survives redeploys. Needs a connection string the owner creates.
- (b) SQLite through `node:sqlite`, which is built into this Node (VERIFIED: `node:sqlite` loads on Node 24.20 here). No dependency, no account, ideal for development and tests. In production it needs a host with a persistent disk, which free hosts mostly do not give.
- (c) One engine in both places versus two: two SQL dialects are a known source of "works locally, fails hosted" defects (on the owner's other project an embedded Postgres hid a timezone bug that a real server showed).
- Recommendation: **PostgreSQL as the only engine**, behind a small repository interface in `lib/`; route and logic tests against an in-memory implementation of that interface; a separate suite that runs the SQL against a real Postgres when a `PG_TEST_URL` is provided, required before any release claim. Driver: `pg` (MIT). Migrations as numbered SQL files applied by a script, no ORM.

**Q2. Where does it run?** This decides whether the whole thing works, and I have not verified it today.
- The AI routes hold a request for up to 75 seconds. Serverless function hosts cap request time far below that on free plans (the owner's usual host is Netlify). A long-running Node process is needed, or the AI calls must become jobs the client polls.
- Free long-running hosts usually sleep when idle and wake slowly.
- Recommendation: before designing further, a short research task with official documentation: request-time limits, sleep behaviour, persistent storage, custom domain and HTTPS on the realistic free options, and a proposal that fits zero cost. If no free host carries a 75 s request, convert plan generation to "start job, poll status", which also gives honest progress and survives a phone going to sleep. I suspect this conversion is the right design regardless, but I will not assert it without measuring model times with the key.

**Q3. Passwords.**
- OWASP Password Storage Cheat Sheet (read today): Argon2id preferred; where unavailable, scrypt with a minimum of N=2^17, r=8, p=1, or the equivalent sets N=2^16/p=2, N=2^15/p=3, N=2^14/p=5; a unique salt per password; a pepper as optional defence in depth.
- MEASURED on this machine with Node's built-in `crypto.scrypt`: N=2^15, r=8, p=3 takes 272 ms; N=2^17, r=8, p=1 takes 587 ms and needs about 128 MB per hash.
- Recommendation: **built-in scrypt, N=2^15, r=8, p=3** (an OWASP-accepted set, about 32 MB per hash, no native dependency to compile on a small host), parameters stored in the hash string so they can be raised later with rehash-on-login, a cap on concurrent hashing so a burst of logins cannot exhaust memory, minimum length 8 with no composition rules, maximum 128, rejection of the most common passwords from a short built-in list. Argon2id would need a native or WASM package; I would add it only if you prefer it over the built-in.

**Q4. Sessions.**
- Opaque random token (32 bytes) in a cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`. Only its SHA-256 is stored. Thirty days, renewed on use; listed and revocable ("dil nga të gjitha pajisjet"); rotated at login.
- CSRF: `SameSite=Lax` plus an `Origin` check on every state-changing request; the API is JSON-only.
- Not JWT in localStorage: readable by any script on the page and not revocable.

**Q5. Forgot password** (OWASP Forgot Password Cheat Sheet, read today).
- Same answer and same timing whether or not the address exists. Token from a CSPRNG, single use, short expiry (I propose 30 minutes), only its hash stored, tied to one user. The link built from a configured site address, never from the request's Host header. After a reset: no automatic login, every session ended, a notification e-mail, outstanding reset links invalidated. Rate limits per address and per account; never lock an account because someone requested resets.
- **E-mail sending** is a new external service. The owner has a Brevo account (free tier) from another project. It needs an API key and a sender address from the owner. In development the message is written to the log, not sent. Without a working sender there is no password reset, so this is a hard dependency on the owner.
- E-mail verification at sign-up: recommended (a mistyped address makes reset impossible forever) but not blocking use of the app before the link is clicked.

**Q6. Sync between devices.**
- The server is the source of truth for a signed-in user. The device keeps a cache (the existing repository) so the timetable opens instantly and can be read offline.
- Plans are documents with a version number; a change sends the version it was based on and is refused if it is stale. Marking a session is its own small request ("this session, this status, at this time"), applied by last-writer-wins per session, so ticking on the phone and on the laptop never conflicts at plan level.
- Offline: reading works; marks are queued and sent on reconnect; creating or adjusting a plan needs the network anyway.
- This replaces "two tabs racing on one database" with "two devices racing on one account". The domain merge rules already written apply unchanged on the server side of that race.

**Q7. This device's existing plans.** On first sign-in on a device that has the old page's data (or new-client local data), offer once: "Ke plane në këtë pajisje. T'i shtojmë te llogaria jote?" Never upload the old plaintext password. Remove the old keys only after a confirmed import, per your cutover ruling.

**Q8. What accounts make possible and necessary.** AI routes require a session, so limits become per account instead of per address (fairer for a school sharing one address). Account deletion and data export become obligations: Kosovo has a personal-data protection law modelled on the GDPR (INFERRED from memory, not verified today; to be checked against the official text before release). A short privacy notice is needed before sign-up collects an e-mail address.

**Q9. Style and theme as settings.** Two independent choices, stored in the account and cached on the device so the page does not flash the wrong look before sign-in resolves:
- Stili: the two directions. The owner suggests colour names. Candidates: "Kafe" (the warm paper one) and "Blu" (the cool one), or keeping "Fletore" and "Tabelë".
- Pamja: "E çelët", "E errët", "Si pajisja".
- Engineering cost: every screen is verified in four combinations, and the two styles differ in more than colour (type, how time is set, how blocks are drawn), so tokens alone will not carry it; components need a small number of style-dependent variants. A default is still needed for a first visit: I propose Kafe with "Si pajisja".

## B3. Design: the owner wants research before design

The two directions I made were produced without studying real products. The owner asks for exactly that study. Proposed as its own batch, with no code:

- Look at real, shipped products students and planners use (study planners, calendar and task apps, flashcard apps), on phone widths first: how they show "today", how they show a week, how they make marking a session feel, how they handle empty and failed states, onboarding, and what they do that we can honestly do with our features.
- Deliverable: a findings document with sources and screenshots or precise descriptions, a list of patterns to adopt and patterns to avoid with reasons, and a revised design proposal (both styles) that you review before the owner sees it.
- Performance as a design constraint from the start: a budget for first load on a phone on a slow connection, measured in the journeys, alongside your 200 kB JavaScript budget.

## B4. Proposed order of work (for your ruling)

1. **Hosting and architecture research** (Q2), read-only, short: it can invalidate everything else if skipped.
2. **Design research** (B3), read-only, in parallel with 1.
3. **Live AI verification with the owner's key**, small and bounded: one parse and one short plan, to learn real response times and whether the model list in `lib/ai.js` still exists. This informs the job-versus-request decision in Q2. Needs your authorisation; your batches so far excluded live calls.
4. **Accounts backend** in reviewable steps: data layer and migrations; sign-up, login, logout, sessions; forgot and reset password with e-mail behind an interface; then plan storage and sync API. Each specified per section 10 of the operating system before it is written.
5. **Client**: sign-in, sign-up, reset screens and settings (style, mode), then the planner screens, from the researched design.
6. Flashcards and quizzes after planner parity, as before.

## B5. What I need from the owner, through you or directly

- A Neon database (they create it and put `DATABASE_URL` in `.env` themselves) when step 4 reaches the hosted database; not needed for tests.
- Brevo API key and sender address for password reset, same handling.
- Where they intend to host, if they have a preference.
- The three product questions from your last verdict (late session action, partial sessions and streaks, skipped sessions and re-planning) are still unanswered.

## B6. Gate

Batch 5 delivered. No accounts code has been written. Waiting for your verdict on Batch 5 and your architecture rulings on Part B.

Report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/08-batch-5-and-owner-decisions.md`.
