## Verdict: ACCEPTED WITH CONDITIONS

Batch 0 is accepted. I confirmed the two Git commits (`b68ef0e` baseline, followed by the handoff/evidence commit), a clean working tree, and no diff from the baseline in `server.js`, `lib/`, `public/`, or the package manifests. I read the browser report and inspected the phone guided-form, phone plan, and desktop dashboard screenshots. The phone captures support a responsive-layout concern; because the report records `innerWidth` expanding to 473/424 px while `scrollWidth` matches it, describe this as viewport expansion and compressed rendering—not measured horizontal scrolling.

I did not rerun the server checks, browser script, or `npm audit`; those results remain Claude’s reported evidence, not checks I executed. The read-only workspace also prevents me from updating the handoff files.

## Audit comparison

| Finding absent from my earlier register | Source check and final priority |
|---|---|
| **P0-1: re-plan loses today’s sessions and can duplicate IDs** | **Confirmed, P0.** The client keeps only sessions dated before today, dropping completed or otherwise marked sessions from today. The server restarts adjusted IDs at `a1`; a later adjustment can collide with a kept earlier `a1`. Since status updates find the first matching ID, this can change the wrong session. |
| **P1-1: requests can take minutes** | **Confirmed, P1.** The code can try four models, retry rate limits, allow 25 seconds per provider call, and make a second JSON-repair pass. Roughly 400 seconds plus retry delays is a credible worst case, not a measured duration. |
| **P1-2: long plans may fail** | **Partly confirmed; P2.** The full calendar is included in one model request and there is no explicit output-token cap, so truncation is plausible. Without a live provider run, failure is not established; test it with a key before setting a hard product limit. |
| **P1-4: dropped sessions are described as adjusted; an empty plan may succeed** | **Confirmed, P1.** The create route warns that out-of-window sessions were adjusted, though they were dropped, and returns success even if none remain. The adjust route also lacks an equivalent zero-kept-session check. |
| **P1-5: overnight commitments affect the wrong day** | **Confirmed, P1.** A cross-midnight interval is split into ranges, but both ranges are applied to the date/day on which the commitment matched. For a Monday commitment ending Tuesday morning, Monday morning is blocked and Tuesday morning is not. |
| **P1-6: guided-form times can fail server validation** | **Confirmed, P1.** `parseWindowsString` accepts a one-digit hour such as `9:00`; the shared schema requires `09:00`. The server then returns a generic missing-data message. |
| **P1-7: AI-read availability cannot be corrected** | **Confirmed, P1.** The confirmation flow presents availability and commitments as read-only text and sends them on unchanged. |
| **P1-9: no plan management or backup** | **Confirmed, P1.** I found no plan deletion/edit/export handlers. With local-only storage, this makes accidental browser-data loss consequential. |
| **P1-13: client/server “today” mismatch** | **Mismatch confirmed; P2.** The client uses its local calendar date; the AI prompt combines a UTC ISO date with a weekday formatted in the server’s local zone. That can disagree near a date boundary, but it is a conditional edge case, so I would not keep it at P1 without a reproduced user-facing failure. |
| **P1-15: phone layout** | **Confirmed as a responsive defect; P1.** The report records the layout viewport expanding beyond the emulated 360 px width on two screens, and the inspected captures show the narrow content area. I do not confirm the report’s suggested sideways scrolling: its own measurements show no horizontal overflow relative to the expanded layout viewport. |
| **P2-1: profile privacy claim is inaccurate** | **Confirmed, P2.** The profile says data is used for AI personalization, but the examined flow sends education level without passing it to the model, and school stays in the browser. |
| **P2-4: no one-off date controls** | **Confirmed, P2.** The schema and scheduler support specific unavailable dates and commitment dates, but the UI has no controls for them. |

**P0 disputes:** I agree with the report’s P0-1 classification: it can lose progress and misdirect later status changes. Plaintext passwords are also a real issue. Since these are fake, browser-local accounts rather than server authentication, but the app collects reusable secrets and stores them twice in plaintext, I classify that as **P0** and recommend removing password collection in the local-profile direction. I keep impossible dates at **P1**: they can shift a plan’s dates, but the issue is narrower than the confirmed re-plan data-loss defect. The dependency advisory and missing rate limiting merit prompt work, but public exposure is unknown, so I classify them **P1 until deployment exposure is established**.

## Rulings

### D4: dependency audit and line endings

**Approve both.** Run `npm audit fix`, inspect and report the exact lockfile changes, then rerun the audit and relevant checks. Keep it to compatible fixes; report any fix that would require a breaking update separately. Add `.gitattributes` with LF normalization so checkout behavior is consistent across machines.

### D5: frontend migration

**Accept with amendments.** Use a `client/` Vite app with React and Tailwind, strict TypeScript on the client, and types inferred from the existing Zod contracts. Keep the Express backend and its API/business rules in JavaScript for now. Check official compatibility/install guidance and exact package versions when configuring the client; do not treat the versions listed in the report as independently verified here.

Build the replacement beside the old frontend only after the safety net exists. Keep one active application and one storage implementation: verify parity and migration, switch over in a reviewed cutover, then remove the old frontend. Do not maintain two competing storage paths or change API contracts as part of the migration.

### D6: design direction

The paper-like planner direction is a sound starting point: light default, real dark theme, restrained color, no glow or glass effects, accessible states, and mobile-first navigation. Produce **two static visual directions** for the owner to choose from **after Batch 1’s safety net and before building the broad client UI**. Include natural Kosovo Albanian copy and realistic planner screens so the choice is about a usable product, not abstract mood boards.

### D7: flashcards and quizzes

**Include the feature as Phase 4**, after the existing planner flows have reached parity. It is a meaningful extension: the planner decides when to study; retrieval practice supplies what to do during a study session.

Constraints:

- Extract PDF text in the browser; do not upload the PDF itself to our server.
- Detect scanned or near-empty PDFs and explain that OCR is unsupported in the first version. Do not silently fail.
- Split extracted text into conservative, bounded chunks that fit the selected free model’s context, process sequentially, and show progress and recoverable failures. Free-model limits are variable; chunk size and retry behavior must be configurable and tested with mocks.
- Keep a source passage pointer on each generated card, ideally page plus excerpt, and make cards editable and deletable so learners can check and correct model output.
- Store decks in IndexedDB, behind the storage module. Plans can remain part of the storage migration design; do not assume localStorage can hold decks.
- Make review scheduling deterministic application logic, not an AI decision.
- Explain that extracted text sent for generation goes to a third-party model. Do not promise confidentiality or model-provider retention behavior without verified terms.

### D1: accounts

**Recommendation to the owner: local profile, no password, with export/import.** Until the owner decides, proceed on that assumption so work can continue. Describe storage honestly as being on this device. Do not build real accounts, password handling, or a database without the owner’s explicit approval.

### Phase order

**Accept the proposed order with one adjustment:** finish a small, no-behavior-change safety net first; address critical correctness/security and server reliability next; then build the client foundation and migrate the existing flows; add flashcards/quizzes after parity; finish accessibility, performance, copy, and release readiness last. Treat the local-profile choice as the working assumption in the migration. Keep deployment out of scope absent owner approval.

## Batch 1 — Safety net

**Goal and user value:** Make current behavior and API boundaries regression-checkable before corrections or migration. This gives later fixes evidence and a reliable way to detect accidental changes.

**Scope and expected files:**

- `package.json`, `package-lock.json`: add test scripts and apply the approved compatible `npm audit fix`.
- `.gitattributes`: normalize text files to LF.
- `README.md`, `.env.example`: explain setup, scripts, environment variables, local-only data, and the fact that no live AI checks run without an owner-provided key.
- `server.js`, `lib/ai.js`, and, if needed, a small new `lib/` module: make route logic and AI calls injectable for tests. Move `sanitizeSessions` and `computeStats` only if needed to test them; preserve their behavior in this batch.
- New `test/` files: date/time engine, schemas, sanitization, statistics, and route integration tests using a fake AI implementation.

**Exclusions:** No user-visible behavior fixes, React/Vite setup, live AI requests, real credentials, database or real accounts, OCR, push, deployment, or changes to API request/response contracts. Do not add browser automation dependencies in this batch.

**Approach:** Prefer Node’s built-in `node:test` and `fetch` for this server-only safety net, avoiding a new test-runner dependency before the client exists. Inject fake AI functions at the app boundary and bind integration tests to an ephemeral local port. Keep each refactor minimal. Where a test records a known defect—such as `2026-02-31` being accepted—label it explicitly as a known defect; Phase 1 must reverse that expectation with the fix.

**Dependencies and risks:** Existing Node 24 and installed dependencies are reported, but I did not verify them in this turn. The route seam must not change production startup behavior. Audit fixes may alter transitive dependency versions; review the lockfile diff and audit output. No test may call a live provider.

**Acceptance criteria and required evidence:**

- Tests cover representative and boundary behavior in `lib/time.js`, schema parsing, `sanitizeSessions`, and `computeStats`, including labeled known defects.
- Fake-backed integration tests exercise valid and invalid requests on all three AI routes and assert status codes, response shapes, and safe errors without network access.
- `npm test` passes with exact test counts; syntax checks and `npm audit` results are reported. No behavior changes are introduced.
- README and `.env.example` contain no real credentials.
- Report exact commands, results, dependency changes, and Git status. Do not claim live AI, accessibility, or browser-journey verification.

**Rollback:** Revert only the Batch 1 commit if its test seam or dependency changes cause trouble. Preserve the baseline and handoff commits. Do not reset or discard work.

## STATE UPDATE

I could not write these files in the read-only workspace. Apply these proposed entries to the handoff records:

**`PROJECT_STATE.md`**

```text
Gate: Batch 0 accepted with conditions; Batch 1 safety net authorized.
Verified by Codex: Git history contains baseline b68ef0e and a handoff/evidence commit; working tree clean; no app-source or package-manifest diff from the baseline. Source confirms the reported re-plan progress-loss/duplicate-ID defect, inaccurate dropped-session warning/empty success, overnight commitment date bug, and guided-form/server time-format mismatch. Codex inspected three baseline screenshots; no checks were rerun in this audit.
Current stack: Express and Zod backend; plain HTML/CSS/JavaScript frontend; browser localStorage persistence; AI calls through OpenRouter.
Working account assumption: local profile without password; export/import; owner decision pending.
Approved direction: Vite/React/Tailwind client with strict TypeScript and Zod-inferred types; keep current frontend until parity and storage migration are verified; retain Express APIs.
Feature scope: flashcards/quizzes included after planner parity; browser PDF text extraction, bounded chunks, source pointers, IndexedDB, deterministic review scheduling; scanned PDFs/OCR excluded from first version.
Next action: execute Batch 1 safety net as specified in Codex response; no live AI key or provider calls.
Limitations: workspace was read-only; npm audit and runtime/browser checks were not rerun by Codex.
```

**`CODEX_DECISIONS.md`**

```text
Verdict: Batch 0 ACCEPTED WITH CONDITIONS. Verified Git history and clean working tree; app source and package manifests match baseline. Inspected three supplied screenshots. Batch 0’s runtime and browser checks remain Claude-reported, not independently rerun by Codex.
D4: Approve compatible npm audit fix after reviewing lockfile changes; add LF-normalizing .gitattributes.
D5: Approve client/ Vite + React + Tailwind and strict client TypeScript with types inferred from shared Zod schemas. Preserve Express/API contracts. Build beside legacy only after safety tests; cut over after parity and storage migration.
D6: Produce two static visual directions after Batch 1 and before broad client UI; owner selects.
D7: Include flashcards/quizzes after planner parity. Browser-side PDF text extraction, bounded chunking, passage pointers, editable cards, IndexedDB, deterministic review scheduling; no OCR for scanned PDFs in v1.
D1 recommendation/working assumption: local profile without password plus export/import. Real accounts require owner approval.
Priority rulings: re-plan progress loss/duplicate IDs P0; plaintext password collection P0; impossible dates P1; unprotected shared AI quota P1 pending deployment exposure; long-plan truncation P2 pending provider evidence; timezone “today” mismatch P2.
Next approved batch: Batch 1 safety net in this response; no live AI calls, behavior changes, client migration, or deployment.
```