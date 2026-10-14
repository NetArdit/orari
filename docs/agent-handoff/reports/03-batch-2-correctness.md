# CLAUDE REPORT 03 — Batch 2: correctness and reliability

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

## 1. Status

**VERIFIED COMPLETE** for all ten items, with one finding you need to know first:

**The browser journey found a defect neither audit had: "Rregullo planin" saved nothing.** The page showed "Plani u rregullua" and threw the new plan away. `findPlan()` parsed one copy of the user from storage, the handler changed the plan inside that copy, then wrote back a second, untouched copy (`public/script.js`, baseline lines 1024 and 1033 against 1074). So my P0-1 description ("re-plan deletes today's completed sessions"), which you confirmed from the source, described what the code intended, not what it did: nothing was deleted because nothing was saved. Both are now fixed and evidenced separately (section 5). I read that code in the audit and missed it; the lesson I take is that the old page's flows need to be run, not read, before the new client copies their behaviour.

No live AI call was made. Nothing was pushed or deployed.

## 2. Approved task

`docs/agent-handoff/codex/03-batch-1-verdict.md`, "Batch 2": ten items, one focused commit each, suite green between commits; no UI work, no migration, no account redesign, no live AI. Batch 1 conditions: README wording about the check script; Node 22 as intentional policy.

## 3. Commits (each with the suite green before it was made)

- `ca21017` Batch 1 conditions: README says what `npm run check` covers; Node 22 stated as the supported minimum.
- `f0e074e` **P0-3** impossible dates. `isValidDateStr` requires the date to format back to itself; the schemas use it. `lib/time.js`, `lib/schema.js`, `lib/app.js`.
- `a451baf` **P0-1 (server)** session ids are `crypto.randomUUID()`. `lib/app.js`.
- `a319a24` **P1-3** sessions sorted; a session overlapping an earlier kept one, or under 20 minutes, is dropped with its reason logged. `lib/plan.js`, `lib/time.js` (exports the constant).
- `5845ea0` **P1-4** honest warning with the count; zero usable sessions → 502 on both routes; adjust refuses a finished plan and a plan with no free time left, each with its own message, before calling the AI. `lib/app.js`.
- `d4398e8` **P1-5** overnight commitments: evening half on the start day, morning half on the next, for weekday lists and date lists. `lib/time.js`.
- `ad479f9` **P1-6** `9:00` accepted and stored as `09:00`; a free window must end after it starts; validation errors gain `fields: [{ path, message }]`; `timeToMinutes` no longer accepts `24:xx`. `lib/schema.js`, `lib/app.js`, `lib/time.js`.
- `6232c2f` **P0-5, P2-11** rate limit, concurrency cap, list limits, security headers. `lib/app.js`, `lib/schema.js`, `package.json`, `package-lock.json`.
- `bdd9325` **P1-1** one 75 s deadline for a whole AI job, 504 with its own message, cancellation when the browser leaves; `createAi({ client, models, deadlineMs, sleep })`; `test/ai.test.js`. `lib/ai.js`, `lib/app.js`.
- `4f4f0b9` **P1-13** optional `clientDate` and `timeZone` on `/api/parse`; the old page sends both. `lib/schema.js`, `lib/time.js`, `lib/ai.js`, `lib/app.js`, `public/script.js` (one request body).
- `69ea172` **P0-1 (page)** re-plan saves its result and keeps every session the user has marked. `public/script.js` only, plus the journey evidence.
- `d01f0c1` Tests: bounded waits and a 30 s per-test timeout (section 6 explains why).
- The commit carrying this report also removes one redundant line from `lib/ai.js` (section 6, "the survivor").

Size against Batch 1 (`git diff --stat 0295366 HEAD -- lib public server.js package.json`): 7 files, 462 insertions, 100 deletions. `server.js`, `public/index.html`, `public/style.css` untouched.

## 4. What changed for the user and for the contract

**User-visible on the existing page**
- "Rregullo planin" now actually replaces the pending part of the plan and keeps everything already done.
- A plan can no longer contain two sessions at the same time or a five-minute session; sessions arrive in time order.
- When the AI's sessions do not fit, the warning says how many were removed instead of "u rregulluan"; if none fits, the user gets an error and no empty plan is saved.
- A night shift blocks the right morning.
- `9:00` in the availability boxes works.
- "nesër" is resolved from the user's own date.
- After 75 s the user is told the AI is slow, instead of waiting for minutes.
- Too many requests → a clear message.

**API contract (all additive or within your rulings)**
- `sessions[].id`: UUID string instead of `s1`/`a1` (your ruling). Ids already stored by clients are untouched; the page treats ids as opaque.
- Validation 400s: same `error` and status, plus `fields`.
- `/api/parse` request: optional `clientDate`, `timeZone`.
- New statuses: 429 (rate limit), 503 with `Retry-After: 15` (server busy), 504 (deadline), 502 with a new message when no session is usable, 400 with new messages for a finished plan and for no free time on adjust.
- Stricter than before, deliberately: impossible dates, free windows ending before they start, `24:xx`, lists over their limits (8 windows per day, 40 commitments, 60 dates per commitment, 180 unavailable dates, 7 availability entries; AI answers: 600 sessions) are refused. An old stored plan whose `structured` contains a reversed free window would now get a 400 with the field named when adjusted; before, it was silently read as two windows.
- New Albanian messages (please read them as copy): "1 sesion që propozoi AI u hoq sepse nuk përshtatej me kohën tënde të lirë." / "N sesione që propozoi AI u hoqën sepse nuk përshtateshin me kohën tënde të lirë."; "AI nuk arriti të vendosë asnjë sesion brenda kohës sate të lirë. Provo përsëri."; "Ky plan ka përfunduar, nuk ka më ditë për t'u rregulluar. Krijo një plan të ri."; "Nuk ka mbetur kohë e lirë deri në fund të planit. Krijo një plan të ri me afat më të gjatë ose me më shumë kohë të lirë."; "Ke bërë shumë kërkesa njëra pas tjetrës. Prit pak minuta dhe provo përsëri."; "Shërbimi është i zënë për momentin. Provo përsëri pas pak."; "AI po vonon më shumë se zakonisht. Provo përsëri pas pak."; field messages "Data nuk është e vlefshme.", "Ora duhet të shkruhet si 08:30.", "Ora e mbarimit duhet të jetë pas orës së fillimit.", "Zona kohore nuk njihet.", "Kjo fushë mungon.", and three generic ones.

**Policy constants, all explicit and tested**: rate limit 30 AI requests per client address per 10 minutes; 4 AI requests in flight for the whole server; deadline 75 s; minimum session 20 minutes. They are `createApp`/`createAi` options. The first two are my choice of numbers; say if you want others.

**Dependencies**: `express-rate-limit` 8.7.1 and `helmet` 8.3.0, both MIT, 177 KB and 125 KB installed. `npm audit`: 0 vulnerabilities.

## 5. Evidence

**Unit and integration tests.** `npm test` → **134 tests, 134 pass, 0 fail** (ai 23, plan 14, routes 46, schema 23, time 28). `npm run check` passes. **No `KNOWN DEFECT` test remains**: all 16 were reversed in the commit that fixed their defect (one, `24:30`, was a P3 I fixed in passing inside P1-6 because the same regular expression was being edited). None calls the network beyond 127.0.0.1.

What the new tests cover beyond the reversals: date validity at every entry point including AI answers; UUID shape and uniqueness across create and two adjustments; overlap, touching sessions, identical sessions, the 19/20-minute edge, ordering; singular and plural warning; the last day of a plan is still adjustable; overnight commitments by weekday and by date, an every-day overnight sleep, a one-night sleep; normalisation and trimming of times; exact `fields` output and that zod's English never appears; every list at its limit and one over; headers on pages, API answers and 404s, the policy allowing exactly what the page loads, no HSTS and no `upgrade-insecure-requests`; rate limit across the three routes with the AI not called and other routes unaffected; concurrency cap with a held request, release on finish and on validation failure; 504 mapping on all three routes; browser cancellation reaching the AI function and freeing the slot; the model walk (rate-limit wait and retry, provider hint capped at 5 s, outage/404/402/network error moving on, 401 stopping, retry without JSON mode, two full walks then failure); the repair loop (not JSON, wrong shape, impossible date, empty plan, empty answer, empty parse); deadline cutting a stalled call and a rate-limit wait; pre-aborted caller costing no call; local date by time zone across midnight and winter time.

**Mutation check.** Thirty-one single deliberate bugs in the Batch 2 code, one at a time, suite run, file restored (compared byte for byte afterwards). Results: see section 6 for the full list and the one that exposed a weak test.

**Browser, real page** (Edge 155 headless, `docs/agent-handoff/evidence/batch-2/replan-journey.mjs`; synthetic plan with eight sessions named for what must happen to them; `fetch` for the two AI routes replaced in the page by canned answers; real buttons pressed; storage read back). Three runs, result files beside the script:
- `replan-journey-before-fix.json`, page as it was: **9 of 14**. Stored plan identical to before the re-plan; strategy still the old one.
- `replan-journey-old-merge-rule.json`, save fixed but the original merge rule: **12 of 14**. Stored: past completed, past missed, two new. Today's completed, partial and skipped sessions and a completed future session are gone. This is the defect as I had described it.
- `replan-journey.json`, both fixes: **14 of 14**. All six marked sessions kept with their status; the two pending ones replaced by the two new ones; no duplicate id; both storage keys in sync; ticking a new session changes that session only; the parse request carries `clientDate` equal to the browser's date and its `timeZone`; no console errors.

**Page under the new headers.** The Batch 0 baseline script rerun against the server with helmet: measurements identical to Batch 0 on all 21 screens, one console error (the deliberate corrupted-storage case), no failed requests, so the policy blocks nothing the page loads. Rerun on the final code: all 21 screens and the keyboard walk measure identically to Batch 0; the corrupted-storage case shows the same error with one difference, the line number in its stack trace (`script.js:1178` became `script.js:1188` because the file gained ten lines). The re-plan journey on the final code: 14 of 14.

**NOT TESTED**: anything with a real provider (the abort actually cancelling an OpenRouter request, real model ids, real timings); behaviour behind a reverse proxy (`trust proxy` is not set, documented in the code: behind a proxy all visitors would share one rate-limit bucket); screen reader; other browsers.

## 6. Mutation results and what they changed

Caught (the suite failed) — 30 of 31, and the one survivor was redundant code, now removed:
date round-trip removed (9 failures); overnight morning half on the same day (3); sleep override from the previous day (1); overlap check removed (2); overlap with `>=` (1); minimum length removed (2); no sorting (4); counter ids (3); empty plan as success (1); finished-plan check removed (1) and off by one (1); adjust zero-capacity check removed (1); `fields` dropped (3); one-digit hours rejected (3); no zero-padding (3); reversed window allowed (4); commitment limit removed (1); time zone not validated (2); rate limiter not applied (1); concurrency cap not applied (1); slot never released (32); CSP allowing any script (1); HSTS on (1); deadline mapped to 502 (1); and, rerun after the test fix below: browser disconnect does not abort (1); client date ignored (2); deadline not enforced (1 failure, 1 cancelled by the timeout); 401 walking on to the next model (1); no retry without JSON mode (1); weekday taken from the server clock (1).

**The survivor**: deleting the `if (signal.aborted) throw err;` inside the catch of `chatCompletionWithFallback` changed no test result. Reading why: the check at the top of the same loop already stops the walk on the very next iteration, before any provider call, so the line inside the catch did nothing the other did not. I removed the redundant line (the suite is unchanged at 134) rather than write a test for a distinction that does not exist.

**The one that exposed a weak test**: with "browser disconnect does not abort" the suite did not fail, it hung: a test waited in an unbounded loop for the abort. A hang is a detection only if someone is watching. Fixed in `d01f0c1`: waits in route tests fail after 3 s, and `npm test` sets a 30 s per-test timeout. Rerun result for that mutation is in the list above.

## 7. Deviations and judgment calls

1. **P1-13, adjust**: you ruled optional date and time zone "for parse and adjust". `adjust-plan` already receives the client's own date as the required `progress.today`, and nothing on the server would use a time zone there, so I added nothing to adjust rather than a field with no behaviour. Tell me if you want it accepted anyway.
2. **P1-13, no plausibility bound on `clientDate`**: any real date is accepted. I considered refusing dates more than a day from the server's, and did not: it adds a failure for people with a wrong device clock and prevents nothing (the value only enters the prompt, validated as a date).
3. **P1-6, reversed free windows refused**: your item said "accept and normalize one-digit-hour times; field-level details". The reversed window (`20:00-08:00` read as two windows) was pinned as a P1-6 known defect in Batch 1, so I reversed it here by refusing it with a field message. Commitments may still cross midnight.
4. **P1-3, which session survives an overlap**: the earlier-starting one; ties by earlier end. A simple, stated rule; the alternative (keep the longer, or trim) seemed less predictable.
5. **`24:30`** fixed inside P1-6 (same expression).
6. **P1-13 touches `public/script.js`** in its own commit (one request body), separate from the P0-1 page commit, so each can be reverted alone as you asked.
7. **The save defect** (section 1) was fixed in the P0-1 page commit: without it the approved fix could not be exercised at all.
8. During the hung mutation run I stopped the node processes of that run by matching command lines; one matched process may have been the editor's own language service rather than a test worker. It restarts by itself; no project file was involved.

## 8. Known gaps and risks after this batch

- `public/script.js` still has no automated unit tests; two browser scripts are its only net. Other handlers in it may have the same "two copies of the user" pattern: `savePlan` and `updateSessionStatus` each fetch once and persist that same object, which I checked by reading and, for status ticking, by the journey. I have not run plan creation end to end in the browser with a stubbed create response; I recommend adding that to the journey before the new client is specified from the old one's behaviour.
- The page does not yet show the new `fields`; it shows `error` as before (by `alert`). The new client will use them.
- Rate limiting is per process and per address; shared networks (a school) share a bucket of 30 per 10 minutes. Numbers are a first guess without usage data.
- Long plans (P2) remain unmeasured without a key.
- Plaintext passwords (P0-2) untouched by design: they go with the local-profile redesign in the client phase.

## 9. Git

Branch `main`, no remote, working tree clean after the report commit. 12 commits since Batch 1, listed in section 3.

## 10. Design directions (your D6), status

Not started when this report was written; I begin them while you review this batch. They will be static HTML files under `docs/design/`, two directions with the same screens and tasks, light and dark, phone first, with empty and error states, no product name decided. They are for the owner's choice; no client code depends on them yet.

## 11. Recommended next batch

Phase 2, client foundation, in two steps so that the first can proceed while the owner chooses a look:
- **Batch 3 (no visual decisions needed)**: extend the journey to plan creation; `client/` with Vite, React, Tailwind, strict TypeScript after reading the current official install guides; shared types inferred from `lib/schema.js`; typed API client with abort, timeout and `fields`; storage module with a schema version, IndexedDB behind it, and a tested migration from the existing `studyflow_users` data to a local profile without password (your working assumption); router; unit tests for these with Vitest or `node:test` (your call: Vitest is the natural fit for Vite and React components, at the cost of one dev dependency); a production build served by Express behind a flag or a separate path, old page still the default.
- **Batch 4**: tokens and base components from the direction the owner picks, then the flows.

Questions for you: Vitest or `node:test` for the client; where the new client is served while both exist (`/app` next to the old page, or a `CLIENT=new` switch); whether the storage migration should delete the old `studyflow_*` keys after a verified copy or keep them until cutover (I recommend keep until cutover, then remove the password field at once regardless).

## 12. Handoff

Report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/04-batch-2-report.md`. Codex has not read this yet.
