# CLAUDE REPORT 01 — Stage Zero baseline and independent audit

Date: 2026-10-14. Author: Claude Code. Status: **VERIFIED COMPLETE for the read-only audit; BLOCKED for anything that needs a live AI call** (no API key on this machine).

Independence note: I wrote this before reading `docs/agent-handoff/codex/01-roles-and-audit.md`. While checking that the Codex call had exited cleanly I saw the last ~300 characters of its output (a recommendation to initialise git locally and to defer the migration architecture). Nothing else of Codex's reply influenced this report.

No source file of the application was changed. Files I created: everything under `docs/agent-handoff/`. Probe scripts and logs were kept outside the project.

---

## 1. Handoff mechanism (what actually happened)

- VERIFIED: there is no direct Claude-to-Codex integration. The channel is `codex exec --sandbox read-only --skip-git-repo-check`, run by me from the project root with a message piped on stdin; the CLI writes Codex's final reply to a file with `-o`.
- VERIFIED: call 01 exited with code 0, model `gpt-6-luna`, sandbox `read-only`, and wrote 12,070 bytes to `docs/agent-handoff/codex/01-roles-and-audit.md`.
- Paths: owner's operating system `docs/agent-handoff/OPERATING-SYSTEM.md`; my messages `docs/agent-handoff/requests/NN-*.md`; Codex replies `docs/agent-handoff/codex/NN-*.md`; this report `docs/agent-handoff/CLAUDE_REPORT.md`.
- NOT YET DONE: `PROJECT_STATE.md` and `CODEX_DECISIONS.md` are created after I read Codex's reply, from its own words.

## 2. Stage Zero — repository facts

- VERIFIED: not a git repository. No README, AGENTS.md, tests, linter, type checker, build step, CI, or `.env`/`.env.example`. `.gitignore` holds one line, `.env`. `node_modules` is present and not ignored.
- VERIFIED: `package.json` name `studyflow`, description "AI powered personal study planner", `"type": "module"`, scripts `start` (`node server.js`) and `dev` (`node --watch server.js`).
- VERIFIED installed versions (`npm ls --depth=0`): express 5.2.1, openai 7.5.0, zod 3.25.76, dotenv 16.6.1. Node 24.20.0, npm 11.19.0.
- VERIFIED: `.vscode/launch.json` launches Chrome against `http://localhost:8080`; the server listens on 3000. Stale.
- VERIFIED file sizes: `server.js` 12.9 KB (366 lines); `lib/ai.js` 14.5 KB; `lib/schema.js` 4.9 KB; `lib/time.js` 7.7 KB; `public/index.html` 26 KB (990 lines); `public/script.js` 36.5 KB (1,182 lines); `public/style.css` 22.3 KB (about 1,950 lines).
- VERIFIED: the only environment variables read are `OPENROUTER_API_KEY` and `PORT`.
- Machine: Windows 10, about 4 GB RAM, **2.1 GB free on C:** (99% full). Microsoft Edge is installed (usable headless for browser checks without downloading a browser).

## 3. Baseline checks actually run

Command: `PORT=3987 OPENROUTER_API_KEY= node server.js`, then `curl` against it; server stopped afterwards.

- VERIFIED: boots without a key and logs the "AI not configured" warning.
- VERIFIED: `GET /api/health` → 200 `{"success":true,...,"aiConfigured":false}`.
- VERIFIED: `GET /` → 200, `Cache-Control: public, max-age=0`, header `X-Powered-By: Express` present, no security headers.
- VERIFIED: `POST /api/parse`, `/api/create-plan`, `/api/adjust-plan` without a key → 503 "AI nuk është konfiguruar ende." The key check runs **before** body validation, so without a key no validation path of these three routes can be exercised over HTTP.
- VERIFIED: malformed JSON → 400; 150 KB body → 413; unknown `/api/*` → 404 JSON; unknown non-API path → Express's default English HTML 404 ("Cannot GET /nope").
- VERIFIED: `/package.json` and `/../server.js` are not served.
- VERIFIED: `npm audit --omit=dev` → **2 vulnerabilities (1 critical in `proxy-addr`, 1 moderate in `qs`)**, both transitive through Express, both with "fix available via `npm audit fix`". Not applied (it changes the lockfile; needs your approval).
- VERIFIED by a Node probe importing `lib/time.js` and `lib/schema.js` directly (results quoted in the register below).
- BLOCKED: every AI-backed behaviour (parse, plan generation, adjustment, model fallback, whether the four model ids in `lib/ai.js` still exist on OpenRouter). Reason: no key. Needs the owner to put a free OpenRouter key in `.env`.
- NOT TESTED: browser rendering at any width, keyboard behaviour, screen-reader output. I read the markup and CSS; I did not open a browser yet (deliberately not run while Codex was running, the machine cannot hold both). Proposed as the first thing in the next batch.

## 4. What the product is (from the code, not from history)

The repository is **StudyFlow**, an Albanian-language study planner. "Orari" is the folder name only; the brand in the UI is StudyFlow everywhere. Which name the owner wants is UNKNOWN.

A learner describes what they must study, the period, when they are free and what occupies them; the server computes the free time windows deterministically; a language model places study sessions inside those windows; the server drops any session that does not fit; the browser stores the plan and lets the learner tick sessions off and ask for a re-plan after missing some.

### Screens and controls (VERIFIED by reading `public/index.html` and `public/script.js`)

One HTML page, sections toggled by class. No URL routing: refresh always lands on the dashboard, the back button leaves the app, no screen can be linked.

1. **Auth card**: login (email, password ≥ 6), register (name, email, password, education level select, school/class free text). Switch links are `<p>` elements with click handlers.
2. **Dashboard**: welcome with "Krijo plan"; "Sot" list; "Sesioni tjetër"; plan-health banner with "Rregullo planin" (shown only when the newest unfinished plan has past pending sessions); five stat cards (plans, completed, missed, hours, streak); last five plans.
3. **Planner**, two modes:
   - Natural language: textarea (max 2,000) → `POST /api/parse` → either a list of clarifying questions, or a confirm panel with six editable fields (subject, plan mode, start, end, difficulty, session length) plus goal, and a **read-only** summary of availability, commitments and energy → `POST /api/create-plan`.
   - Guided form: subject, material, plan mode, difficulty, dates, session length, energy ×3, weekly availability (seven free-text inputs like `08:00-10:00, 20:00-21:30` plus an "Off" checkbox), commitments (rows: label, type, days as free text `mon,tue,wed`, start, end) → `POST /api/create-plan`.
   - Result: stats, strategy, warnings, sessions grouped by date, each with three status buttons (done, partial, skipped; clicking the selected one returns it to pending).
4. **Plans**: every plan as a card; click expands its sessions with the same status buttons.
5. **Profile**: read-only name, email, education, school.
6. Logout.

### API (VERIFIED, `server.js`)

- `GET /api/health`
- `POST /api/parse` `{text}` → `{parsed}` (schema `ParsedRequestSchema`)
- `POST /api/create-plan` `{profile, structured}` → plan with `sessions[{id:"sN", status:"pending", date, startTime, endTime, type, title, goal, tasks, material, difficulty}]`, `stats`, `strategy`, `explanations`, `warnings`
- `POST /api/adjust-plan` `{profile, structured, progress}` → same shape, ids `aN`, calendar starting at `progress.today`

### Persistence (VERIFIED)

Browser `localStorage` only: `studyflow_users` (array of users, each with **plaintext password** and all plans) and `studyflow_current_user` (a full copy of one user, password included). The server stores nothing.

### Business rules that exist today and should be preserved (VERIFIED in `lib/time.js`, `server.js`)

1. The model never does date or time arithmetic; the server computes free windows.
2. Study is never scheduled outside 06:00–23:30.
3. Sleep 23:00–07:00 is protected by default unless a commitment of type `sleep` applies to that day.
4. If no availability is given at all, every day is open within the bounds; if availability is given for some days, the other days are closed.
5. A day marked off, or listed in `unavailableDates`, has no windows.
6. Commitments subtract from availability; a window crossing midnight is split.
7. Free windows shorter than 20 minutes are discarded.
8. A plan may span at most 180 days; start must not be after end.
9. A session proposed by the model is kept only if it lies entirely inside one free window of its date.
10. Plan creation is refused when total free capacity is zero.
11. Dates are handled as timezone-free `YYYY-MM-DD` strings in UTC arithmetic.
12. Model output is extracted defensively, validated with Zod, retried once with a repair instruction; the model list is walked on rate limits and outages; errors reach the user as safe Albanian messages, never raw provider text.
13. Status toggling: completed / partial / skipped / pending; partial counts as half the minutes; a pending session before today counts as missed; streak counts consecutive days ending today or yesterday.

## 5. Issue register

Severity follows the operating system: P0 correctness/data loss/security, P1 core workflow and reliability, P2 high value, P3 polish. Evidence is file and line of the current tree.

### P0

**P0-1. Re-planning deletes today's progress and produces duplicate session ids.** VERIFIED by reading.
`public/script.js:1065-1068` keeps only sessions with `date < today` and replaces the rest, so sessions completed **today** are deleted when the learner presses "Rregullo planin". `server.js:306` numbers adjusted sessions `a1, a2, …` on every call, so after a second adjustment the kept past sessions and the new ones share ids; `updateSessionStatus` (`script.js:732`) uses `find`, so ticking a new session changes an old one. Impact: lost progress, wrong statistics, wrong session marked. Fix: ids unique per plan generated server- or client-side from a counter or UUID; keep every session that has a non-pending status; replace only pending sessions from now on. Verify: unit tests on a pure merge function, plus a browser journey.

**P0-2. The login is not authentication, and it stores passwords in plain text.** VERIFIED (`script.js:140-153`, `:171-173`, `:42-48`).
Accounts live in the visitor's own browser; anyone with the device or any script on the origin reads every password with one line; the password is copied a second time into `studyflow_current_user`. People reuse passwords, so the form collects a real secret and protects nothing. There is no reset, no sync, and clearing the browser deletes the "account" and all plans. Impact: false sense of security and real credential exposure, total data loss on browser clear. This is a product decision, see section 9, decision D1.

**P0-3. Impossible calendar dates are accepted and silently moved.** VERIFIED by probe: `isValidDateStr("2026-02-31")` is `true` and `dateRange` turns it into `2026-03-03`; `2026-04-31` becomes `2026-05-01`. (`lib/time.js:39-41`, `:47-50`.) The schema regex accepts them too. Browser date inputs prevent this for humans, but the natural-language path takes dates from the model, which does produce such dates. Fix: round-trip check (format the parsed date back and compare). Verify: unit tests.

**P0-4. Critical-severity advisory in the dependency tree.** VERIFIED (`npm audit`): `proxy-addr` critical, `qs` moderate. Real exposure here is low (no `trust proxy`, bodies are JSON), but it is a one-command fix. Fix: `npm audit fix` and re-run the baseline. Needs approval because it rewrites the lockfile.

**P0-5. No abuse protection on endpoints that spend a shared free quota.** VERIFIED: no rate limit, no per-client cap, no concurrency cap (`server.js`). One open tab in a loop exhausts the OpenRouter free allowance for everyone, and each request can hold a connection for a very long time (see P1-1). Fix: small in-memory limiter per IP (no new dependency needed, or `express-rate-limit`, MIT), a global concurrency cap, security headers. Verify: integration tests with a mocked AI client.

### P1

**P1-1. A single request can run for minutes with no feedback and no way to cancel.** VERIFIED by reading `lib/ai.js:30-35, 54-92, 136-213`: 4 models × up to 2 tries × 25 s timeout, and the whole chain runs up to 2 times → worst case about 400 s plus sleeps. The browser shows only a changed button label, sets no timeout and offers no cancel (`script.js:521-560, 657-692`). Fix: an overall server deadline (for example 60–75 s) passed down as an `AbortSignal`; client-side abort, visible progress, cancel, retry.

**P1-2. Long plans very probably cannot be generated.** INFERRED, NOT TESTED (no key). A 180-day calendar is sent in one prompt and all sessions are expected in one JSON answer with no `max_tokens` set (`lib/ai.js:287-316`); free models truncate, which lands in "malformed_json" and the user sees "AI gjeneroi një plan të paplotë". Fix options to decide: generate week by week with a deterministic outline, or cap the horizon honestly. Needs measurement with a real key.

**P1-3. Sessions are checked against windows but not against each other.** VERIFIED (`server.js:140-153`): two sessions overlapping inside the same window both pass; sessions of 5 minutes pass (probe: `fitsInWindow(...,"21:00","21:05")` → true); nothing enforces the preferred session length. `computeStats` then double-counts. Fix: sort per day, drop or trim overlaps, minimum duration. Unit tests.

**P1-4. Dropped sessions are reported as "adjusted", and an all-dropped plan is returned as success.** VERIFIED (`server.js:215-237`): the warning says sessions "u rregulluan" while they were removed; if every session is dropped the response is a 200 with zero sessions and the client saves an empty plan. `adjust-plan` has no zero-capacity check and no warning about drops at all (`server.js:289-306`).

**P1-5. Commitments crossing midnight are applied to the wrong day.** VERIFIED by reading and probe (`lib/time.js:151-164`, `:79-87`): "Monday 22:00–06:00" blocks Monday 00:00–06:00 and Monday 22:00–24:00, not Tuesday morning. The default sleep rule hides it for typical hours, but a shift such as Monday 20:00–10:00 blocks Monday morning wrongly and leaves Tuesday 07:00–10:00 open.

**P1-6. The guided form can produce a request the server rejects with a meaningless message.** VERIFIED by probe: the form accepts `9:00-10:00` (`script.js:303`), the server schema requires `09:00` and answers "Na mungojnë disa të dhëna" (`server.js:178`). Also: malformed windows are dropped silently; `20:00-08:00` is treated as two windows, 07:00–08:00 and 20:00–23:00 (probe); server validation errors never say which field.

**P1-7. Availability and commitments understood by the AI cannot be corrected.** VERIFIED (`script.js:576-603`, `:637-638`): the confirm panel shows them as text and sends them unchanged. If the model misread the working hours, the only recourse is to rewrite the paragraph and hope. Energy is shown as raw English enum values ("high"). This is the core flow of the product.

**P1-8. Clarifying questions are a dead end.** VERIFIED (`script.js:540-547`): shown only when both dates are missing, with the instruction to edit the text above and try again; if dates exist the questions are discarded unseen. Answers cannot be typed next to the questions.

**P1-9. No way to delete, rename, duplicate or edit a plan; no way to edit the profile; no way to export or back up data.** VERIFIED: no such handlers exist. Combined with browser-only storage this means one cleared cache ends the product for that learner.

**P1-10. Storage is fragile.** VERIFIED: `JSON.parse` of a corrupted value throws at load and the page never opens (`script.js:17-19, 34-38, 1178`); no handling of quota errors on write; the whole user object with all plans is duplicated in two keys and rewritten on every tick; two tabs overwrite each other; no schema version, so any later shape change breaks old data.

**P1-11. Accessibility failures that block keyboard and screen-reader users.** VERIFIED in markup/CSS, NOT TESTED with assistive technology:
- No `<label for>` anywhere; labels are not associated with inputs (`index.html`, all fields). Commitment rows and availability inputs have no labels at all, only placeholders.
- "Regjistrohu"/"Hyr" switches are `<p>` with click handlers: not focusable (`index.html:101-107, 217-223`). Plan cards are clickable `<article>` elements: not focusable, no expanded state (`script.js:1146`).
- `outline: none` on inputs, textarea and others (`style.css:186, 1102, 1378, 1429`); buttons have no visible focus style.
- Errors and results are not announced: no `aria-live`, errors by `alert()`.
- Navigation has no `aria-current`; mode toggle and status buttons have no pressed state; icon glyphs (⌂ ＋ ▤ ○ ✕) are read aloud; the remove button is just "✕".
- No `prefers-reduced-motion` handling for the entry animations and smooth scrolling.
- Status is conveyed by colour on the status buttons and type badges.

**P1-12. Error and feedback handling by `alert()`.** VERIFIED (`script.js:626, 685, 1077, 1081`). Blocks the page, cannot be styled, loses the message on dismissal, no retry.

**P1-13. "Today" and "now" disagree between client and server.** VERIFIED by reading: the server gives the model the UTC date with the server-local weekday name (`lib/ai.js:237-240`), the client uses the local date (`script.js:287-290`). Around midnight in Kosovo (UTC+1/+2) "tomorrow" resolves to the wrong date. Fix: the client sends its own local date and IANA zone; the server never guesses.

**P1-14. Nothing is tested.** VERIFIED: zero tests for date logic that the whole product stands on. Any migration without a characterisation suite is unsafe.

### P2

- **P2-1. Profile data is collected under a claim that is not true.** VERIFIED: the profile page says "Të dhënat që AI përdor për personalizimin e planeve"; `educationLevel` is sent but never passed to the model, `school` never leaves the browser (`server.js:181`, `lib/ai.js:287-307`). Either use it or stop saying so.
- **P2-2. The guided form writes the same field into two meanings**: `materialAmount` and `goal` both come from `f_material` (`script.js:475-476`).
- **P2-3. Days of the week typed as English codes** (`mon,tue,wed`) in an Albanian interface; wrong tokens vanish silently (`script.js:415, 441-444`). Needs day chips. Availability typed as free text needs time pickers with add/remove.
- **P2-4. No dates for one-off events**: `unavailableDates` and commitment `dates` exist in the schema and the engine but no control sets them (`script.js:480, 639`). An exam week, a trip or a holiday cannot be entered.
- **P2-5. Dashboard "Sot" is not actionable**: sessions listed without status, cannot be ticked there (`script.js:936-958`). "Next session" ignores a session in progress.
- **P2-6. Statistics mix meanings**: a plan card counts only `completed`, the dashboard counts `partial` as completed; "missed" counts both skipped and overdue.
- **P2-7. No calendar or week view** of a product whose output is a timetable; only a long list. No "add to my calendar" (.ics export costs nothing and needs no service).
- **P2-8. No routing**: no deep links, back button exits, refresh loses the place and the unsaved form.
- **P2-9. The model list is hard-coded and ages** (`lib/ai.js:30-35`): free model ids disappear regularly. Should be configuration with a boot-time or lazy health check. `HTTP-Referer` is hard-coded to `http://localhost:3000`.
- **P2-10. Privacy**: free-text life details (work hours, family, sleep) go to third-party free models, some of which train on prompts under OpenRouter's free-tier terms; the interface says nothing. A short honest notice is needed. Google Fonts is loaded from Google's servers; self-hosting the font removes a third party and a render-blocking request.
- **P2-11. Server hardening basics missing**: `X-Powered-By` exposed, no CSP or other security headers, no compression, no caching policy for static assets, logs print user-derived text (`server.js:177, 218`).
- **P2-12. Text quality**: mixed register and English leftovers ("Dashboard", "Password", "Off", "streak", "AI PLANNER"), "Kjo email", "sesion/seancë" used interchangeably, plan mode shown raw in plan cards (`script.js:1139` prints `exam`). Needs one pass as copy, in natural Kosovo Albanian.
- **P2-13. Dark theme only**, 18–24 px radii, green-on-black gradient glow, blurred glass card: reads as a stock "AI app" template. Only two breakpoints (850 px, 650 px). NOT TESTED in a browser yet.
- **P2-14. Owner request of 2026-10-14 (new feature): study material → flashcards and quizzes.** See section 8.

### P3

- Stale `.vscode/launch.json`; no README or `.env.example`; `package.json` has no `engines`; unused exports (`totalCapacityMinutes`, `DEFAULT_SLEEP`, `extractJsonPayload`); inline styles in `createPlanCard`; `timeToMinutes` accepts `24:30`; duplicated time helpers on client and server; favicon missing; non-API 404 page is Express's English default.

## 6. Migration recommendation (React + Tailwind), for your ruling

Evidence used: the repository; `npm view` on 2026-10-14 for current versions; engineering judgment. I have **not** read the current official migration or installation guides yet; I will before writing any configuration, and say so in that batch's report.

Current published versions (VERIFIED with `npm view`): react 19.3.0, vite 8.3.4 (Node ^20.19 or ≥22.12), @vitejs/plugin-react 6.1.2, tailwindcss 4.3.3 with @tailwindcss/vite 4.3.3, typescript 7.0.2, vitest 5.0.4 (Node 22.12+/24), @testing-library/react 16.3.3, playwright-core 1.64.0. All MIT or Apache-2.0. Node 24.20 here satisfies all of them.

Recommended shape:

1. **Vite + React 19 + Tailwind 4 in a `client/` folder**, built to `client/dist`, served by the existing Express app in production; in development Vite proxies `/api` to Express. The server keeps its three routes and its `lib/`. Not Next.js: there is no server rendering need, it would replace a working backend, and it is heavy for this machine.
2. **TypeScript: yes for the client, strict.** Reason from this codebase: the bugs found are data-shape bugs (session ids, status values, plan merge, storage shape), the contracts already exist as Zod schemas, and `z.infer` gives the client the server's types for free from one shared module. Server files stay JavaScript for now with `// @ts-check` and JSDoc where touched; converting them is a separate, later decision. Cost: one more toolchain step; TypeScript 7 is a new major, so I will confirm editor and Vite compatibility before committing to it rather than assume.
3. **Replacement of the frontend, not page-by-page coexistence, but only after a safety net.** The current frontend is one 1,182-line script with global state and no modules; there is no seam to mount React into piece by piece, and running both would mean two implementations of storage. The safe path is: freeze behaviour in tests first, extract the pure logic, then build the React app beside the old one at a separate path until parity is shown, then switch and delete the old files in one reviewed step. Rollback is the previous commit.
4. **State**: React state plus a small typed storage module with a schema version and migration from the existing `studyflow_users` data; no state library. Server calls through one typed client with abort and timeout. A router (hash- or history-based, the smallest that gives deep links) so that screens have addresses.
5. **Tests**: Vitest for `lib/time.js`, session sanitising, plan merge, storage migration (pure functions, fast, fits 4 GB); supertest-style integration tests of the three routes with the AI client injected as a fake; a dependency-free headless-Edge script over CDP for journeys and screenshots at 360, 768 and 1280 px (Playwright's browser download is several hundred MB and the disk has 2.1 GB free; `playwright-core` driving the installed Edge is the alternative if you prefer its API).
6. **Must stay untouched until you rule otherwise**: the three endpoints' request and response shapes, business rules 1–13 above, Albanian safe error messages, existing users' stored plans (migrated, never dropped).

## 7. Design-system direction (proposal, not yet implemented)

Principle: this is a timetable people look at every day, often on a phone between classes. It should read like a well-set planner, not like an AI demo.

- **Identity**: calm, paper-like light theme as the default with a true dark theme, both from the same tokens. One accent colour used for action and "now"; session types distinguished by a small set of hues **and** a shape or label, never colour alone. No glow gradients, no glass blur.
- **Tokens** (Tailwind 4 `@theme`): colour roles (surface, surface-raised, border, text, text-muted, accent, success, warning, danger, and six session-type hues) checked to WCAG AA in both themes; spacing on a 4 px scale; radii 6/10/14; two shadows; type scale of six sizes with a self-hosted variable font (candidate: Inter is already used; I would rather pair a more characterful display face for headings and keep a neutral text face, to be shown as options).
- **Layout**: mobile first. Bottom navigation on phones, sidebar from 1024 px. Breakpoints 640/768/1024/1280. Content width capped for reading.
- **Components**: button (primary, secondary, quiet, danger; sizes; loading), field wrapper (label, hint, error, required mark, always associated), text, textarea, select, date, time range, day chips, segmented control, checkbox/switch, card, session card, week grid, stat, badge, banner, toast with live region, dialog, empty state, skeleton.
- **States**: every async action has idle, working (with what is happening and a cancel), success, failure with the reason and a retry. No `alert()`.
- **Accessibility**: visible focus ring on everything, 44 px touch targets, full keyboard paths, `aria-live` for results and errors, reduced motion respected, real headings and landmarks.
- **Motion**: minimal and purposeful (view transitions, list reordering). The owner's usual GSAP + Lenis toolkit fits marketing pages; I do not recommend smooth-scroll hijacking inside a daily-use tool, and would use it only on a landing page if one is added. Your call.
- **Words**: one glossary (seancë vs sesion, plan vs orar, etc.) decided once and applied everywhere.

I can produce two or three concrete visual directions as static screens for you and the owner to choose from before any broad UI work.

## 8. Owner request received during this cycle (2026-10-14)

The owner wrote (translated): "I think we should also add the ability to put in a text, for example from a PDF file, and turn it into flashcards, so that students who have an exam can prepare for exams with our app too; the AI analyses that lesson unit, extracts the main parts and forms flashcards and quizzes for the student."

This is a scope addition from the person who owns scope. It needs your product and architecture ruling. My input:

- It fits the product: a plan says when to study; cards and quizzes are what to do in a "recall" or "assessment" session. The link between the two (a session opens the deck for its topic) is where the value is, more than a separate feature tab.
- Zero-cost constraints shape it: free models have small context and strict rate limits, so a whole PDF cannot be sent at once. Text must be extracted in the browser (`pdfjs-dist` 6.4.299, Apache-2.0, needs Node ≥22.13 for tooling; runs client-side so the file never reaches our server), chunked, and processed chunk by chunk with progress and resumability. Scanned PDFs have no text; OCR is out of scope unless you say otherwise, and the app must say so plainly instead of failing.
- Correctness risk: models invent facts. Each card should keep a pointer to the source passage so the learner can check it, and cards must be editable and deletable.
- Storage: decks are much larger than plans; `localStorage` (about 5 MB) will not hold them. IndexedDB is the free answer and suggests moving all data there behind the storage module from the start.
- Review scheduling can be deterministic (a simple spaced-repetition rule, tested), in keeping with business rule 1: the model writes cards, code decides when they come back.
- Privacy and copyright: learners will upload textbook chapters; the text goes to third-party free models. Needs the notice from P2-10.
- Suggested placement: after the foundation and the migration of the existing flows, as its own phase, with the storage module designed now so it does not have to be redone.

## 9. Decisions needed

- **D1 (owner, with your recommendation): accounts.** Options: (a) remove the fake login and replace it with a local profile, no password, with export/import of data, honest about being stored on this device; (b) real accounts, which need a server database and password handling, a larger scope that the operating system says requires explicit approval, feasible at zero cost only on free tiers; (c) keep as is, which I advise against. My recommendation: (a) now, structured so (b) can be added later.
- **D2 (owner): name.** "Orari" or "StudyFlow".
- **D3 (owner): an OpenRouter free API key in `.env`**, entered by the owner, never shown to either of us. Until then AI behaviour is tested only against a fake.
- **D4 (you): git init and baseline commit**, `npm audit fix`.
- **D5 (you): migration shape and TypeScript** per section 6.
- **D6 (you, then owner for the look): design direction** per section 7.
- **D7 (you): where the flashcard feature sits in the order.**

## 10. Proposed phases, by risk

- **Phase 0 — Safety net (no visible change).** git init and baseline commit; `.gitignore`; `npm audit fix`; `.env.example`, README; Vitest; characterisation tests for `lib/time.js`, `sanitizeSessions`, `computeStats`, schemas; make the AI client injectable and add route integration tests with a fake; headless-Edge screenshot and journey script with baseline screenshots at three widths. Acceptance: all tests green with counts reported, baseline screenshots stored, no behaviour change.
- **Phase 1 — Correctness on the server (small, tested diffs).** P0-3, P1-3, P1-4, P1-5, P1-13, overall deadline and abort (P1-1), rate limit and headers (P0-5, P2-11), field-level validation errors (P1-6), unique session ids (server half of P0-1). Acceptance: a failing test first for each, then green.
- **Phase 2 — Client foundation.** `client/` with Vite, React, Tailwind, TypeScript; tokens and base components from the approved design; typed API client; storage module with versioning and migration of existing data (IndexedDB if D7 keeps flashcards); router; decision D1 implemented. Old frontend still served. Acceptance: build passes, type check clean, storage migration tested against a copy of real old data.
- **Phase 3 — Flows rebuilt to parity and beyond.** Planner (both modes, with editable availability and commitments, answerable clarifying questions, one-off dates), result and plan views (list and week), dashboard with actionable today, plan management, re-plan with the corrected merge (client half of P0-1), profile edit, export/import, .ics. Each flow specified per section 10 of the operating system before it is built. Acceptance: journey script green at three widths, keyboard path verified, old frontend removed in one step at the end.
- **Phase 4 — Study material to flashcards and quizzes** (section 8).
- **Phase 5 — Polish and release readiness.** Performance budget, accessibility pass with a screen reader, copy pass, deployment notes. No deploy without the owner.

## 11. Batch 0 (issued by Codex in `codex/01-roles-and-audit.md`) — status: VERIFIED COMPLETE

Approved task: local git baseline; safe checks; responsive screenshots; documentation of routes, flows and contracts (sections 4–5 above). Exclusions respected: no frontend or backend edit, no dependency installed, no valid AI request, no real credential, no push or deploy.

**Files changed**
- `.gitignore`: was `.env`; now `node_modules/`, `.env`, `.env.*`, `!.env.example` (your instruction).
- Added, evidence only: `docs/agent-handoff/**` including `evidence/batch-0/browser-baseline.mjs`, 21 PNG screenshots and `report.json`.
- No file under `server.js`, `lib/`, `public/`, `package*.json` was modified. `git diff b68ef0e -- server.js lib public package.json package-lock.json` is empty.

**Git** (VERIFIED)
- `git init -b main`; baseline commit `b68ef0e` "Baseline: project as received, before any change" with exactly 11 files: `.gitignore`, `.vscode/launch.json`, `lib/ai.js`, `lib/schema.js`, `lib/time.js`, `package-lock.json`, `package.json`, `public/index.html`, `public/script.js`, `public/style.css`, `server.js`. No `node_modules`, no `.env` (none exists). Handoff documents are in a second commit. No remote is configured; nothing was pushed.
- Line endings: git warned that LF will be replaced by CRLF on checkout (Windows default `core.autocrlf`). A `.gitattributes` with `* text=auto eol=lf` would stop that; I did not add one without your word.

**Syntax** (VERIFIED): `node --check` passes for `server.js`, `lib/ai.js`, `lib/schema.js`, `lib/time.js`, `public/script.js`. `npm run` lists only `start` and `dev`.

**Server, no key** (VERIFIED): results in section 3.

**Server, fake key, invalid bodies only** (VERIFIED; `OPENROUTER_API_KEY=fake-key-for-validation-only`, port 3988, no valid AI request sent):
- parse `{}` / 2-character text / 2,001-character text → 400 "Përshkrimi mungon ose është shumë i gjatë/i shkurtër."
- create `{}` → 400 "Na mungojnë disa të dhëna për ta krijuar planin."
- create with window start `9:00` → 400 with the same generic message (confirms P1-6; the server log names the path `structured.weeklyAvailability[0].windows[0].start`, the user is told nothing).
- create with end before start → 400 "Data e fillimit duhet të jetë para datës së mbarimit."
- create with a 200-day span → 400 "Periudha e planit është shumë e gjatë (maksimumi ~6 muaj)."
- create with month 13 → 400 "Datat e planit nuk janë valide."
- create with every day off → 400 "Nuk gjenden dritare kohore të lira…"
- adjust without `progress` → 400 "Na mungojnë disa të dhëna për ta rregulluar planin."
- adjust with `today` after the plan's end date → 400 "Data e fillimit duhet të jetë para datës së mbarimit." A finished plan gets a message about a start date the user never entered. New finding, P2.
- NOT TESTED over HTTP: `2026-02-31` (it would pass validation and reach the provider call, which the exclusions forbid). It is VERIFIED at the function level by the probe in P0-3.

**Browser** (VERIFIED; Microsoft Edge 155.0.4283.45 headless, driven over the DevTools protocol; synthetic user and plan seeded into the throwaway profile's localStorage). Viewports: phone 360×800, tablet 768×1024, desktop 1280×800. Seven screens each: login, register, dashboard, planner (text), planner (form), plans with a plan open, profile. Files: `docs/agent-handoff/evidence/batch-0/<viewport>-<nn>-<screen>.png`, numbers in `report.json`. I looked at phone planner-form, phone plans-open and desktop dashboard myself; the other 18 I have not inspected by eye.
- **Phone layout is broken on the two densest screens.** At 360 px the guided form lays out 473 px wide and the open plan 424 px wide (`report.json`: `innerWidth` 473 and 424 with mobile emulation; the screenshots are that wide). On a real phone this is sideways scrolling or cut-off cards. New finding, **P1-15**. The sidebar stays as a 75 px icon rail down the full page height on phone and tablet, taking a fifth of a 360 px screen.
- **Form controls without an accessible name**: login 2 of 2, register 5 of 5, planner text 1, guided form 22. Confirms P1-11.
- **Keyboard**: on the login screen Tab reaches email, password, "Hyr", then leaves the page. "Regjistrohu" is never reached (`registerLinkReachable: false`): **a keyboard user cannot create an account.** Inputs show focus through border colour and shadow with `outline: none`; the button shows the browser default outline.
- **Touch targets under 44 px**: "Dil nga llogaria" 54×26 on phone and tablet; status buttons 67–106×31 on tablet and desktop; mode toggle 39 px high; form inputs 42 px.
- **Corrupted storage** (`studyflow_current_user` set to `{not json`): uncaught `SyntaxError` at `script.js:34` from `script.js:1178`. In this case the login card still shows because the throw happens after the listeners are attached; if `studyflow_users` is the corrupted key, login and register throw inside their handlers instead. Refines P1-10: not a blank page, but a login that silently does nothing. The second case is INFERRED from the code, not run.
- No failed network requests; no other console errors.
- NOT TESTED: screen reader, real touch device, Firefox/Safari, slow network, contrast measurement, any AI-backed flow.

**Dependency change proposed, not made**: `npm audit fix`.

**Deviation**: none from the instruction. One judgment call: the browser script lives under `docs/agent-handoff/evidence/batch-0/` rather than in a test folder, because no tooling was approved yet.

## 12. Differences between the two audits, for your comparison

- You found no P0. I rate five. The two I ask you to look at hardest: P0-1 (re-plan deletes today's completed sessions and duplicates ids; `script.js:1065-1068`, `server.js:306`), which neither of us can dismiss as untested since it follows from the code, and P0-2 (plaintext passwords), which you rate P1.
- Not in your register: P0-1, P1-1 (request can run about 400 s), P1-2 (long plans likely fail), P1-4 (dropped sessions reported as adjusted; empty plan saved as success), P1-5 (overnight commitments on the wrong day), P1-6 (form/server time format mismatch, now reproduced), P1-7 (AI-read availability not editable), P1-9 (no plan management, no backup), P1-13 (client and server disagree on "today"), P1-15 (phone overflow), P2-1 (profile claim), P2-4 (no one-off dates).
- Agreed by both: plaintext credentials, impossible dates, clarifying questions bypassed, no overlap check, no rate limiting, duplicated material/goal field, no tests, accessibility, storage fragility, provider reliability unknown.

## 13. Current gate

Batch 0 delivered; waiting for Codex's verdict and Batch 1. No application code has been changed.

Exact next action for Codex: read this report and the evidence, verify what you doubt in the source, give a verdict on Batch 0, rule on D4–D7 and the P0 disputes, recommend on D1, rule on the owner's flashcard request (section 8), and issue Batch 1 in the format of section 14 of the operating system.
