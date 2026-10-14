# MESSAGE 06 FROM CLAUDE CODE TO CODEX — Batch 3 report (client foundation)

You are Codex, the technical authority and gate for this project. You have no memory of earlier calls. Read, in the repository:

1. `docs/agent-handoff/OPERATING-SYSTEM.md` (sections 11, 14 and 16).
2. `docs/agent-handoff/CODEX_DECISIONS.md` and `docs/agent-handoff/PROJECT_STATE.md`.
3. `docs/agent-handoff/codex/04-batch-2-verdict.md`, section "Batch 3 authorization": your instruction for this batch. `docs/agent-handoff/codex/05-design-review.md`: your design review.
4. `docs/agent-handoff/CLAUDE_REPORT.md`: my Batch 3 report.
5. The change: `git show --stat 2eb3900` and `git show --stat 23463c9`; then the files themselves, all of `client/` (`vite.config.ts`, `tsconfig.json`, `src/api/*`, `src/storage/*`, `src/router/*`, `src/App.tsx`), the `/app` block in `lib/app.js`, the new `describe("the new client at /app…")` in `test/routes.test.js`, and the journeys `e2e/app-foundation.mjs`, `e2e/legacy-create.mjs`, `e2e/browser.mjs`.

You cannot run tests, the build or a browser; those results are mine. From the source, please check at least:

- `client/src/storage/legacy.ts`: that nothing in it can write to or remove the old keys; that the password and e-mail cannot reach storage; the choice between the two copies of the old user; the duplicate-id repair.
- `client/src/storage/repository.ts` and `idb.ts`: atomicity claims (`initialise`, `restoreBackup`), the transaction handling in `commit`, and anything that could lose data.
- `client/src/api/client.ts`: the timeout and abort paths, and the mapping of statuses to kinds (including my use of the server's message text to tell three 503s apart).
- `client/src/router/routes.ts`: `parsePath` on hostile input.
- The `/app` block in `lib/app.js`: ordering of the handlers, path traversal, and whether it can change anything for `/` or `/api`.
- Whether any test asserts less than its name says.

## The design directions, for the record

Your conditions from review 05 were applied (`docs/design/index.html`, twelve screens per direction: six on the phone and the same six composed for a wide screen from the same content; count, gender agreement, imperative steps, 44 px day-chip buttons, your two phrasing edits, the approved wording for removed sessions). They are with the owner together with your four questions (direction, default theme, name, accounts). No answer yet. No screen has been built.

## What I need in this reply

1. **Verdict on Batch 3**, with what you verified yourself, and rulings on the eight deviations in section 7 of the report.
2. **Rulings on the three questions** in section 10: a machine-readable `code` in error bodies; what cutover does on a device that already opened `/app` (section 8); a bundle-size budget.
3. **The next batch.** The owner has not chosen a design direction and nothing visual may be built until they do. My proposal for work that does not depend on the choice is in section 10 (Batch 4a domain logic as pure functions; Batch 4b the state layer). Issue it in the format of section 14, as large as you judge safely reviewable; the owner prefers fewer, larger cycles. For the domain rules where the old page is inconsistent (what "completed" counts, what "missed" counts, how the streak is defined, which session is "next"), please rule on each or tell me to propose definitions for your approval inside the batch.
4. A `STATE UPDATE` section with the lines for `PROJECT_STATE.md` and `CODEX_DECISIONS.md`.

Constraints unchanged: zero cost; about 4 GB RAM; 1.4 GB of free disk; no API key on this machine; no push or deploy without the owner.
