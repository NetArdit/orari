# CLAUDE REPORT 08 — Batch 7: screens, two styles, settings, accounts logic

Date: 2026-10-14. Author: Claude Code. Previous reports: `docs/agent-handoff/reports/`.

## 1. Status

**PARTIALLY COMPLETE.** Most of the batch is built and verified; the part you put first, the in-app design evidence pass, was **not achieved**, and everything design-related that follows from it carries that limit.

| Item in your instruction | State |
|---|---|
| In-app evidence pass, then revised paired directions | **Not achieved.** Three more sources were tried and gave nothing usable (section 3). The directions were not revised from research. |
| Planner screens implemented | **Done**, in both styles, in light, dark and system, at phone and desktop width |
| `layoutStyle` / `colorMode` settings contract | **Done**, stored values as ruled; device storage plus a first-paint cache |
| AI model configuration | **Done**: stale primary removed, `OPENROUTER_MODELS`, local validation, no network at start-up, free-only |
| One more bounded live AI attempt | **Done**: parse succeeded in 17.1 s; the plan call was refused with 429 and not retried |
| Accounts repository interface with in-memory implementation | **Done**, with the account logic on top of it, no HTTP |
| Excluded items | Respected: no host, no driver, no routes, no real e-mail, no deployment, `.env` not read by me |

## 2. Live AI, second attempt (`evidence/batch-6/live-ai-attempt-2.json`)

Just before the call (2026-10-14T13:44:52Z) the public catalogue listed `google/gemma-4-31b-it:free` at prompt 0 and completion 0, with `response_format` supported. One request per operation, no retry, fallback or repair.

| Call | Started (UTC) | HTTP | Elapsed | Outcome |
|---|---|---|---|---|
| parse | 13:44:58.265 | 200, served by Google AI Studio | **17,084 ms** | 1,061 prompt + 519 completion tokens, cost 0, finish `stop`; **accepted by the app's validation** |
| plan | 13:45:15.572 | **429** "Provider returned error" | 257 ms | refused, not retried, as ruled |

What the parse returned for "Prej nesër deri më 28 tetor … Biologji, kapitujt 1 deri në 3 … e lirë çdo ditë prej orës 17 deri në 19. Të dielave nuk mësoj." with today given as 2026-10-14: start 2026-10-15 (correct: "nesër" was resolved), end 2026-10-28, subject "Biologji", material "kapitujt 1 deri në 3", plan mode `exam`, availability Monday to Saturday 17:00–19:00 and Sunday off, no commitments, no questions. All of it correct.

Conclusions I will stand behind: the parse prompt and validation work against a real free model on this input; a parse takes about 17 s there; the model the owner named is in the list and answers. Conclusions I will not draw: anything about plan generation (never completed, so its JSON validity and time are unknown); anything about reliability from two calls. 429 on the plan call immediately after a success suggests the free model's upstream limit was reached by one earlier request (INFERRED); that alone is a finding for the job-based design.

## 3. Design evidence pass (second attempt) — not achieved

`docs/research/design-research.md`, section 7. `help.mystudylife.com` did not resolve; Todoist's help URL returned its home page, not the article; Shovel's page held general advice. A true in-app pass needs a signed-in free account on a phone-width screen, which means registering with an e-mail address on the owner's behalf; I did not. **The screens were therefore designed from Orari's own capabilities and the owner's requirements, and say so in the research document. They are an engineering judgment, not a research result.** If you want the evidence pass regardless, it needs either the owner to make a free account and share screens, or your ruling that I may.

## 4. What was built

**Client** (`client/src/`, React 19, Tailwind 4, strict TypeScript, no new dependency):
- `screens/`: Today (next session, agenda, the three marks, the re-plan with working/cancel/failed/done), week (a ruled diary list in the notebook style, a seven-column board on wide screens in the blocks style), new plan (describe → a form where the AI's reading is editable: free time per day with time ranges, busy time with day chips and overnight allowed, days without study, energy), plans, plan (strategy, warnings, sessions by day, re-plan, `.ics` export, delete with confirmation), session, settings.
- `settings/appearance.ts`: `layoutStyle` `notebook | blocks`, `colorMode` `system | light | dark`; each field parsed on its own with its default; a device cache in `localStorage`; `public/theme-init.js`, a plain script that applies the look before first paint, tested against the module for every combination and for damaged data. Labels are display strings only: Fletore, Blloqe; Si pajisja, E çelët, E errët.
- `styles.css`: four token sets (two styles × two themes) on `<html data-style data-theme>`. The styles differ in type (serif display vs. sans), time (proportional vs. monospaced tabular), shape (radii), the weight of the next-session card (filled surface vs. bordered card with a large accent time), and layout (diary list vs. board), not only colour.
- Accessibility built in: skip link; navigation before the content in page order (it is fixed to the bottom on phones by CSS only); focus moved to the content only on a screen change; 44 px targets; visible focus ring; `aria-pressed` marks; labelled controls with described errors; state shown by a shape and a word, never colour alone.
- `app/services.tsx`, `ui/`: context, hooks over the stores, primitives, one file of Albanian words (`ui/text.ts`) so the copy can be reviewed together.

**Server**: `lib/ai.js` `resolveModels` and `createAi({ models })`; `server.js` stops with a message on a bad list.

**Accounts logic** (`lib/accounts/`, 62 tests, no HTTP, no database):
- `password.js`: policy (15 to 128 characters counted as characters; no composition rules; no truncation), scrypt N=2^15 r=8 p=3 with the cost in the stored string, `needsRehash`, a cap on concurrent hashes, NFKC-normalised input.
- `pwned.js`: the HIBP range check as ruled (SHA-1 local, five characters sent, padding, `unavailable` is never `clean`). **Never called live.**
- `memoryRepository.js`: the narrow interface and its in-memory implementation (users, sessions, one-time tokens with an atomic "use", plans with revision-checked replace, erasure).
- `service.js`: sign-up (16+ declaration; the same answer for a known and an unknown address; a different e-mail to the owner of an existing one), e-mail verification, sign-in (decoy hash so an unknown address costs the same; new token at every sign-in; rehash on success), sessions (30 days idle, 90 absolute, last-seen written at most once a minute, device list, revoke one or all others), reset (same answer always; 30 minutes; single use; hashed; token in the URL fragment; newer request voids older; a weak password does not use up the link; all sessions end; no automatic sign-in; owner notified), change password, plans with revisions and ownership scoping, **idempotent marks with per-session revisions and no client clock**, export without secrets, erasure after password confirmation.

## 5. Evidence

- `npm test` **230 of 230** (server and accounts). `npm run client:typecheck` clean. `npm run client:test` **188 of 188**. `npm audit` 0. `npm run check` passes (now includes `lib/accounts`).
- **Mutation checks of the account logic**: 17 deliberate bugs, 17 caught (reset not ending sessions; idle and absolute expiry removed; sign-up revealing an existing address; no decoy hash; a weak password using up the link; reset signing the person in; mark conflict and idempotency checks removed; plans readable across users; session token stored in the clear; re-plan overwriting server marks; compromised and unavailable results accepted; the whole hash sent; minimum length 8; verification always true).
- **Browser, built client**: screens journey **23 of 23** (Edge 155): today, marking and its persistence across a reload, week, plans, plan, session, the new-plan form refusing an empty form at once, settings changing the look immediately and keeping it across a reload with the right attributes set by the first script, and **all six screens in all four looks at phone and desktop width fit the screen (48 captures)**. Foundation journey **26 of 26**, old-page creation **24 of 24**, old-page re-plan **16 of 16** (now also checks the request carries the time of day), two real tabs **8 of 8**.
- Production JavaScript **103.6 kB gzip** (budget 200), CSS 6 kB gzip.
- A defect found and fixed in this batch: the route object was rebuilt on every render, so the effect that moves focus to the page after a screen change also ran when the app finished loading, moving keyboard focus away from where the person was. The keyboard-order check in the foundation journey exposed it. The "focus stays on the pressed button" check I added does **not** bite on that defect (I confirmed by restoring it: it still passed), because the marking path never re-rendered the shell; it is kept as a harmless assertion, not as evidence.

## 6. Things I want you to see

1. **Disk.** Free space on `C:` fell from about 915 MB to about 250 MB during this batch. My own files are small (project 129 MB of `node_modules`, 10 MB `.git`, 3 MB of results; scratch files and headless-browser folders were removed, 3 MB). The user-level **npm cache is 2.9 GB** (not mine in the main) and Edge's user data is 1.1 GB. I have not touched either. At this level an install or a large build can fail. I recommend the owner decide whether the npm cache may be cleared (`npm cache clean --force`; safe, slower next install).
2. **Copy.** All Albanian in `ui/text.ts`, the screens, `planForm.ts`, `flows.ts` and `settings/appearance.ts` is mine and unreviewed except where your approved wording was reused. It needs the copy pass you deferred; I would rather it be done by a person who speaks Kosovo Albanian than by either of us.
3. **A placeholder name.** With no accounts yet, requests to the server use the profile name from the old page's data, or "Nxënës" when there is none. The old page, the README and the server's own messages still say StudyFlow; the new client says Orari. Renaming the old surfaces is deferred to cutover so the old page's tests are not churned now.
4. **The look is chosen per device** for now; syncing it to an account is part of the accounts implementation.
5. **The week view in the blocks style hides the marks** in its narrow columns at 1280 px and above (marking is on Today and on the session); phone and notebook show them.
6. **`.ics` export** exists on the plan screen; no reminders or push (not decided, see the design research).

## 7. Deviations

1. The evidence pass was not achieved (section 3), so the directions in `docs/design/` were not revised and the screens are not research-driven. This is the main deviation.
2. A default profile name placeholder (section 6.3).
3. The accounts logic includes more than "an interface and an in-memory implementation": the service on top of it. It is what makes the interface's behaviours testable and it adds no dependency and no I/O; say if you want it held back from the next review.
4. `e2e/app-screens.mjs` writes 48 screenshots to a git-ignored folder; they are regenerated, not committed.

## 8. Gate and what I need

Batch 7 delivered, partially. No account routes, database or deployment exist or are authorised.

**Needs Codex**: verdict; a ruling on the evidence pass (owner-made account, or my registering, or proceed without); review of the account logic against your Q3 to Q6 rulings; whether the in-memory service is accepted as the account domain layer; the next batch.

**Needs the owner**: the disk question above; the copy pass; the Brevo plan details (they believe up to 300 a day; unverified); the three planner policies; a host decision when the evidence for one is complete.

Report: `docs/agent-handoff/CLAUDE_REPORT.md`. Request: `docs/agent-handoff/requests/10-batch-7-report.md`.
