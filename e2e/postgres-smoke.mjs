/**
 * server.js itself in ACCOUNTS_MODE=postgres: real PostgreSQL (embedded), a local SMTP sink, real HTTP.
 * Sign-up mail arrives over SMTP, the account is verified and used, the process is stopped with SIGTERM and
 * started again, and the account, session and plan are still there.
 *
 *   node e2e/postgres-smoke.mjs
 */
import { spawn } from "node:child_process";
import { startPostgres } from "../test/helpers/embeddedPg.js";
import { smtpSink } from "../test/helpers/smtpSink.js";

const PORT = 3977;
const BASE = `http://localhost:${PORT}`;
const GOOD = "een lange zin die niemand raadt";
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); console.log((ok ? "PASS  " : "FAIL  ") + name + (ok || !detail ? "" : "  -> " + detail)); };

const db = await startPostgres();
const sink = await smtpSink();
let child;
const env = { ...process.env, PORT: String(PORT), ACCOUNTS_MODE: "postgres", DATABASE_URL: db.connectionString, SMTP_URL: `smtp://127.0.0.1:${sink.port}`, MAIL_FROM: "Orari <no-reply@orari.example>", OUTBOX_SECRET: "smoke-secret-smoke-secret-smoke-secret-1234", ORARI_BASE_URL: BASE, ORARI_INSECURE_COOKIES: "1", ACCOUNTS_PWNED_CHECK: "off", OPENROUTER_API_KEY: "", GROQ_API_KEY: "", NODE_ENV: "development" };

async function start() {
    child = spawn(process.execPath, ["server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch(BASE + "/api/health")).ok) return log; } catch { /* not yet */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("server did not start: " + log);
}
const stop = () => new Promise((resolve) => { child.once("exit", (code) => resolve(code)); child.kill("SIGTERM"); });

let cookie = "";
async function call(method, path, body) {
    const res = await fetch(BASE + path, { method, headers: { Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const line of res.headers.getSetCookie()) { const [pair] = line.split(";"); const [n, v] = pair.split("="); cookie = v === "" ? "" : `${n}=${v}`; }
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: null }; }
}
const waitMail = async (match) => { for (let i = 0; i < 50; i++) { const m = sink.received.find((x) => match.test(x.data)); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
const linkOf = (data) => { const plain = data.replace(/=\r\n/g, "").replace(/=3D/g, "="); return plain.match(/https?:\/\/\S+#token=[A-Za-z0-9_-]+/)?.[0]; };

try {
    await start();
    check("status says postgres", (await call("GET", "/api/account/status")).json?.accounts === "postgres");
    const email = "smoke@example.test";
    check("sign-up accepted", (await call("POST", "/api/account/signup", { email, password: GOOD, name: "Arta", confirmsAge16: true })).status === 200);
    const mail = await waitMail(/token=/);
    check("verification mail arrived over SMTP", Boolean(mail));
    const token = decodeURIComponent(linkOf(mail.data).split("#token=")[1]);
    check("verify", (await call("POST", "/api/account/verify", { token })).status === 200);
    check("login", (await call("POST", "/api/account/login", { email, password: GOOD })).status === 200);
    const plan = { id: "p1", createdAt: "2026-10-01T08:00:00.000Z", subject: "Matematikë", startDate: "2026-10-14", endDate: "2026-10-30", sessions: [{ id: "s1", status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë" }] };
    check("plan saved to the account", (await call("POST", "/api/sync/plans", { plan })).status === 201);
    const saved = cookie;

    const code = await stop();
    // Windows has no signals: kill() ends the process at once, so a graceful stop can only be checked elsewhere.
    if (process.platform === "win32") console.log("SKIP  graceful SIGTERM (not testable on Windows)");
    else check("SIGTERM ends the process cleanly", code === 0, "exit " + code);
    await start();
    cookie = saved;
    check("after restart the session still works", (await call("GET", "/api/account/me")).status === 200);
    check("after restart the plan is there", (await call("GET", "/api/sync/plans")).json?.plans?.length === 1);
    check("forgot-password sends a mail", (await call("POST", "/api/account/password/forgot", { email })).status === 200 && Boolean(await waitMail(/rivendos|Rivendos/i)));
} catch (error) {
    check("run", false, String(error));
} finally {
    try { child.kill("SIGKILL"); } catch { /* gone */ }
    await sink.close();
    await db.stop();
}
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed} of ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
