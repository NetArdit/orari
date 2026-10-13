/**
 * Shared helper for the browser journeys: drives headless Edge (or Chrome) over the DevTools protocol
 * with nothing but Node 22+. Each journey gets a throwaway browser profile that is removed afterwards.
 *
 *   const session = await openBrowser({ debugPort: 9353 });
 *   await session.goto("http://127.0.0.1:3987/");
 *   const title = await session.evaluate("document.title");
 *   session.check("the page has a title", title.length > 0, title);
 *   await session.finish("result.json");   // writes the result, closes the browser, sets the exit code
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BROWSERS = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Today plus `offset` days as YYYY-MM-DD in the machine's own time zone, the way the pages compute it. */
export function isoDay(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

export async function openBrowser({ debugPort, width = 1280, height = 900, mobile = false, initScript } = {}) {
    const exe = BROWSERS.find((p) => existsSync(p));
    if (!exe) throw new Error("No Edge or Chrome found; add its path to BROWSERS in e2e/browser.mjs.");
    const profile = mkdtempSync(path.join(tmpdir(), "orari-e2e-"));
    const proc = spawn(exe, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });

    let cdp;
    for (let i = 0; i < 240 && !cdp; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
            if (res.ok) {
                const target = await res.json();
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                await new Promise((resolve, reject) => {
                    ws.addEventListener("open", resolve);
                    ws.addEventListener("error", reject);
                });
                cdp = new Cdp(ws);
            }
        } catch {
            /* not up yet */
        }
        if (!cdp) await sleep(250);
    }
    if (!cdp) {
        proc.kill();
        throw new Error("The browser did not open its debugging port.");
    }

    const result = { startedAt: new Date().toISOString(), browser: "", checks: [], consoleErrors: [] };

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    cdp.on("Runtime.exceptionThrown", (p) => result.consoleErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text));
    cdp.on("Runtime.consoleAPICalled", (p) => {
        if (p.type === "error") result.consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(" "));
    });
    result.browser = (await cdp.send("Browser.getVersion")).product;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    if (initScript) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: initScript });

    async function evaluate(expression) {
        const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
    }

    async function goto(url) {
        const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
        await cdp.send("Page.navigate", { url });
        await loaded;
        await sleep(400);
    }

    async function waitFor(expression, what, timeoutMs = 10_000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (await evaluate(expression)) return;
            await sleep(100);
        }
        throw new Error("Timed out waiting for: " + what);
    }

    function check(name, pass, detail) {
        result.checks.push({ name, pass: Boolean(pass), detail });
        console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : "\n      " + JSON.stringify(detail)}`);
    }

    async function screenshot(file) {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        writeFileSync(file, Buffer.from(shot.data, "base64"));
    }

    /** Writes the result file, closes the browser, removes the profile and exits: 0 if every check passed. */
    async function finish(resultFile) {
        if (resultFile) writeFileSync(resultFile, JSON.stringify(result, null, 2));
        await cdp.send("Browser.close").catch(() => {});
        proc.kill();
        // The browser lets go of its profile folder a moment after it exits.
        for (let i = 0; i < 10; i++) {
            await sleep(1000);
            try {
                rmSync(profile, { recursive: true, force: true });
                break;
            } catch {
                if (i === 9) console.log("Could not remove the temporary browser profile:", profile);
            }
        }
        const failed = result.checks.filter((c) => !c.pass).length;
        console.log(`\n${result.browser} — ${result.checks.length - failed} of ${result.checks.length} checks passed`);
        process.exit(failed ? 1 : 0);
    }

    /** Runs the journey body; a thrown error becomes a failed check instead of a hung browser. */
    async function run(body, resultFile) {
        try {
            await body();
        } catch (error) {
            check("the journey ran to the end", false, String(error?.message ?? error));
        }
        await finish(resultFile);
    }

    return { cdp, result, evaluate, goto, waitFor, check, screenshot, finish, run };
}
