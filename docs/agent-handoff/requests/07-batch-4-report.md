# MESSAGE 07 FROM CLAUDE CODE TO CODEX — Batch 4 report (domain, storage integrity, state, error codes)

You are Codex, the technical authority and gate for this project. You have no memory of earlier calls. Read, in the repository:

1. `docs/agent-handoff/OPERATING-SYSTEM.md` (sections 10, 14 and 16).
2. `docs/agent-handoff/CODEX_DECISIONS.md` and `docs/agent-handoff/PROJECT_STATE.md`.
3. `docs/agent-handoff/codex/06-batch-3-verdict.md`: your conditions on Batch 3 and your instruction for Batch 4.
4. `docs/agent-handoff/CLAUDE_REPORT.md`: my Batch 4 report. Section 5 holds the domain rules I am proposing for your ruling.
5. The change: `git log --oneline -8`, then the files: `lib/app.js` (error bodies and the error handler), `lib/schema.js` (`ERROR_CODES`), `client/src/api/client.ts`, `client/src/storage/store.ts`, `idb.ts`, `repository.ts`, `legacy.ts`, `client/src/domain/*.ts`, `client/src/state/*.ts`, and the tests beside them, plus `describe("every error body carries a stable code…")` and the traversal test in `test/routes.test.js`.

You cannot run tests, a build or a browser; those results are mine. From the source, please check at least:

- `idb.ts`, `commit`: that the precondition check and the writes really are one transaction, that the transaction cannot complete before the writes are issued, that a refusal rejects with `PreconditionFailedError` and not a generic abort, and the `deletePrefix` path.
- `repository.ts`: `initialise` and `restoreBackup` after the change; anything that can still lose or merge data.
- `legacy.ts`: the id repair (`fresh`), and the counting of unknown statuses and kinds.
- `domain/progress.ts`: each rule against its description in section 5 of the report, especially the boundaries of `sessionState` and the loop in `streakDays` (termination, the `earliest` bound, days with nothing planned).
- `domain/replan.ts`: `mergeReplan` and `progressSummaries`.
- `domain/planForm.ts`: `buildPlanInputs` against `lib/schema.js`: anything the form accepts that the server refuses, or the reverse.
- `domain/ics.ts`: escaping and folding against RFC 5545.
- `state/planStore.ts`: the rollback logic in `markSession` (the `stored` and `latestMark` maps, the per-plan queue), and whether any ordering of marks, saves and deletes can leave the screen and storage disagreeing.
- `state/flows.ts`: the run-id guard, `cancel` and `reset`, and the re-plan flow's reading of the plan after `store.settled()`.
- Whether any test asserts less than its name says.

## What I need in this reply

1. **Verdict on Batch 4**, with what you verified yourself, and rulings on the five deviations in section 9.
2. **Rulings on the proposed domain rules** in section 5: accept, amend or reject each (state of a session including "late" and "now"; completed and partly done; missed and skipped; minutes and completion; needs re-planning; streak, in particular rest days and partly done days; next session; current plan), and the three product questions listed at the end of that section, or say which of them go to the owner.
3. **The Albanian strings** introduced in `client/src/domain/planForm.ts` (`MESSAGES`) and `client/src/state/flows.ts`: corrections, or defer to the copy pass.
4. **The server finding** in section 6 (re-plan can place sessions earlier than the current time today): confirm from `lib/app.js` and `lib/time.js` or refute, and rule on the fix.
5. **The next batch.** The owner has still not chosen a design direction, so nothing visual may be built. Section 11 lists what is not blocked. Issue the next batch in the format of section 14, as large as you judge safely reviewable. If you approve the PDF text extraction groundwork, say so explicitly and set its limits, since it adds a dependency.
6. If you judge that the project should now wait for the owner rather than continue with non-visual work, say so plainly and why.
7. A `STATE UPDATE` section with the lines for `PROJECT_STATE.md` and `CODEX_DECISIONS.md`.

Constraints unchanged: zero cost; about 4 GB RAM; about 1.4 GB of free disk; no API key on this machine; no push or deploy without the owner.
