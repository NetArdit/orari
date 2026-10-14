# CLAUDE REPORT 05 — Batch 4: client domain, storage integrity, state layer, error codes

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

## 1. Status

**VERIFIED COMPLETE** against `docs/agent-handoff/codex/06-batch-3-verdict.md`, "Batch 4". No screen, token or component was built. No live AI call. Nothing pushed or deployed. The owner has not yet answered the four questions (design direction, default theme, name, accounts).

Two defects were found by tests written in this batch, both fixed in it:
- An address with a broken percent-escape under `/app` answered **500**; it now answers 400 `BAD_REQUEST` (found while strengthening the traversal test).
- The store's `load()` did not check the storage version, so data written by a newer app version would have been read and reinterpreted; the repository had the check, the store never called it (found by the store's own test).

## 2. Commits

- `00f51be` Stable error codes on every error body; stronger traversal test; 400 for broken addresses. `lib/app.js`, `lib/plan.js`, `lib/schema.js`, `test/routes.test.js`, `test/plan.test.js`.
- `c1264cd` Client classifies failures by code. `client/src/api/client.ts`, `types.ts`, `client.test.ts`.
- `7aaac45` Storage: checks a write depends on are made inside the write. `client/src/storage/store.ts`, `idb.ts`, `repository.ts`, `legacy.ts`, `storage.test.ts`.
- `b31ee33` Domain. `client/src/domain/clock.ts`, `progress.ts`, `replan.ts`, `planForm.ts`, `ics.ts`, `domain.test.ts`.
- The state commit (see `git log`): `client/src/state/planStore.ts`, `flows.ts`, `state.test.ts`.

## 3. Your Batch 3 conditions, one by one

1. **Initialise under two tabs.** `KeyValueStore.commit(writes, { onlyIfAbsent })`: the "no profile yet" check is evaluated inside the same transaction as the writes (in IndexedDB, a `getKey` request at the start of the readwrite transaction, with the puts issued from its success callback; readwrite transactions on one object store are serialised across tabs). The loser gets `AlreadySetUpError` and none of its data is stored. `migrateFromLegacy` treats that as "already done" rather than a failure. Tests: two set-ups started together in both orders, and two migrations together. The old check-then-write behaviour, restored as a mutant, fails 3 tests.
2. **Restore under a concurrent save.** A new write kind, `{ deletePrefix, except }`, lists the keys to remove inside the transaction. Test: another tab's save lands immediately before the restore's commit; the plan does not survive. The old "list first, then write" behaviour, restored as a mutant, fails that test.
3. **Duplicate plan ids in a backup** are counted (`plansDuplicated`) and the first is kept; they no longer collapse silently. `initialise` refuses two plans with one id outright.
4. **Generated-id collisions.** Replacement ids, for sessions and for plans, are checked against every id in use: the originals further down the list and the ones just handed out. After 50 colliding offers the conversion stops rather than store duplicates. `mergeReplan` and `planFromAnswer` do the same for ids arriving from the server.
5. **Unknown legacy status or kind** are stored as `pending` / `learning` (which claim no progress) and now counted in the outcome (`sessionsWithUnknownStatus`, `sessionsWithUnknownKind`), only for plans actually carried over, so a screen can tell the person.
6. **Traversal test.** Raw `http.request` (fetch removes `..` before sending), a real file one level above the client folder containing a unique sentinel, ten attack paths (plain, percent-encoded in both cases, backslash, nested under `assets`, doubled slash). Asserts the sentinel is never in the body and the status is 400/403/404 or the client's own page.

**NOT TESTED**: two real browser tabs racing. The IndexedDB path is exercised by the single-tab journey (26 of 26 after the change); the race itself is covered only against the memory store, whose commit is atomic in the same way. Driving two tabs needs a second DevTools target in `e2e/browser.mjs`; I can add it if you want it before cutover.

## 4. Error codes

Every error body is `{ code, error }` (plus `fields` on validation). 21 codes, listed with their statuses in `lib/schema.js` (`ERROR_CODES`). A test reads `lib/app.js` and `lib/plan.js` and fails if a code is used but not published, or published but not used. The client maps each code to a kind through a `Record<ErrorCode, ApiFailureKind>`, so a new server code does not compile until it is placed. Without a code only the status is used; a 502 or 503 without our code is treated as an outage in front of the server (`server`), not as an AI result. The provider's limit and unavailability now have their own kind, `provider_unavailable`, instead of being shown as the person's own rate limit.

The old page is unaffected: it reads `error` only.

## 5. Proposed domain rules (for your ruling; not presented as product policy)

All in `client/src/domain/progress.ts`, each a named function, each taking a `Clock` (`{ today, minutes }` in the device's local time) instead of reading the system time.

**"Today"** is the device's local calendar date. Plans hold dates and times of day without a zone, so nothing is converted.

**State of a session** (`sessionState`): the person's mark always wins: `completed` → done, `partial` → partial, `skipped` → skipped, whatever the date. Unmarked: before today → **missed**; after today → upcoming; today, by the minute: before its start → upcoming, from its start → **now**, from its end → **late**. A session is "late" for the rest of its day and becomes "missed" only at midnight.
Boundary examples (tested): a 17:30–18:30 session is upcoming at 17:29, now at 17:30 and 18:29, late at 18:30 and 23:59, missed at 00:00 next day.
*Old page:* no "now" or "late"; an unmarked session earlier today is simply pending.

**Completed** (`progressOf().done`) counts sessions marked done. **Partly done is counted separately**, never as completed. *Old page:* the dashboard counts partial as completed, the plan card does not.

**Missed** counts unmarked sessions whose day has passed. **Skipped is counted separately**: it is a decision, not a lapse. *Old page:* "missed" on the dashboard is skipped plus overdue together, while the re-plan banner counts overdue only.

**Minutes studied**: full length of done sessions plus half the length of partly done ones (the old page's rule, kept). **Completion**: (done + partial/2) / total; 0 for an empty plan.

**Needs re-planning** (`needsReplan`): the plan has not ended and has at least one missed session. A skipped session alone does not trigger it; a late one today does not either.

**Streak** (`streakDays`): days in a row with study, counted back from today. A day counts if at least one session of any plan that day is done or partly done. A day with sessions planned and none done ends it. **A day with nothing planned neither counts nor ends it.** Today does not end it while it is still going. The number is days with study, not calendar span.
Examples (tested): Fri and Sat done, Sunday free, Mon and Tue done → 4. Mon done, Tue planned and untouched, Wed and Thu done → 2. Yesterday missed, nothing done today → 0.
*Old page:* any day without study ends the streak, so a plan with Sunday off can never show more than six.

**Next session** (`nextSession`): the one in progress if there is one; otherwise the earliest unmarked session that has not started, today or later, across all plans. A late session is not "next"; it stays in today's list as late. *Old page:* skips the session in progress.

**Current plan** (`currentPlan`): the most recently created plan that has not ended.

Questions these raise that are product decisions: whether a late session should be offered a one-tap "move to later today"; whether "partly done" should count towards a streak (it does here); whether skipped sessions should feed the re-plan prompt (they do: they are sent as missed, as the old page does).

## 6. The rest of the domain layer

- **`replan.ts`**: `progressSummaries` (what the AI is told; capped at the server's 50 lines per list, keeping the most recent, where the old page would have been refused with a 400 once a plan passed 50), `buildAdjustRequest`, `mergeReplan` (keeps the past and everything marked, replaces unmarked sessions from today on, never trusts statuses in the answer, re-ids clashes, does not mutate its input, counts new sessions that are already over), `planFromAnswer`.
- **`planForm.ts`**: one form state for both ways of starting. `formFromParsed` turns what the AI read into editable state (answers audit finding P1-7); `buildPlanInputs` validates everything at once and reports with the server's field paths, so an error from either side lands on the same control. Material and goal are separate fields (the old form merged them); days are chosen, not typed; a half-filled busy-time row is an error, not silently dropped; overlapping free windows on one day are refused; one-off days without study are supported (P2-4). A test feeds the form's output to the server's own `CreatePlanBody` and requires that the server's normalisation changes nothing.
- **`ics.ts`**: RFC 5545 export of the sessions still to do, floating local times, stable UIDs from session ids, text escaping, folding at 75 bytes without splitting a character.

**A finding for the server, not fixed here**: when a plan is adjusted, the server builds today's calendar from 06:00, so the AI can place a new session at 08:00 when it is already 18:00. The client now counts such sessions (`alreadyOver`) so a screen can say so, but the right fix is for adjust to accept the current local time and start today's windows from it. That is an additive request field and a small change in `lib/time.js`; I recommend it for the next server batch.

## 7. State layer

- **`planStore.ts`** (no React): `loading` / `failed` / `ready`. `markSession` changes the screen at once and writes afterwards; on a failed write the mark is taken back to what storage is known to hold and `saveError` is set. Writes to one plan are serialised. An older mark that fails late does not undo a newer one. `savePlan` and `deletePlan` show their effect only once stored.
- **`flows.ts`**: `createParseFlow`, `createPlanFlow`, `createReplanFlow` on one machine: `idle` → `working` → `done` | `failed`. `start()` while working returns false and sends nothing (duplicate submission). `cancel()` aborts the request and is idle at once. An answer from a cancelled or superseded run is ignored, including when the connection ignores the abort. Failures carry the API kind, message, fields and retry time; three kinds never involve the server: `invalid` (the form), `storage` (the plan could not be kept), `gone` (the plan no longer exists). Re-plan merges into the plan as it is when the answer arrives, after pending marks have been written, so a session ticked while waiting is kept.

## 8. Evidence

- `npm test`: **148 tests, 148 pass**. `npm run client:typecheck`: clean. `npm run client:test`: **162 tests in 5 files, 162 pass** (api 18, domain 52, router 15, state 33, storage 44). `npm audit`: 0 vulnerabilities. `npm run check`: pass.
- Type checker: a probe assigning `"NOT_A_CODE"` to `ErrorCode` fails with the union of real codes listed.
- Browser, built client: `e2e/app-foundation.mjs` **26 of 26** after the storage changes (real IndexedDB).
- **Mutation checks**: storage, the two old race behaviours restored: both caught (3 and 1 failures). Domain and state: 29 single deliberate bugs prepared; 28 ran. 27 caught on the first pass; the one survivor, "a stale answer is accepted", exposed that my fake API always honoured the abort, so the guard against late answers was never exercised. I added a test with a connection that ignores cancelling; the mutant then fails. The 29th ("comma not escaped in the calendar export") did not run because my shell quoting mangled the marker; that behaviour is asserted directly by the `escapeText` test.
- Production JavaScript: **87.34 kB gzip** (292 kB raw), against your 200 kB budget. Unchanged by the domain and state modules because no screen imports them yet; expect it to rise when they are used.

**NOT TESTED**: anything with a real AI provider; two real tabs; the store and flows inside React (no component uses them yet); IndexedDB failure modes (quota, private mode).

## 9. Deviations and judgment calls

1. `BAD_REQUEST` is a 21st code you did not list; it came from the defect in section 1.
2. A new failure kind `provider_unavailable` in the client (you asked to distinguish the provider's limit and unavailability; I gave both one kind because a screen would say the same thing for either).
3. The Albanian strings inside `planForm.ts` and `flows.ts` (field messages, "Plani u krijua, por nuk u ruajt dot në këtë pajisje…") are needed for the functions to return something, and reuse your approved wording where one existed. The new ones are not approved copy; please read them or defer them to the copy pass.
4. `planFromAnswer` does not store `stats`, per your ruling 2 on Batch 3.
5. The unused `gatedStore` idea and one unused parameter were removed before commit; nothing else was refactored.

## 10. Known gaps and risks

- Everything in sections 5 to 7 is untested inside a screen, by design.
- The old page keeps its own, different counting rules until cutover; the two will show different numbers for the same data if someone compares `/` and `/app` once screens exist.
- The server finding in section 6 (sessions placed earlier than now on re-plan).
- Free disk is about 1.4 GB.

## 11. What is blocked and what is not

**Blocked on the owner**: every screen, token and component (design direction and default theme); the profile set-up screen's wording (accounts decision); the product name in titles.

**Not blocked**, proposed for the next batch:
- The server change from section 6 (adjust accepts the current local time), with tests.
- React bindings that carry no visual decisions: `useStore`, `useFlow` hooks over `useSyncExternalStore`, an error boundary, focus management on route change and a live region for announcements, with tests where they can run without a DOM and a journey for the rest.
- A second tab in `e2e/browser.mjs` and a two-tab journey for first set-up.
- Backup download and restore upload as functions (Blob, File reading, size limit, the Albanian messages for each failure), without their screen.
- The cutover procedure as code and tests, following your ruling: snapshot the old data after writes are frozen, replace only migration-only storage, otherwise keep and offer recovery.
- Groundwork for Phase 4 that needs no design: extracting text from a PDF in the browser and chunking it, as pure functions with tests, behind your constraints. This adds a dependency (`pdfjs-dist`, Apache-2.0) and would need your approval and a size measurement first.

## 12. Handoff

Report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/07-batch-4-report.md`. Codex has not read this yet.
