## Defects, most severe first

1. **Raw verification and reset links are stored in PostgreSQL.** [`service.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/accounts/service.js) puts the token-bearing link in each outbox message; [`repository.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/accounts/postgres/repository.js) stores that message as JSONB. A database reader could use a still-valid link while it is queued for delivery. Encrypt the link in the outbox with an application secret, or change the design so the database never stores a usable token. Keep the database, backups, and logs access restricted meanwhile.

2. **SMTP encryption is not enforced.** [`smtpMail.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/accounts/smtpMail.js) accepts `smtp://` and creates a transport without requiring TLS; SMTP may continue without encryption if STARTTLS is unavailable. Require TLS in production or reject non-TLS SMTP configuration. For tomorrow, use an `smtps://` provider URL and verify the provider requires TLS.

3. **The configured Render service sleeps.** [`render.yaml`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/render.yaml) selects the free plan, which the file says sleeps after 15 minutes and can take about 50 seconds to wake. That makes a live company demo unreliable. Use a non-sleeping plan before the presentation.

4. **Database TLS is inferred from the URL host.** [`connect.js`](C:/Users/Promotech/OneDrive/Desktop/claude%20projects/orari-main/lib/accounts/postgres/connect.js) enables TLS for non-local URLs, but connection-string SSL parameters may override the supplied SSL configuration. Use the provider’s TLS connection string and reject settings that disable or weaken certificate verification; verify the actual Neon or Supabase endpoint. Pool size is fixed at five per process, so account for every running instance when checking the provider’s connection limit.

5. **The requested real-host checks remain untested.** Report 14 says the embedded PostgreSQL tests and local SMTP smoke test passed, but Neon/Supabase pool behavior, provider SMTP delivery, the reverse proxy, and browser UI in PostgreSQL mode were not tested. Treat local test results as evidence for the code paths, not proof of host configuration.

## Verdict

**Go with conditions for a supervised demo** after securing SMTP, choosing a non-sleeping host plan, and restricting database access. The stored-link issue should be fixed before inviting the public or treating this as a production launch.

## Host and owner checklist

- Create the PostgreSQL database; configure its TLS connection string as `DATABASE_URL`.
- Set `ORARI_BASE_URL` to the exact public HTTPS origin, `TRUST_PROXY=1` for Render, and configure SMTP credentials and sender in the host dashboard. Set Groq’s API key and confirm the configured model.
- Deploy, then verify health and account status. In a real browser, sign up and receive the verification email; verify the account, sign in, save and reload a plan, request a password reset, and set the new password.
- Confirm session cookies are `Secure` and `HttpOnly` on the public HTTPS site, emails arrive with working links, and the app behaves correctly after a host restart.
- Check provider logs and database connection usage during that flow. Do not use real customer accounts until the queued-link exposure is addressed.