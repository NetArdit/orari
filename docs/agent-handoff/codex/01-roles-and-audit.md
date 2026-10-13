## Proof of access

- `package.json` description: **`"AI powered personal study planner"`**
- `lib/time.js`: **`const MIN_USABLE_MINUTES = 20;`**

I read the project files directly. Node reports `v24.20.0`; `npm.cmd --version` reports `11.19.0`. The folder is not inside a Git repository, and no README, AGENTS.md, test suite, lint script, or build script appeared in the repository listing. `package.json` has only `start` and `dev` scripts.

## Roles and handoff

I’m Codex, the independent technical reviewer and decision gate: I’ll verify repository evidence, assess Claude’s reports, and set bounded implementation instructions. Claude is the execution engineer and researcher, responsible for inspection, implementation, and reporting. The requested workstreams should remain distinct in reports, but no independent agents should be claimed unless they were actually used.

The kickoff describes Claude saving requests and reports under `docs/agent-handoff/`, and Codex CLI saving replies under `docs/agent-handoff/codex/`. I confirmed the request file and `codex/` directory exist; I did **not** find a Claude report or a saved Codex reply. I have no separate Claude messaging integration available in this session, and I cannot write files here. This reply is the Codex response for the kickoff; Claude should save it through the stated CLI `-o` handoff if that mechanism is being used.

For each batch, send the approved scope, changed files, actual commands and results, browser checks, limitations, Git state, and exact evidence. I’ll review the report and relevant files before issuing the next instruction.

## Independent Stage Zero/One audit

This assessment is independent of a Claude audit; I have only seen the kickoff and its repository summary. Findings below are based on source inspection unless labeled otherwise. I did not boot the server, call endpoints, or open the UI in a browser.

### Product and behavior to preserve

**VERIFIED:** The app is a study planner branded **StudyFlow** in the UI, despite being in `orari-main`. A user can register or log in locally, create plans through natural-language parsing or a guided form, review and track sessions, view dashboard statistics and plan history, and request an adjusted plan.

**VERIFIED:** The backend exposes `/api/health`, `/api/parse`, `/api/create-plan`, and `/api/adjust-plan`. It validates request and AI response shapes with Zod, computes availability windows deterministically, and drops AI sessions that fall outside those windows. Plans and session status are saved in browser `localStorage`; I found no server-side user or plan persistence.

**VERIFIED:** Scheduling rules include an inclusive date range, a 180-day API limit, a default waking window of 06:00–23:30, default sleep from 23:00–07:00, and a 20-minute minimum usable free window. If weekly availability is omitted, the time engine assumes its default waking window; if availability is specified for some days, unspecified days are unavailable. These are existing behaviors to preserve or explicitly review before changing.

### Prioritized issue register

**P0 — None confirmed from source inspection.** Runtime and deployment behavior remain untested.

**P1 — Local credentials are stored in plaintext.** Registration stores the password with the user object, and login compares that stored value directly. Both the user list and current user live in `localStorage`. This is not server authentication and exposes credentials to scripts running in the origin and to anyone with access to the same browser profile. [script.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/script.js:11)

**P1 — Invalid calendar dates pass the date-shape check.** The schema checks only `YYYY-MM-DD`; `isValidDateStr` relies on `Date.parse`, which can accept and normalize impossible dates. A date such as February 31 therefore needs a regression check against the calendar and API validation path. [schema.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/schema.js:7) · [time.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/time.js:39)

**P1 — Clarifying questions can be silently bypassed.** The frontend displays the AI’s clarification panel only when both start and end dates are absent. A response that asks about missing availability or another critical detail while including both dates proceeds to confirmation instead. [script.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/script.js:540)

**P1 — Session sanitization does not prevent overlapping sessions.** The server checks each session against free time, but does not compare sessions with one another. Two AI-proposed sessions could overlap while both fit inside the same free window. [server.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/server.js:140)

**P1 — Deployment exposure is unknown.** The AI routes have input validation and a JSON size limit, but I found no application-level authentication or rate limiting. If the API is publicly reachable, the AI endpoints could be invoked by other callers. Deployment status and any upstream protections are **UNKNOWN**. [server.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/server.js:35)

**P2 — Guided form duplicates the material field into `goal`.** The same input is sent as both `materialAmount` and `goal`, which may make AI instructions ambiguous. Confirm intended meaning before changing the data contract. [script.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/script.js:471)

**P2 — No automated verification is configured.** The package has no test, lint, type-check, or build scripts. This makes schedule rules, API boundaries, and UI flows hard to regression-check. **NOT TESTED:** no baseline checks were run in this audit.

**P2 — Accessibility needs a focused pass.** The inspected HTML has labels without `for` associations, and I found no ARIA attributes. The stylesheet removes outlines on some controls, although field controls add a focus style. Full keyboard, screen-reader, and contrast behavior is **NOT TESTED**. [index.html](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/index.html:63) · [style.css](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/style.css:170)

**P2 — AI data handling and free-tier reliability need review.** The backend sends study details to OpenRouter and lists free model IDs with fallback/retry behavior. External data handling, current model availability, and free-tier limits were not independently checked. **NOT TESTED.** [ai.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/ai.js:10)

**P2 — Resilience and mobile behavior are unverified.** `localStorage` parsing has no recovery for malformed stored JSON. CSS defines responsive breakpoints at 850px and 650px, but no browser or device checks were performed. [script.js](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/script.js:15) · [style.css](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/public/style.css:1848)

## Decisions

**Git baseline: Yes.** Initialize a local repository and make a baseline commit before implementation. Update `.gitignore` first to exclude `node_modules/` and environment files, then check the staged file list carefully so secrets and dependencies are not committed. Keep it local; do not push. This gives later work a reviewable diff and rollback point.

**Baseline checks to run and report:**

- Record `git status`, `git diff`, `git ls-files` after initialization, plus `node --version`, `npm.cmd --version`, and `npm.cmd run`.
- Run syntax checks for `server.js`, `lib/*.js`, and `public/script.js`.
- Start the server without a real API key and capture startup output plus `/api/health`. Confirm the expected unconfigured-key behavior.
- Exercise malformed JSON, oversized JSON, unknown API routes, and missing-key AI requests. With no key, `requireAiConfigured` runs before route body validation, so these requests cannot establish the Zod validation paths.
- To check invalid-body validation without contacting the provider, use an isolated process with a deliberately fake key and send only invalid request bodies; do not send valid AI requests in that process.
- Capture screenshots at phone, tablet, and desktop widths, and note browser/version, viewport dimensions, and any overflow or keyboard issues.

**Migration direction: defer final approval until both audits are compared.** The evidence supports evaluating a `client/` Vite + React app while keeping `server.js`, API contracts, and scheduling logic in place. TypeScript is a reasonable recommendation because the app has structured request/response contracts and existing Zod schemas, but it adds tooling and migration cost. Keep the existing frontend until the replacement can be cut over safely. Before choosing versions or dependencies, check current official documentation and available disk/tooling constraints. No migration is approved in this audit response.

**Design-system direction:** Carry forward a restrained, high-contrast planner interface with consistent spacing, typography, form states, and responsive layouts. The current CSS already uses dark surfaces and a green accent; treat that as evidence, not a mandate. Define and review tokens and component patterns after the audits are compared. Avoid adding motion libraries unless a specific interaction benefits from them.

## Next instruction for Claude — Batch 0: baseline and audit comparison

- **Goal:** Establish a recoverable local baseline and return evidence that completes the audit comparison.
- **Scope:** Initialize local Git after reviewing ignore rules; run the safe checks listed above; capture responsive screenshots; document routes, flows, data contracts, and remaining findings in the handoff report.
- **Exclusions:** No frontend or backend edits, dependency installation, valid AI requests, real credentials, paid services, push, deploy, or broad migration.
- **Acceptance criteria:** A local baseline commit exists with no secrets or `node_modules`; safe checks have exact results; checks blocked by missing configuration are identified; screenshots show the tested browser and viewport; audit findings distinguish verified evidence from inference and untested behavior.
- **Required evidence:** `git status` and baseline commit ID; package scripts and runtime versions; exact commands/output for checks; health/API responses with secrets omitted; screenshots and browser details; handoff report path and current project state.

## STATE UPDATE

Copy into `PROJECT_STATE.md`:

```text
Gate: Stage Zero/One audit; no implementation batch approved.
Verified: Node v24.20.0; npm.cmd 11.19.0; repository folder is not a Git repository; package scripts are start/dev only; frontend is plain HTML/CSS/JS; backend is Express with Zod schemas and OpenRouter AI calls; user/plans persist in localStorage.
Not tested: Server boot, API behavior, browser layouts, accessibility, AI provider behavior.
Current handoff: docs/agent-handoff/requests/01-kickoff.md exists; docs/agent-handoff/codex/ exists; no Claude report or saved Codex reply was found during this audit.
Next action: Claude to establish a local baseline, run safe baseline checks, capture responsive screenshots, and submit the evidence for audit comparison.
```

Copy into `CODEX_DECISIONS.md`:

```text
Decision: Recommend local-only Git initialization and a baseline commit after excluding node_modules and environment files; do not push.
Decision: Defer final Vite/React/Tailwind architecture approval until Claude and Codex audits are compared. Evaluate TypeScript based on schema reuse, tooling cost, and migration risk.
Decision: Preserve server.js, API contracts, and scheduling rules during frontend migration unless a separately approved finding justifies a change.
Verdict: Audit only; no implementation approved.
```