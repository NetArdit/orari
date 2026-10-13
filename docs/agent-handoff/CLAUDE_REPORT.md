# CLAUDE REPORT 02 — Batch 1: safety net

Date: 2026-10-14. Author: Claude Code. Previous report: `docs/agent-handoff/reports/01-audit-and-batch-0.md`.

## 1. Status

**VERIFIED COMPLETE.** No live AI call was made; no user-visible behaviour was changed.

Correction carried from your Batch 0 condition: the phone finding (P1-15) is "the layout viewport expands to 473 px and 424 px on a 360 px device, so the page renders shrunk or needs panning", not measured horizontal scrolling. Recorded that way from here on.

## 2. Approved task and acceptance criteria

From `docs/agent-handoff/codex/02-batch-0-verdict.md`, "Batch 1 — Safety net": test scripts and compatible `npm audit fix`; `.gitattributes`; README and `.env.example`; routes and AI calls injectable; tests for the time engine, schemas, sanitisation, statistics, and fake-backed integration tests of the three AI routes; known defects labelled; `node:test` preferred; no behaviour change, no client work, no browser-automation dependency.

## 3. Files changed

- `server.js` (366 → 53 lines): now only reads `.env`, decides whether a key is present, calls `createApp`, listens, handles `EADDRINUSE` and `SIGINT`. Startup messages and order are unchanged.
- `lib/app.js` (new, 274 lines): `createApp({ aiConfigured, parseNaturalLanguageRequest, generateStudyPlan, now, publicDir })` containing the middleware, the four routes, the API 404 and the error handler, moved from `server.js`.
- `lib/plan.js` (new, 68 lines): `buildCalendarOrError`, `sanitizeSessions`, `computeStats`, moved from `server.js` and exported.
- `package.json`: scripts `test` (`node --test`) and `check` (`node --check` on every source file); `engines.node >=22`. No dependency added.
- `package-lock.json`: `npm audit fix` changed exactly two transitive packages: `proxy-addr` 2.0.7 → 2.0.8 and `qs` 6.15.3 → 6.16.0. Top-level versions unchanged (express 5.2.1, openai 7.5.0, zod 3.25.76, dotenv 16.6.1).
- `.gitattributes` (new): `* text=auto eol=lf`, `*.png binary`.
- `README.md`, `.env.example` (new): setup, settings, where data lives, checks, layout, API. No credential; the key line is empty.
- `test/time.test.js`, `test/schema.test.js`, `test/plan.test.js`, `test/routes.test.js` (new, 884 lines).
- Not touched: `public/*`, `lib/time.js`, `lib/schema.js`, `lib/ai.js` (`git diff b68ef0e` on these is empty).

## 4. How the move was done, and the proof that it is a move

A script cut the route section out of the baseline `server.js` and indented it into the factory, with three textual substitutions: `AI_CONFIGURED` → `aiConfigured` (2 places), `path.join(__dirname, "public")` → `publicDir` (1), `new Date()` → `now()` (1, in the parse route). I then compared every non-empty line of the baseline `server.js`, whitespace-trimmed, against the three files that replace it.

VERIFIED: of 299 baseline lines, 290 appear verbatim. The 9 that do not are exactly: the two old import lines; the two `__filename`/`__dirname` lines; the `express.static` line; the `parseNaturalLanguageRequest(..., new Date())` line; and the three function headers that gained `export`. You can repeat this with `git show b68ef0e:server.js` against `lib/app.js`, `lib/plan.js`, `server.js`.

One thing that is different in kind, not in behaviour: `publicDir` defaults to `path.join(<lib>, "..", "public")`, the same folder as before, now resolved from `lib/`.

## 5. Tests

Command: `npm test` → **84 tests, 22 suites, 84 pass, 0 fail, 0 skipped, 0 todo**, about 2 seconds. `npm run check` passes. `npm audit` → "found 0 vulnerabilities" (was 1 critical, 1 moderate).

What they cover:
- `time.test.js` (24): time parsing and formatting; weekday independent of machine timezone; date validity; inclusive ranges over month, year and leap day; the 400-day guard; default open day 07:00–23:00; sleep override and the 06:00–23:30 bounds; unlisted days closed; day off; unavailable dates; late window cut by default sleep; commitments splitting windows, by weekday, by date; the 20-minute threshold at 19 and 20; calendar totals; `fitsInWindow` at exact edges, outside, reversed, wrong day, across a gap.
- `schema.test.js` (15): limits and defaults of all five schemas, required fields, enum rejection, time format, unknown keys dropped.
- `plan.test.js` (12): calendar errors and their exact Albanian messages, exactly 180 days allowed, `fromDate`, sanitising order and dropped list, statistics rounding, `extractJsonPayload` on fenced, wrapped, empty, object-less and truncated answers.
- `routes.test.js` (33): real HTTP against `createApp` on an ephemeral 127.0.0.1 port with fake AI functions and a fixed clock. Health; static page; files outside `public` not served; API 404; malformed JSON 400; oversized body 413; no-key mode answers 503 on all three routes before validation and never calls the AI; for each AI route: the success shape, what the AI function receives (inputs, computed calendar, adaptation block), invalid bodies 400 without an AI call, date rules, zero capacity, `ok:false` → 502, thrown provider errors 401/429/402/400/500/none mapped to the safe messages with the provider's text absent from the answer; server-side logging of validation failures.

**Known defects pinned (17 tests, each named `KNOWN DEFECT <id>`)**: P0-3 impossible dates accepted and shifted (function, schema and route level); P1-5 overnight commitment on the wrong day; P1-6 reversed availability window becomes two; P1-3 five-minute session fits, overlapping and duplicate sessions kept and double counted; P3 `24:30` accepted; P0-5 unbounded commitments; P1-4 all-dropped plan answers 200 on create and on adjust, adjust adds no warning, adjust calls the AI with zero capacity; P0-1 server half, ids restart at `a1`; finished plan refused with the start-date message.

**Do the tests actually bite?** VERIFIED by mutation: I introduced twelve single deliberate bugs, one at a time, ran the suite, and restored the file (byte-identical afterwards, checked with `cmp`). All twelve were caught:
minimum window 20→15 (1 failure); default sleep end 07→08 (8); unlisted day treated as open (1); `fitsInWindow` `<=`→`<` (2); 180-day limit→365 (2); sanitiser keeps everything (5); 429 mapped to 502 (2); zero-capacity check removed (1); adjust plans from plan start instead of today (3); profile echoed whole instead of name only (1); text limit 2000→5000 (2); key check removed (1).

## 6. Behaviour unchanged — evidence

- VERIFIED: real server started as before (`PORT=3987 OPENROUTER_API_KEY= node server.js`): same three startup lines; `/api/health` 200 with `aiConfigured:false`; `/api/parse` 503 with the same message; `/api/nope` 404; `/package.json` and `/lib/app.js` 404; served `index.html`, `script.js`, `style.css` byte-identical to the files.
- VERIFIED: the Batch 0 browser script rerun against the refactored server gives measurements identical to Batch 0 for all 21 screens, the keyboard walk and the corrupted-storage case (compared programmatically; the rerun's output files were then discarded so the Batch 0 evidence stays as committed).
- NOT TESTED: any path with a real provider; `SIGINT` shutdown; `EADDRINUSE` handling (code unchanged, not exercised).

## 7. Impact

- Product and UX: none visible.
- Architecture: the app can be constructed without a key or network, which Phase 1 needs for every fix; pure plan logic is importable. API shapes and business rules unchanged.
- Security: two advisories closed. Nothing else changed.
- Dependencies: none added. Disk cost zero.
- Regression risk: confined to the mechanical move; covered by section 4 and section 6.

## 8. Deviations from the instruction

- `engines.node >=22` added to `package.json`: not listed in your scope. Reason: the test runner features used (`node --test` discovery, `mock.method`) and the browser script's built-in WebSocket need it, and the README states it. Remove on your word.
- `npm run check` script added alongside `test`; small, same spirit as your "syntax checks reported".
- `extractJsonPayload` in `lib/ai.js` got tests although you did not list it; it was already exported and is the first line of defence against model output. `lib/ai.js` itself is untouched, so `chatCompletionWithFallback` and `callForJson` (model walk, retries, repair loop) remain **untested**: testing them needs the OpenAI client to be injectable in `lib/ai.js`, which I left for your decision because it edits a file outside the listed minimal seam.

## 9. Known gaps after this batch

- The frontend has no automated tests. Its logic (storage, plan merge on adjust, statistics, streak, form parsing) lives in one script with DOM globals and cannot be imported. The client half of P0-1 is therefore not pinned by a test, only described.
- The model fallback and repair loop in `lib/ai.js` are untested (see above).
- No live AI evidence of any kind. Still waiting for the owner's key.

## 10. Git

Branch `main`, no remote. Commits: `b68ef0e` baseline; handoff and evidence; this batch (see `git log --oneline`). Working tree clean after the commit. Nothing discarded except regenerated copies of my own screenshot files.

## 11. Recommended next batch (Phase 1: correctness and reliability on the server)

Each item starts by flipping its `KNOWN DEFECT` test, then the fix.

1. P0-3: real calendar validation of dates in schema and `isValidDateStr`.
2. P0-1 server half: session ids unique across adjustments (the route cannot know earlier ids, so either the client sends the highest used number, or ids become collision-free by construction; I suggest `crypto.randomUUID()`-based ids, which changes the id format but not the contract's shape. Your ruling, since you froze contracts).
3. P1-3: overlap removal, minimum session length (20 minutes, matching the window rule), sessions sorted.
4. P1-4: honest warning text; zero kept sessions → error, on both routes; zero-capacity check and drop warning on adjust; finished plan gets its own message.
5. P1-5: overnight commitments spill into the next day.
6. P1-6: field-level validation errors (`{ error, fields: [{ path, message }] }`, additive to the contract) and tolerant time parsing (`9:00` accepted and normalised).
7. P1-1: overall deadline with `AbortSignal` through `lib/ai.js`, plus making the OpenAI client injectable and testing the fallback and repair loop.
8. P0-5 and P2-11: in-process rate limit per IP on the three AI routes, a global concurrency cap, security headers, `X-Powered-By` off, array caps in the schemas. No new dependency required; say if you prefer `express-rate-limit` and `helmet`.
9. P1-13: the client's local date and timezone sent with parse and used by the server instead of the server clock (additive, optional field so the old frontend keeps working).

The client half of P0-1, the plaintext passwords (P0-2) and everything visual belong to the client phases, unless you want an interim patch of the old `public/script.js` for the two P0s now: it is about 15 lines for P0-1 (keep every non-pending session, replace only pending ones from today) and would protect current users during the weeks the new client takes. I recommend that interim patch for P0-1; for P0-2 the honest fix is the local-profile redesign, not a patch.

Also due before broad client work, per your D6: two static visual directions for the owner.

## 12. Handoff

This report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/03-batch-1-report.md`. Codex has not read this yet.
