/**
 * A real PostgreSQL for tests: the `embedded-postgres` package downloads the real server binaries and runs
 * one on a free local port in a temporary directory. Nothing outside the machine is touched.
 */
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { createPool, migrate } from "../../lib/accounts/postgres/connect.js";

const freePort = () =>
    new Promise((resolve, reject) => {
        const s = createServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });

/* Test files run in parallel processes; initialising several PostgreSQL clusters at the same moment is slow and
   has stalled on Windows. A lock directory makes the start-up of the clusters take turns (a stale lock expires). */
const LOCK = path.join(tmpdir(), "orari-pg-start.lock");
async function withStartLock(fn) {
    const deadline = Date.now() + 240_000;
    for (;;) {
        try {
            mkdirSync(LOCK);
            break;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 90_000) rmSync(LOCK, { recursive: true, force: true });
            } catch { /* released meanwhile */ }
            if (Date.now() > deadline) throw new Error("timed out waiting to start PostgreSQL");
            await new Promise((r) => setTimeout(r, 300));
        }
    }
    try {
        return await fn();
    } finally {
        rmSync(LOCK, { recursive: true, force: true });
    }
}

export async function startPostgres() {
    // ORARI_TEST_DATABASE_URL runs the same suites against an existing database (a disposable Neon branch, never
    // production: the tests TRUNCATE the account tables).
    if (process.env.ORARI_TEST_DATABASE_URL) {
        const connectionString = process.env.ORARI_TEST_DATABASE_URL;
        const pool = createPool({ connectionString, max: 10 });
        await migrate(pool);
        const reset = () => pool.query("TRUNCATE users, sessions, tokens, outbox, plans, retired_plans CASCADE");
        await reset();
        return { pool, connectionString, reset, stop: () => pool.end() };
    }
    const port = await freePort();
    const dir = mkdtempSync(path.join(tmpdir(), "orari-pg-"));
    const server = new EmbeddedPostgres({ databaseDir: path.join(dir, "data"), user: "orari", password: "orari-test", port, persistent: true, onLog: () => {}, onError: () => {} });
    await withStartLock(async () => {
        await server.initialise();
        await server.start();
    });
    const connectionString = `postgres://orari:orari-test@127.0.0.1:${port}/postgres`;
    const pool = createPool({ connectionString, max: 10 });
    await migrate(pool);
    const reset = () => pool.query("TRUNCATE users, sessions, tokens, outbox, plans, retired_plans CASCADE");
    return {
        pool,
        connectionString,
        reset,
        async stop() {
            await pool.end();
            await server.stop();
            // Windows may still hold the directory for a moment; a leftover temp folder is not a test failure.
            try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left for the OS temp cleanup */ }
        },
    };
}
