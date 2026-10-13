/**
 * Batch 2 browser journey for the page in public/: "Rregullo planin" (re-plan) and the parse request.
 * Headless Edge over the DevTools protocol, no dependencies (Node 22+).
 *
 *   node docs/agent-handoff/evidence/batch-2/replan-journey.mjs [baseUrl]
 *
 * public/script.js has no test harness, so this is its evidence. The run seeds a synthetic user and plan
 * into a throwaway browser profile, replaces fetch for the two AI routes with canned answers (no AI and
 * no server AI route is called), presses the real buttons and reads back what the page stored.
 * Exit code 0 when every check passes, 1 otherwise. Writes replan-journey.json next to this file.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");
const DEBUG_PORT = 9352;
const BROWSERS = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.listeners = new Map();
        ws.addEventListener("message", (m) => {
            const msg = JSON.parse(m.data);
            if (msg.id) {
                const p = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) p?.reject(new Error(msg.error.message));
                else p?.resolve(msg.result);
            } else for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
        });
    }
    send(method, params = {}) {
        const id = ++this.nextId;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }
    on(event, fn) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    }
}

async function launch() {
    const exe = BROWSERS.find((p) => existsSync(p));
    if (!exe) throw new Error("No Edge or Chrome found.");
    const profile = mkdtempSync(path.join(tmpdir(), "orari-journey-"));
    const proc = spawn(exe, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
    for (let i = 0; i < 240; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
            if (res.ok) {
                const target = await res.json();
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                await new Promise((resolve, reject) => {
                    ws.addEventListener("open", resolve);
                    ws.addEventListener("error", reject);
                });
                return { cdp: new Cdp(ws), proc, profile };
            }
        } catch {
            /* not up yet */
        }
        await sleep(250);
    }
    proc.kill();
    throw new Error("The browser did not open its debugging port.");
}

/* ---------- synthetic data ---------- */

function isoDay(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY = isoDay(0);

const session = (id, dayOffset, startTime, endTime, status, title) => ({
    id, status, date: isoDay(dayOffset), startTime, endTime, type: "learning", title, goal: "", tasks: [], material: null, difficulty: "medium",
});

// What the plan holds before the re-plan. The names say what must happen to each session.
const BEFORE = [
    session("old-1", -2, "08:00", "09:00", "completed", "KEEP past completed"),
    session("old-2", -1, "08:00", "09:00", "pending", "KEEP past missed"),
    session("old-3", 0, "00:05", "00:35", "completed", "KEEP today completed"),
    session("old-4", 0, "00:40", "01:10", "partial", "KEEP today partial"),
    session("old-5", 0, "01:15", "01:45", "skipped", "KEEP today skipped"),
    session("old-6", 0, "23:00", "23:30", "pending", "REPLACE today pending"),
    session("old-7", 2, "08:00", "09:00", "pending", "REPLACE future pending"),
    session("old-8", 3, "08:00", "09:00", "completed", "KEEP future completed"),
];

// What the stubbed /api/adjust-plan answers, in the shape the server returns since Batch 2.
const NEW_SESSIONS = [
    session("11111111-1111-4111-8111-111111111111", 0, "22:00", "22:30", "pending", "NEW today"),
    session("22222222-2222-4222-8222-222222222222", 1, "08:00", "09:00", "pending", "NEW tomorrow"),
];

function seedUser() {
    const structured = {
        startDate: isoDay(-2), endDate: isoDay(5), subject: "Matematikë", materialAmount: null, goal: null, planMode: "exam",
        weeklyAvailability: [], commitments: [], unavailableDates: [], sessionPreferenceMinutes: 60, energy: null, difficulty: "medium",
    };
    return {
        id: "user-journey-1", name: "Testues", email: "journey@example.test", password: "synthetic",
        educationLevel: "university", school: "", createdAt: new Date().toISOString(),
        plans: [{
            id: "plan-journey-1", createdAt: new Date().toISOString(), structured, profile: { name: "Testues" },
            subject: "Matematikë", startDate: structured.startDate, endDate: structured.endDate, planMode: "exam",
            strategy: "E vjetra", explanations: [], warnings: [], stats: { totalSessions: 8, totalMinutes: 300, totalHours: 5 },
            sessions: BEFORE,
        }],
    };
}

// Runs in the page before its own script: canned answers for the two AI routes, and a record of what was sent.
const PAGE_STUBS = `
    window.__sent = {};
    window.__alerts = [];
    window.alert = (message) => { window.__alerts.push(String(message)); };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
        const path = String(url);
        if (path.endsWith("/api/adjust-plan")) {
            window.__sent.adjust = JSON.parse(options.body);
            const body = { profile: { name: "Testues" }, subject: "Matematikë", startDate: ${JSON.stringify(TODAY)}, endDate: ${JSON.stringify(isoDay(5))}, planMode: "exam",
                strategy: "E reja", explanations: ["Sepse"], warnings: [], stats: { totalSessions: 2, totalMinutes: 90, totalHours: 1.5 },
                sessions: ${JSON.stringify(NEW_SESSIONS)} };
            return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (path.endsWith("/api/parse")) {
            window.__sent.parse = JSON.parse(options.body);
            const parsed = { startDate: null, endDate: null, subject: null, materialAmount: null, goal: null, planMode: null, weeklyAvailability: [], commitments: [], sessionPreferenceMinutes: null, energy: null, difficulty: null, clarifyingQuestions: ["Kur fillon?"] };
            return new Response(JSON.stringify({ parsed }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return realFetch(url, options);
    };
`;

/* ---------- run ---------- */

const { cdp, proc, profile } = await launch();
const result = { base: BASE, startedAt: new Date().toISOString(), browser: "", today: TODAY, checks: [], consoleErrors: [] };
const check = (name, pass, detail) => {
    result.checks.push({ name, pass: Boolean(pass), detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "\n      " + JSON.stringify(detail)}`);
};

async function evaluate(expression) {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
}
async function goto(url) {
    const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(500);
}
async function waitFor(expression, what) {
    for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await sleep(100);
    }
    throw new Error("Timed out waiting for: " + what);
}
const storedSessions = () => evaluate(`JSON.parse(localStorage.getItem("studyflow_current_user")).plans[0].sessions.map(s => ({ id: s.id, status: s.status, title: s.title, date: s.date }))`);

try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    cdp.on("Runtime.exceptionThrown", (p) => result.consoleErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
    cdp.on("Runtime.consoleAPICalled", (p) => {
        if (p.type === "error") result.consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(" "));
    });
    result.browser = (await cdp.send("Browser.getVersion")).product;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_STUBS });

    await goto(BASE + "/");
    const user = JSON.stringify(seedUser());
    await evaluate(`localStorage.setItem("studyflow_users", ${JSON.stringify("[" + user + "]")}); localStorage.setItem("studyflow_current_user", ${JSON.stringify(user)});`);
    await goto(BASE + "/");

    /* 1. Re-plan */
    check("the plan-health panel offers the re-plan", await evaluate(`!document.getElementById("planHealthPanel").classList.contains("hidden")`));
    await evaluate(`document.getElementById("adjustPlanButton").click()`);
    await waitFor(`window.__alerts.length > 0`, "the page's confirmation after re-planning");

    const sent = await evaluate(`window.__sent.adjust`);
    check("the request tells the server today's date", sent?.progress?.today === TODAY, sent?.progress);
    check("completed and partial sessions are reported as done", sent?.progress?.completedSessionSummaries?.length === 4, sent?.progress?.completedSessionSummaries);
    check("missed and skipped sessions are reported as missed", sent?.progress?.missedSessionSummaries?.length === 2, sent?.progress?.missedSessionSummaries);

    const after = await storedSessions();
    const titles = after.map((s) => s.title).sort();
    const expectedTitles = [...BEFORE.filter((s) => s.title.startsWith("KEEP")), ...NEW_SESSIONS].map((s) => s.title).sort();
    check("P0-1: every session already acted on is kept, including today's; pending ones from today on are replaced", JSON.stringify(titles) === JSON.stringify(expectedTitles), { stored: titles, expected: expectedTitles });

    const statusOf = (title) => after.find((s) => s.title === title)?.status;
    check("P0-1: today's completed, partial and skipped sessions keep their status",
        statusOf("KEEP today completed") === "completed" && statusOf("KEEP today partial") === "partial" && statusOf("KEEP today skipped") === "skipped",
        after.filter((s) => s.date === TODAY));
    check("no session id appears twice", new Set(after.map((s) => s.id)).size === after.length, after.map((s) => s.id));
    check("the new sessions are stored as pending", NEW_SESSIONS.every((n) => after.find((s) => s.id === n.id)?.status === "pending"));
    const strategy = await evaluate(`JSON.parse(localStorage.getItem("studyflow_current_user")).plans[0].strategy`);
    check("the plan's strategy is the new one", strategy === "E reja", strategy);
    const inSync = await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem("studyflow_users"))[0].plans) === JSON.stringify(JSON.parse(localStorage.getItem("studyflow_current_user")).plans)`);
    check("both storage keys hold the same plans", inSync);

    /* 2. Ticking a new session changes that session and no other */
    await evaluate(`document.querySelector('.nav-item[data-page="plans"]').click()`);
    await sleep(300);
    await evaluate(`document.querySelector("#allPlans .plan-card").click()`);
    await sleep(300);
    const clicked = await evaluate(`(() => {
        const card = [...document.querySelectorAll("#allPlans .schedule-card")].find(c => c.querySelector(".schedule-title").textContent === "NEW tomorrow");
        if (!card) return false;
        card.querySelector('.status-btn[data-status="completed"]').click();
        return true;
    })()`);
    check("the new session is shown in the plan and can be ticked", clicked);
    const afterTick = await storedSessions();
    const changed = afterTick.filter((s, i) => s.status !== after[i].status).map((s) => s.title);
    check("ticking it changes that session only", JSON.stringify(changed) === JSON.stringify(["NEW tomorrow"]), changed);

    /* 3. Parse request carries the user's own date (P1-13) */
    await evaluate(`document.querySelector('.nav-item[data-page="planner"]').click()`);
    await sleep(200);
    await evaluate(`document.getElementById("nlInput").value = "nesër kam provim"; document.getElementById("parseButton").click()`);
    await waitFor(`Boolean(window.__sent.parse)`, "the parse request");
    const parseSent = await evaluate(`window.__sent.parse`);
    const zone = await evaluate(`Intl.DateTimeFormat().resolvedOptions().timeZone`);
    check("P1-13: the parse request carries the user's date and time zone", parseSent.text === "nesër kam provim" && parseSent.clientDate === TODAY && parseSent.timeZone === zone, parseSent);

    check("no errors in the browser console", result.consoleErrors.length === 0, result.consoleErrors);
} catch (error) {
    check("the journey ran to the end", false, String(error?.message ?? error));
} finally {
    writeFileSync(path.join(HERE, "replan-journey.json"), JSON.stringify(result, null, 2));
    await cdp.send("Browser.close").catch(() => {});
    proc.kill();
    // Edge lets go of its profile folder a moment after it exits; a leftover folder must not fail the run.
    for (let i = 0; i < 10; i++) {
        await sleep(1000);
        try {
            rmSync(profile, { recursive: true, force: true });
            break;
        } catch {
            if (i === 9) console.log("Could not remove the temporary browser profile:", profile);
        }
    }
}

const failed = result.checks.filter((c) => !c.pass).length;
console.log(`\n${result.browser} — ${result.checks.length - failed} of ${result.checks.length} checks passed`);
process.exit(failed ? 1 : 0);
