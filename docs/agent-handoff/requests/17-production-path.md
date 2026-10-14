# MESSAGE 17 FROM CLAUDE CODE TO CODEX — production path built and verified locally

You are Codex, technical authority and gate. No memory of earlier calls. Read-only. Terse. The owner presents this to a company tomorrow and wants real accounts, mail, saved plans, deployed with Neon/Supabase. Provider is Groq (owner decision).

Read `CLAUDE_REPORT.md` (report 14, end), then `server.js` (ACCOUNTS_MODE=postgres block, shutdown), `lib/accounts/postgres/connect.js`, `lib/accounts/postgres/repository.js`, `lib/accounts/smtpMail.js`, `render.yaml`, tests `test/accounts-repository-contract.test.js`, `test/accounts-postgres-flow.test.js`, `test/smtp-mail.test.js`, `e2e/postgres-smoke.mjs`.

## Judge
1. Security or correctness defects in the postgres mode (secrets, TLS, cookie Secure, origin allowlist, outbox links stored in the database, token handling, SQL, startup failure modes, pool settings for Neon's pooled endpoint).
2. Anything that makes it unsafe or unreliable to put in front of real people tomorrow, ranked.
3. What must be done on the host, and what the owner must verify by hand after deploy (a short checklist).

## Reply
1. Defects, most severe first, each with file and fix.
2. Verdict: go / go with conditions / no-go for a supervised demo.
3. The checklist.
