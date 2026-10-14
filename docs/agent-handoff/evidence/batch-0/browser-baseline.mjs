/**
 * Batch 0 browser baseline: screenshots and measurements of the untouched frontend in headless Edge.
 * No dependencies: Chrome DevTools Protocol over Node's built-in WebSocket (Node 22+).
 *
 *   node docs/agent-handoff/evidence/batch-0/browser-baseline.mjs [baseUrl]
 *
 * The app keeps its data in the browser, so the run seeds one synthetic user and plan into the
 * localStorage of a throwaway browser profile. It calls no AI endpoint and writes nothing to the project
 * except its own screenshots and report.json next to this file.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? "http://127.0.0.1:3987").replace(/\/$/, "");
const DEBUG_PORT = 9351;
const VIEWPORTS = {
    phone: { width: 360, height: 800, mobile: true },
    tablet: { width: 768, height: 1024, mobile: true },
    desktop: { width: 1280, height: 800, mobile: false },
};
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
    const profile = mkdtempSync(path.join(tmpdir(), "orari-baseline-"));
    const proc = spawn(exe, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
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

/* ---------- synthetic data, in the exact shape public/script.js stores ---------- */

function isoDay(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seedUser() {
    const session = (id, dayOffset, start, end, type, title, status) => ({
        id, status, date: isoDay(dayOffset), startTime: start, endTime: end, type, title,
        goal: "Kuptimi i koncepteve bazë para ushtrimeve.",
        tasks: ["Lexo kapitullin", "Zgjidh 5 ushtrime", "Shëno çka s'u kuptua"],
        material: "Kapitulli 3", difficulty: "medium",
    });
    const plan = {
        id: "plan-baseline-1",
        createdAt: new Date().toISOString(),
        structured: {
            startDate: isoDay(-3), endDate: isoDay(10), subject: "Matematikë", materialAmount: "Kapitujt 3-5",
            goal: "Provimi i semestrit", planMode: "exam", weeklyAvailability: [], commitments: [],
            unavailableDates: [], sessionPreferenceMinutes: 60, energy: null, difficulty: "medium",
        },
        profile: { name: "Testues Baseline" },
        subject: "Matematikë",
        startDate: isoDay(-3), endDate: isoDay(10), planMode: "exam",
        strategy: "Fillojmë me konceptet, pastaj ushtrime, dhe në fund përsëritje para provimit.",
        explanations: ["Mëngjeset i lamë për material të ri.", "Çdo të tretën ditë ka përsëritje."],
        warnings: ["Koha është e ngushtë për tre kapituj."],
        stats: { totalSessions: 6, totalMinutes: 360, totalHours: 6 },
        sessions: [
            session("s1", -3, "08:00", "09:00", "learning", "Funksionet: hyrje", "completed"),
            session("s2", -2, "08:00", "09:00", "practice", "Funksionet: ushtrime", "pending"),
            session("s3", -1, "20:00", "21:00", "recall", "Rikujtim i formulave", "skipped"),
            session("s4", 0, "08:00", "09:00", "learning", "Derivatet: koncepti", "pending"),
            session("s5", 0, "23:00", "23:30", "revision", "Përsëritje e shkurtër", "pending"),
            session("s6", 2, "08:00", "09:30", "assessment", "Test provues me emër shumë të gjatë për të parë si thyhet rreshti në ekran të ngushtë", "pending"),
        ],
    };
    return {
        id: "user-baseline-1", name: "Testues Baseline", email: "baseline@example.test", password: "synthetic",
        educationLevel: "university", school: "Fakulteti i Shkencave Matematike-Natyrore, Viti II",
        plans: [plan], createdAt: new Date().toISOString(),
    };
}

/* ---------- page helpers ---------- */

const { cdp, proc, profile } = await launch();
const report = { base: BASE, startedAt: new Date().toISOString(), browser: "", screens: [], keyboard: {}, consoleErrors: [], failedRequests: [] };

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
cdp.on("Runtime.exceptionThrown", (p) => report.consoleErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") report.consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(" "));
});
cdp.on("Network.loadingFailed", (p) => report.failedRequests.push(p.errorText));
report.browser = (await cdp.send("Browser.getVersion")).product;

async function evaluate(expression) {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
}

async function goto(url) {
    const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(700); // entry animation and web font
}

const MEASURE = `(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
    const controls = [...document.querySelectorAll("button, a[href], input, select, textarea")].filter(visible);
    const small = controls.filter((el) => { const r = el.getBoundingClientRect(); return el.type !== "checkbox" && (r.width < 44 || r.height < 44); });
    const clickableNotFocusable = [...document.querySelectorAll("#showRegister, #showLogin, .plan-card")].filter(visible).filter((el) => el.tabIndex < 0).length;
    const unlabeled = controls.filter((el) => ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)).filter((el) => !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length;
    const wide = [...document.querySelectorAll("body *")].filter(visible).filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""));
    return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        elementsPastRightEdge: wide,
        pageHeight: document.documentElement.scrollHeight,
        visibleControls: controls.length,
        controlsUnder44px: small.length,
        smallestControl: small.map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height) + " " + (el.textContent.trim().slice(0, 18) || el.tagName.toLowerCase()); }).slice(0, 4),
        formControlsWithoutAccessibleLabel: unlabeled,
        clickableButNotFocusable: clickableNotFocusable,
        sidebarDisplay: (() => { const s = document.querySelector(".sidebar"); return s && visible(s) ? getComputedStyle(s).position + " " + Math.round(s.getBoundingClientRect().width) + "x" + Math.round(s.getBoundingClientRect().height) : "not visible"; })(),
    };
})()`;

async function capture(viewport, name) {
    const data = await evaluate(MEASURE);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = `${viewport}-${name}.png`;
    writeFileSync(path.join(HERE, file), Buffer.from(shot.data, "base64"));
    report.screens.push({ viewport, screen: name, file, ...data });
    console.log(`${viewport.padEnd(8)} ${name.padEnd(22)} overflow=${data.horizontalOverflow} under44=${data.controlsUnder44px}/${data.visibleControls} unlabeled=${data.formControlsWithoutAccessibleLabel}`);
}

const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

try {
    for (const [viewport, v] of Object.entries(VIEWPORTS)) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: v.mobile });

        // Signed out.
        await goto(BASE + "/");
        await evaluate("localStorage.clear()");
        await goto(BASE + "/");
        await capture(viewport, "01-login");
        await click("#showRegister");
        await sleep(200);
        await capture(viewport, "02-register");

        // Signed in with the synthetic user.
        const user = JSON.stringify(seedUser());
        await evaluate(`localStorage.setItem("studyflow_users", ${JSON.stringify("[" + user + "]")}); localStorage.setItem("studyflow_current_user", ${JSON.stringify(user)});`);
        await goto(BASE + "/");
        await capture(viewport, "03-dashboard");

        await click('.nav-item[data-page="planner"]');
        await sleep(400);
        await capture(viewport, "04-planner-text");
        await click("#modeToggleForm");
        await sleep(300);
        await capture(viewport, "05-planner-form");

        await click('.nav-item[data-page="plans"]');
        await sleep(300);
        await click("#allPlans .plan-card");
        await sleep(300);
        await capture(viewport, "06-plans-open");

        await click('.nav-item[data-page="profile"]');
        await sleep(300);
        await capture(viewport, "07-profile");
    }

    // Keyboard: what Tab reaches on the login screen, and whether the focused control shows it.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await goto(BASE + "/");
    await evaluate("localStorage.clear()");
    await goto(BASE + "/");
    const stops = [];
    for (let i = 0; i < 6; i++) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await sleep(250); // let the focus transition finish before reading styles
        stops.push(await evaluate(`(() => { const el = document.activeElement; const s = getComputedStyle(el); return { element: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : ""), text: el.textContent.trim().slice(0, 20), outline: s.outlineStyle + " " + s.outlineWidth, boxShadow: s.boxShadow === "none" ? "none" : "present", borderColor: s.borderColor }; })()`));
    }
    report.keyboard.loginTabStops = stops;
    report.keyboard.registerLinkReachable = stops.some((s) => s.element.includes("showRegister"));

    // Corrupted storage: does the page still open?
    await evaluate(`localStorage.setItem("studyflow_current_user", "{not json")`);
    await goto(BASE + "/");
    report.corruptedStorage = await evaluate(`({ authVisible: !document.getElementById("authScreen").classList.contains("hidden"), appVisible: !document.getElementById("app").classList.contains("hidden") })`);
    report.corruptedStorage.errorsAfter = report.consoleErrors.slice(-2);
} finally {
    writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 2));
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
console.log("browser:", report.browser);
console.log("console errors:", report.consoleErrors.length, "| failed requests:", report.failedRequests.length);
console.log("keyboard:", JSON.stringify(report.keyboard));
console.log("corrupted storage:", JSON.stringify(report.corruptedStorage));
