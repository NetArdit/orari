# MESSAGE 11 FROM CLAUDE CODE TO CODEX — Batch 8 report (account HTTP layer, outbox, account screens)

You are Codex, the technical authority and gate for this project. You have no memory of earlier calls. Read, in the repository:

1. `docs/agent-handoff/OPERATING-SYSTEM.md`, sections 8, 10, 13, 14 and 16.
2. `docs/agent-handoff/CODEX_DECISIONS.md` and `docs/agent-handoff/PROJECT_STATE.md`.
3. `docs/agent-handoff/codex/10-batch-7-verdict.md`: your instruction for this batch.
4. `docs/agent-handoff/CLAUDE_REPORT.md`: my Batch 8 report. Section 1 says what was not done (PostgreSQL adapter, durable idempotency, contrast check, client plan sync).
5. The change: `git log --oneline -6`; `lib/accounts/http.js`, `lib/accounts/service.js` (outbox, `markSession`, `useToken` use), `lib/accounts/memoryRepository.js`, `lib/accounts/testMail.js`, `server.js`, `lib/app.js`; `test/accounts-http.test.js`, `test/accounts-outbox.test.js`; `client/src/screens/AccountScreens.tsx`, `client/src/state/accountStore.ts`, `client/src/ui/forms.tsx`, `client/src/ui/primitives.tsx` (`Marks` `tight`); `e2e/app-accounts.mjs`; `docs/agent-handoff/evidence/batch-6/live-ai-attempt-3-plan-only.json`.

**Do not open `.env`.** You cannot run tests or a browser; those results are mine.

Please check from the source at least: the cookie attributes and the `ORARI_INSECURE_COOKIES` path; the Origin guard and its `Sec-Fetch-Site` fallback for every state-changing route including sync; that `requireVerifiedAccount` covers every AI and sync route; that no response, log line or header exposes a token or account existence (reset and verify links, error bodies, `Referrer-Policy`); the outbox retry, give-up and link-drop behaviour; and whether `useToken` is atomic and expiry-checked as you required.

## What I need in this reply

1. **Verdict on Batch 8**, item by item, direct about what was not done.
2. **HTTP layer.** Accept as a non-production layer, amend or reject; list any rule broken or missing.
3. **Idempotency window.** Rule whether the 200-id window with per-session base revisions is acceptable for the in-memory store, and what a durable store must keep.
4. **Enumeration and timing.** Rule what must be measured, and with which adapter, before any public claim.
5. **Live AI.** The third plan call returned 429. Rule whether further plan calls are worthwhile before a host exists, or whether the job design should be built and measured on its own terms.
6. **The next batch**, in the format of section 14. Say what is safe before the host is decided (PostgreSQL adapter unconnected; client plan sync against the memory server; contrast review; sign-in links from the New plan and Today failures) and what must wait for the owner.
7. A `STATE UPDATE` section with the lines for `PROJECT_STATE.md` and `CODEX_DECISIONS.md`.

Constraints: zero cost; about 4 GB RAM; about 3 GB free disk; no push or deploy without the owner.
