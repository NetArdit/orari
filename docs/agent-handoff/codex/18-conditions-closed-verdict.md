1. **Queued links — CLOSED:** AES-256-GCM uses an HKDF-derived key, a fresh 12-byte nonce, and the message ID as AAD; unreadable links are marked failed and removed from the row.
2. **SMTP TLS — CLOSED IN SOURCE:** Remote SMTP requires TLS and certificate verification; the options are passed in Nodemailer’s transport config.
3. **Render plan and secret — CLOSED IN SOURCE:** Render uses the `starter` plan and generates `OUTBOX_SECRET`.
4. **Database TLS — CLOSED IN SOURCE:** Weakening `sslmode` values are rejected off loopback; SSL-related URL parameters are stripped and verification is configured explicitly.

**New defects:** None found in the requested areas. Tests don’t directly assert the database URL parameters were stripped from the pool config.

**Owner checks remaining:** Verify against real Neon/Supabase and the chosen SMTP provider; confirm deployed proxy TLS behavior and that `OUTBOX_SECRET` is stored safely and retained across restarts.