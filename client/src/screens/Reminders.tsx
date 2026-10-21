import { useCallback, useEffect, useState } from "react";
import { useServices, useStoreState } from "../app/services.tsx";
import { DEFAULT_PREFS, inAppItems, LEAD_CUSTOM, LEAD_PRESETS, MAX_SNOOZES, SNOOZE_CHOICES, snoozeIn, validLead, type PushSupport, type ReminderPrefs } from "../domain/reminders.ts";
import { disablePush, detect, enablePush, loadPrefs, loadSnoozed, mayOfferPush, rememberNotNow, savePrefs, saveSnoozed, syncReminders } from "../state/reminderStore.ts";
import { navigate } from "../router/useRoute.ts";
import { Button, Notice } from "../ui/primitives.tsx";
import { shortDate } from "../ui/text.ts";
import { useAccountState } from "./AccountScreens.tsx";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
};
const leadLabel = (m: number) => (m === 0 ? "At the start" : m === 1440 ? "1 day before" : `${m} min before`);

/** Keeps the server's list of reminders equal to the published plans whenever they or the choices change. Renders nothing. */
export function ReminderSync() {
    const { api } = useServices();
    const state = useStoreState();
    const account = useAccountState();
    const verified = account.status === "signedIn" && account.user.emailVerified;
    const plans = state.status === "ready" ? state.plans : null;
    useEffect(() => {
        if (!verified || !plans) return;
        const timer = window.setTimeout(() => void syncReminders(api, plans, loadPrefs(), new Date()).catch(() => undefined), 1500);
        return () => window.clearTimeout(timer);
    }, [api, plans, verified]);
    return null;
}

/** Settings: the reminder choices, and honest push controls for every state the device can be in. */
export function RemindersPanel() {
    const { api } = useServices();
    const state = useStoreState();
    const account = useAccountState();
    const [prefs, setPrefs] = useState<ReminderPrefs>(loadPrefs);
    const [custom, setCustom] = useState("");
    const [support, setSupport] = useState<PushSupport | "loading">("loading");
    const [failed, setFailed] = useState<Array<{ sessionId: string; fireAt: string }>>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const verified = account.status === "signedIn" && account.user.emailVerified;

    const refresh = useCallback(async () => {
        if (!verified) return setSupport("loading");
        const d = await detect(api);
        setSupport(d.state);
        setFailed(d.failed);
    }, [api, verified]);
    useEffect(() => void refresh(), [refresh]);

    const change = (next: ReminderPrefs) => {
        setPrefs(next);
        savePrefs(next);
        if (state.status === "ready" && verified) void syncReminders(api, state.plans, next, new Date()).catch(() => undefined);
    };

    const enable = async () => {
        setBusy(true);
        setMessage(null);
        const r = await enablePush(api, prefs);
        setBusy(false);
        if (!r.ok) setMessage(r.message);
        else if (state.status === "ready") void syncReminders(api, state.plans, prefs, new Date()).catch(() => undefined);
        await refresh();
    };
    const disable = async () => {
        setBusy(true);
        await disablePush(api);
        setBusy(false);
        await refresh();
    };

    const customValid = custom !== "" && validLead(Number(custom));
    return (
        <section aria-label="Reminders" className="flex flex-col gap-3" data-testid="reminders">
            <h2 className="text-lg font-semibold">Reminders</h2>
            <p className="text-[13px] text-muted">Orari reminders are notifications from Orari itself. They are separate from the alarm you can put into a calendar file (set on the plan page), which belongs to your calendar app.</p>

            <label className="flex items-center gap-2 text-sm">
                <span className="font-semibold">Remind me</span>
                <select
                    value={prefs.leadMinutes === null ? "" : String(prefs.leadMinutes)}
                    onChange={(e) => change({ ...prefs, leadMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                    className="min-h-11 rounded-m border border-control bg-raised px-2"
                >
                    <option value="">No reminder</option>
                    {LEAD_PRESETS.map((m) => (
                        <option key={m} value={m}>
                            {leadLabel(m)}
                        </option>
                    ))}
                    {prefs.leadMinutes !== null && !(LEAD_PRESETS as readonly number[]).includes(prefs.leadMinutes) && <option value={prefs.leadMinutes}>{prefs.leadMinutes} min before</option>}
                </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                    Custom, minutes ({LEAD_CUSTOM.min} to {LEAD_CUSTOM.max})
                    <input type="number" min={LEAD_CUSTOM.min} max={LEAD_CUSTOM.max} value={custom} onChange={(e) => setCustom(e.target.value)} className="min-h-11 w-28 rounded-m border border-control bg-raised px-2" />
                </label>
                <Button disabled={!customValid} onClick={() => { change({ ...prefs, leadMinutes: Number(custom) }); setCustom(""); }}>
                    Use it
                </Button>
            </div>

            <fieldset className="flex flex-wrap items-center gap-3 text-sm">
                <legend className="mb-1 font-semibold">Quiet hours and limit (suggested defaults: 22:00 to 08:00, 5 a day)</legend>
                <label className="flex items-center gap-2">
                    From
                    <input type="time" value={hhmm(prefs.quietStart)} onChange={(e) => e.target.value && change({ ...prefs, quietStart: toMinutes(e.target.value) })} className="min-h-11 rounded-m border border-control bg-raised px-2" />
                </label>
                <label className="flex items-center gap-2">
                    To
                    <input type="time" value={hhmm(prefs.quietEnd)} onChange={(e) => e.target.value && change({ ...prefs, quietEnd: toMinutes(e.target.value) })} className="min-h-11 rounded-m border border-control bg-raised px-2" />
                </label>
                <label className="flex items-center gap-2">
                    At most a day
                    <input type="number" min={1} max={50} value={prefs.dailyCap} onChange={(e) => Number(e.target.value) >= 1 && change({ ...prefs, dailyCap: Math.min(50, Math.floor(Number(e.target.value))) })} className="min-h-11 w-20 rounded-m border border-control bg-raised px-2" />
                </label>
                <Button onClick={() => change({ ...DEFAULT_PREFS, leadMinutes: prefs.leadMinutes, showDetails: prefs.showDetails })}>Back to the defaults</Button>
            </fieldset>

            <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="checkbox" checked={prefs.showDetails} onChange={(e) => change({ ...prefs, showDetails: e.target.checked })} className="mt-1 size-5 accent-[var(--accent)]" />
                <span>Show the subject and time in the notification. Off by default: a lock screen then shows only general text, and the text is stored on the server only as you chose.</span>
            </label>

            <div className="flex flex-col gap-2 rounded-m bg-sunk p-4" data-testid="push-state" data-state={support}>
                <h3 className="text-base font-semibold">Notifications on this device</h3>
                {!verified && <p className="text-sm">Sign in with a confirmed e-mail to get notifications. Without them, the list in the app still shows what is due and what was missed.</p>}
                {verified && support === "loading" && <p className="text-sm text-muted">Checking this device…</p>}
                {support === "unsupported" && <p className="text-sm">This browser cannot show notifications in the background. The list in the app still works.</p>}
                {support === "needs-install" && <p className="text-sm">On iPhone and iPad, notifications work only after you add Orari to the Home Screen (Share, then Add to Home Screen) and open it from there, on a recent iOS version.</p>}
                {support === "not-set-up" && <p className="text-sm">Notifications are not set up on this server, so only the list in the app is available.</p>}
                {support === "denied" && <p className="text-sm">Notifications are blocked for this site. To turn them on, allow notifications for this site in your browser's or phone's settings, then come back here.</p>}
                {support === "revoked" && <p className="text-sm">Notifications were switched on here before but are off now (the permission or the subscription was removed). You can switch them on again.</p>}
                {(support === "default" || support === "revoked") && mayOfferPush(Date.now()) && (
                    <>
                        <p className="text-sm">Orari can send a reminder before a session even when the app is closed. Your browser will ask for permission when you press the button.</p>
                        <div className="flex flex-wrap gap-2">
                            <Button look="primary" disabled={busy} onClick={() => void enable()}>
                                {busy ? "Working…" : "Enable reminders"}
                            </Button>
                            <Button look="quiet" onClick={() => { rememberNotNow(Date.now()); void refresh(); }}>
                                Not now
                            </Button>
                        </div>
                    </>
                )}
                {(support === "default" || support === "revoked") && !mayOfferPush(Date.now()) && (
                    <Button className="self-start" disabled={busy} onClick={() => void enable()}>
                        Enable reminders
                    </Button>
                )}
                {support === "granted" && (
                    <>
                        <p className="text-sm font-semibold">Notifications are on for this device.</p>
                        <Button className="self-start" disabled={busy} onClick={() => void disable()}>
                            Turn off on this device
                        </Button>
                    </>
                )}
                {message && <p role="alert" className="text-sm font-semibold text-bad">{message}</p>}
                <p className="text-[13px] text-muted">
                    Notifications are usually delivered within about half an hour of the time, but never guaranteed: they can be late or missing when the device is off, offline, asleep, in battery saver or restricted by the system. The list in the app is the reliable one.
                </p>
                {failed.length > 0 && <p role="status" className="text-sm font-semibold">{failed.length} reminder{failed.length === 1 ? "" : "s"} could not be delivered. They are listed on the Today screen when they are due.</p>}
            </div>
        </section>
    );
}

/** On Today: what is due and what was missed, with push on or off, with Open and Snooze. */
export function InAppReminders() {
    const state = useStoreState();
    const [snoozed, setSnoozed] = useState(loadSnoozed);
    const [now, setNow] = useState(() => new Date());
    const [note, setNote] = useState<string | null>(null);
    useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(t);
    }, []);
    if (state.status !== "ready") return null;
    const items = inAppItems(state.plans, loadPrefs(), now, snoozed);
    if (items.length === 0) return null;
    const snooze = (id: string, minutes: number) => {
        const r = snoozeIn(snoozed, id, minutes, new Date());
        if (!r.ok) return setNote(r.reason === "LIMIT" ? `A reminder can be snoozed ${MAX_SNOOZES} times at most.` : "Choose 5, 10 or 15 minutes.");
        setNote(null);
        setSnoozed(r.state);
        saveSnoozed(r.state);
    };
    return (
        <section aria-label="Reminders" className="flex flex-col gap-2 rounded-m bg-warn-wash p-4" data-testid="in-app-reminders">
            <h2 className="text-base font-semibold">Reminders</h2>
            <ul className="flex flex-col gap-2">
                {items.slice(0, 6).map((i) => (
                    <li key={i.sessionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                            <span className="font-semibold">{i.kind === "due" ? "Coming up" : "Not marked"}</span> · {i.subject}: {i.session.title}
                            <span className="block text-[13px] text-muted">
                                {shortDate(i.session.date)} {i.session.startTime}–{i.session.endTime}
                                {i.kind === "missed" ? ". It is not marked as done or skipped." : ""}
                            </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                            <Button onClick={() => navigate({ name: "session", planId: i.planId, sessionId: i.sessionId })}>Open</Button>
                            {i.snoozes < MAX_SNOOZES && (
                                <label className="flex items-center gap-1">
                                    <span className="sr-only">Snooze</span>
                                    <select defaultValue="" onChange={(e) => e.target.value && snooze(i.sessionId, Number(e.target.value))} className="min-h-11 rounded-m border border-control bg-raised px-2" aria-label={`Snooze ${i.session.title}`}>
                                        <option value="">Snooze…</option>
                                        {SNOOZE_CHOICES.map((m) => (
                                            <option key={m} value={m}>
                                                {m} min
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
            {note && <Notice look="warn" title={note} />}
        </section>
    );
}
