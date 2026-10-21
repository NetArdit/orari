/**
 * The device side of reminders: the person's choices (kept on this device), the snoozes, whether push was ever
 * switched on, and the calls to the browser's push API. Every browser call happens only after a person's action.
 */
import type { ApiClient } from "../api/client.ts";
import { parsePrefs, pushSupport, type PushSupport, type ReminderPrefs, type SnoozeState } from "../domain/reminders.ts";
import type { StoredPlan } from "../storage/model.ts";
import { planReminders } from "../domain/reminders.ts";

const KEYS = { prefs: "orari.reminders", snoozed: "orari.snoozed", pushOn: "orari.pushEnabled", notNow: "orari.pushNotNow" } as const;
/** After "Not now" the offer comes back only from settings, or after this long. */
export const NOT_NOW_COOLDOWN_MS = 30 * 24 * 3600_000;

const read = (key: string): string | null => {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key: string, value: string | null) => {
    try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        /* blocked: the choice holds for this visit only */
    }
};
const json = (text: string | null): unknown => {
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
};

export const loadPrefs = (): ReminderPrefs => parsePrefs(json(read(KEYS.prefs)));
export const savePrefs = (p: ReminderPrefs) => write(KEYS.prefs, JSON.stringify(p));
export const loadSnoozed = (): SnoozeState => {
    const v = json(read(KEYS.snoozed));
    return v && typeof v === "object" ? (v as SnoozeState) : {};
};
export const saveSnoozed = (s: SnoozeState) => write(KEYS.snoozed, JSON.stringify(s));
export const wasPushEnabled = () => read(KEYS.pushOn) === "1";
export const notNowAt = (): number | null => {
    const n = Number(read(KEYS.notNow));
    return Number.isFinite(n) && n > 0 ? n : null;
};
export const rememberNotNow = (now: number) => write(KEYS.notNow, String(now));
/** The offer shows only when the person has not said "Not now" lately. */
export const mayOfferPush = (now: number) => {
    const at = notNowAt();
    return at === null || now - at > NOT_NOW_COOLDOWN_MS;
};

const hasApis = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function currentSubscription(): Promise<PushSubscription | null> {
    if (!hasApis()) return null;
    try {
        const reg = await navigator.serviceWorker.getRegistration("/app/");
        return (await reg?.pushManager.getSubscription()) ?? null;
    } catch {
        return null;
    }
}

export async function detect(api: ApiClient): Promise<{ state: PushSupport; failed: Array<{ sessionId: string; fireAt: string }> }> {
    const config = await api.push.config();
    const apis = hasApis();
    const subscribed = apis ? (await currentSubscription()) !== null : false;
    const status = config.ok && config.data.publicKey ? await api.push.status() : null;
    const state = pushSupport({
        hasApis: apis,
        permission: apis ? (Notification.permission as "default" | "granted" | "denied") : "default",
        subscribed,
        serverReady: config.ok && Boolean(config.data.publicKey),
        isIos: isIos(),
        standalone: standalone(),
        wasEnabled: wasPushEnabled(),
    });
    return { state, failed: status && status.ok ? status.data.failed : [] };
}

const toKey = (b64: string) => {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

/** Called from a button. Asks the browser for permission (once, here, never on load), subscribes, tells the server. */
export async function enablePush(api: ApiClient, prefs: ReminderPrefs): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!hasApis()) return { ok: false, message: "This browser cannot receive reminders in the background." };
    const config = await api.push.config();
    if (!config.ok || !config.data.publicKey) return { ok: false, message: "Reminders by notification are not set up on this server." };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, message: permission === "denied" ? "Notifications are blocked for this site. Allow them in the browser's site settings, then try again." : "No permission was given." };
    try {
        const reg = await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
        await navigator.serviceWorker.ready;
        const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(config.data.publicKey) }));
        const sent = await api.push.subscribe(subscription.toJSON());
        if (!sent.ok) return { ok: false, message: sent.message };
        write(KEYS.pushOn, "1");
        await api.push.setPrefs({ quietStart: prefs.quietStart, quietEnd: prefs.quietEnd, dailyCap: prefs.dailyCap, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
        return { ok: true };
    } catch {
        return { ok: false, message: "The device could not be set up for reminders. Try again, or use the list in the app." };
    }
}

export async function disablePush(api: ApiClient): Promise<void> {
    const sub = await currentSubscription();
    if (sub) {
        await api.push.unsubscribe(sub.endpoint);
        await sub.unsubscribe().catch(() => undefined);
    }
    write(KEYS.pushOn, null);
}

/** Tells the server what to send, from the published plans. Quiet when push is off. */
export async function syncReminders(api: ApiClient, plans: readonly StoredPlan[], prefs: ReminderPrefs, now: Date): Promise<void> {
    if (!wasPushEnabled() || !hasApis()) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await api.push.setPrefs({ quietStart: prefs.quietStart, quietEnd: prefs.quietEnd, dailyCap: prefs.dailyCap, tz });
    const reminders = planReminders(plans, prefs, now);
    const active = plans.filter((p) => p.state !== "draft").flatMap((p) => p.sessions.filter((s) => s.status === "pending").map((s) => s.id));
    await api.push.sync(reminders, active);
}
