import { useMemo, useState } from "react";
import { byTime } from "../domain/clock.ts";
import { icsFileName, planToIcs } from "../domain/ics.ts";
import { needsReplan, progressOf, sessionState } from "../domain/progress.ts";
import { createReplanFlow } from "../state/flows.ts";
import { navigate } from "../router/useRoute.ts";
import { useClock, useFlow, useServices, useStoreState } from "../app/services.tsx";
import { Button, buttonClass, Empty, KindLabel, Link, Marks, Notice, ScreenTitle, SessionRow, StatePill, TimeRange } from "../ui/primitives.tsx";
import { dayLabel, shortDate } from "../ui/text.ts";
import type { SessionStatus, StoredPlan } from "../storage/model.ts";
import { capacityNeeded, publish, readCapacity, validatePlan, writeCapacity } from "../domain/validate.ts";

export function PlansScreen() {
    const state = useStoreState();
    const clock = useClock();
    if (state.status !== "ready") return null;

    return (
        <>
            <ScreenTitle title="Plans" />
            {state.unreadable.length > 0 && (
                <Notice look="warn" title={state.unreadable.length === 1 ? "1 plan cannot be read" : `${state.unreadable.length} plans cannot be read`}>
                    <p className="text-sm">They are still on this device and have not been deleted.</p>
                </Notice>
            )}
            {state.plans.length === 0 ? (
                <Empty title="No plans yet">
                    <Link to={{ name: "newPlan" }} className={buttonClass("primary", "self-start")}>
                        Create your first plan
                    </Link>
                </Empty>
            ) : (
                <ul className="flex flex-col gap-3">
                    {state.plans.map((plan) => {
                        const p = progressOf(plan.sessions, clock);
                        const ended = plan.endDate < clock.today;
                        return (
                            <li key={plan.id}>
                                <Link to={{ name: "plan", planId: plan.id }} className="flex flex-col gap-1 rounded-m bg-raised p-4 shadow-raised hover:bg-sunk">
                                    <span className="text-lg font-semibold">{plan.subject}</span>
                                    <span className="text-[13px] text-muted">
                                        {shortDate(plan.startDate)} – {shortDate(plan.endDate)} · {ended ? "finished" : `${p.remaining} ahead`} · {p.done + p.partial}/{p.total} done
                                        {needsReplan(plan, clock) ? ` · ${p.missed} missed` : ""}
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}

export function PlanScreen({ planId }: { planId: string }) {
    const { api, store } = useServices();
    const state = useStoreState();
    const clock = useClock();
    const replan = useMemo(() => createReplanFlow({ api, store }), [api, store]);
    const replanState = useFlow(replan);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [reminder, setReminder] = useState<number | null>(() => {
        try {
            const v = window.localStorage.getItem("orari.icsReminder");
            return v === null || v === "" ? null : Number(v);
        } catch {
            return null;
        }
    });

    if (state.status !== "ready") return null;
    const plan = state.plans.find((p) => p.id === planId);
    if (!plan) {
        return (
            <Empty title="This plan is not on this device">
                <Link to={{ name: "plans" }} className={buttonClass("secondary", "self-start")}>
                    Back to Plans
                </Link>
            </Empty>
        );
    }

    const progress = progressOf(plan.sessions, clock);
    const profile = state.profile ?? { name: "Student", educationLevel: null };
    const byDate = new Map<string, typeof plan.sessions>();
    for (const s of [...plan.sessions].sort(byTime)) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

    const exportIcs = () => {
        const blob = new Blob([planToIcs(plan, { now: new Date(), reminderMinutes: reminder })], { type: "text/calendar;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = icsFileName(plan.subject);
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return (
        <>
            <ScreenTitle eyebrow={`${shortDate(plan.startDate)} – ${shortDate(plan.endDate)}`} title={plan.subject}>
                <p className="text-muted">
                    {progress.done + progress.partial} of {progress.total} sessions done · {Math.round(progress.completion * 100)}%
                </p>
            </ScreenTitle>

            <div className="flex flex-wrap gap-2">
                {needsReplan(plan, clock) && replanState.status === "idle" && (
                    <Button look="primary" onClick={() => replan.start({ planId: plan.id, profile })}>
                        Rearrange the plan
                    </Button>
                )}
                {plan.state !== "draft" && (
                    <>
                        <label className="flex items-center gap-2 text-sm">
                            <span className="text-muted">Calendar reminder</span>
                            <select
                                value={reminder === null ? "" : String(reminder)}
                                onChange={(e) => {
                                    const v = e.target.value === "" ? null : Number(e.target.value);
                                    setReminder(v);
                                    try {
                                        window.localStorage.setItem("orari.icsReminder", v === null ? "" : String(v));
                                    } catch {
                                        /* kept for this visit only */
                                    }
                                }}
                                className="min-h-11 rounded-m border border-control bg-raised px-2"
                            >
                                <option value="">No reminder</option>
                                <option value="0">At the start</option>
                                {[5, 10, 15, 30, 60, 1440].map((m) => (
                                    <option key={m} value={m}>
                                        {m === 1440 ? "1 day before" : `${m} min before`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <Button onClick={exportIcs}>Download calendar file (.ics)</Button>
                    </>
                )}
                {!confirmDelete ? (
                    <Button look="danger" onClick={() => setConfirmDelete(true)}>
                        Delete the plan
                    </Button>
                ) : (
                    <>
                        <Button
                            look="danger"
                            onClick={() => {
                                void store.deletePlan(plan.id).then((ok) => {
                                    if (ok) navigate({ name: "plans" });
                                });
                            }}
                        >
                            Yes, delete it
                        </Button>
                        <Button look="quiet" onClick={() => setConfirmDelete(false)}>
                            No
                        </Button>
                    </>
                )}
            </div>

            {plan.state === "draft" && <DraftPanel plan={plan} />}
            {plan.state !== "draft" && reminder !== null && (
                <p className="text-[13px] text-muted">
                    The reminder is written into the file as a calendar alarm. Whether your calendar app shows it is up to that app; Orari cannot check. The file is only created here: nothing is added to your calendar until you open it.
                </p>
            )}

            {replanState.status === "working" && (
                <Notice role="status" title="Rearranging the plan…">
                    <Button className="self-start" onClick={() => replan.cancel()}>
                        Stop
                    </Button>
                </Notice>
            )}
            {replanState.status === "failed" && (
                <Notice look="bad" role="alert" title={replanState.failure.message}>
                    <Button look="quiet" className="self-start" onClick={() => replan.reset()}>
                        Close
                    </Button>
                </Notice>
            )}
            {replanState.status === "done" && (
                <Notice look="ok" role="status" title="The plan was rearranged">
                    <Button look="quiet" className="self-start" onClick={() => replan.reset()}>
                        OK
                    </Button>
                </Notice>
            )}

            {plan.strategy && (
                <section className="flex flex-col gap-2 rounded-m bg-sunk p-4">
                    <h2 className="text-base font-semibold">How we built it</h2>
                    <p className="text-sm">{plan.strategy}</p>
                    {plan.explanations.length > 0 && (
                        <ul className="ml-5 list-disc text-sm text-muted">
                            {plan.explanations.map((e) => (
                                <li key={e}>{e}</li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
            {plan.warnings.length > 0 && (
                <Notice look="warn" title="Please note">
                    <ul className="ml-5 list-disc text-sm">
                        {plan.warnings.map((w) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </Notice>
            )}

            {[...byDate.entries()].map(([date, sessions]) => (
                <section key={date} className="flex flex-col gap-2" aria-label={dayLabel(date)}>
                    <h2 className="text-base font-semibold text-muted">{dayLabel(date)}</h2>
                    <ul className="flex flex-col gap-2 notebook:gap-0">
                        {sessions.map((session) => (
                            <SessionRow
                                key={session.id}
                                item={{ planId: plan.id, subject: plan.subject, session, state: sessionState(session, clock) }}
                                onMark={(status: SessionStatus) => void store.markSession(plan.id, session.id, status)}
                                linkTo={{ name: "session", planId: plan.id, sessionId: session.id }}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </>
    );
}

export function SessionScreen({ planId, sessionId }: { planId: string; sessionId: string }) {
    const { store } = useServices();
    const state = useStoreState();
    const clock = useClock();
    if (state.status !== "ready") return null;

    const plan = state.plans.find((p) => p.id === planId);
    const session = plan?.sessions.find((s) => s.id === sessionId);
    if (!plan || !session) {
        return (
            <Empty title="This session was not found">
                <Link to={{ name: "today" }} className={buttonClass("secondary", "self-start")}>
                    Back to Today
                </Link>
            </Empty>
        );
    }
    const sessionState_ = sessionState(session, clock);

    return (
        <>
            <Link to={{ name: "plan", planId: plan.id }} className={buttonClass("quiet", "self-start")}>
                ← {plan.subject}
            </Link>
            <header className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    <KindLabel kind={session.type} />
                    <StatePill state={sessionState_} />
                </div>
                <h1 className="text-2xl leading-snug">{session.title}</h1>
                <p className="text-muted">
                    {dayLabel(session.date)} · <TimeRange session={session} />
                </p>
            </header>

            {session.goal && (
                <section className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold">Goal</h2>
                    <p>{session.goal}</p>
                </section>
            )}
            {session.tasks.length > 0 && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-base font-semibold">What to do in this session</h2>
                    <ul className="flex flex-col gap-2">
                        {session.tasks.map((task) => (
                            <li key={task} className="rounded-m bg-sunk px-3 py-2.5">
                                {task}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {session.material && (
                <p className="text-sm text-muted">
                    Material: <span className="text-ink">{session.material}</span>
                </p>
            )}

            <section className="flex flex-col gap-2">
                <h2 className="text-base font-semibold">How did it go?</h2>
                <Marks status={session.status} onMark={(status) => void store.markSession(plan.id, session.id, status)} label={`How it went: ${session.title}`} />
            </section>
        </>
    );
}

/** An AI plan waiting to be published. It is on no schedule and in no calendar file until the person publishes it. */
function DraftPanel({ plan }: { plan: StoredPlan }) {
    const { store } = useServices();
    const [capacity, setCapacity] = useState(() => readCapacity(window.localStorage));
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const { violations, warnings } = useMemo(() => validatePlan(plan, capacity), [plan, capacity]);
    const needed = capacityNeeded(plan);
    const onlyCapacity = violations.length > 0 && violations.every((v) => v.code === "DAILY_CAPACITY" || v.code === "WEEKLY_CAPACITY");

    const doPublish = async () => {
        if (busy) return;
        setBusy(true);
        setSaveError(null);
        const result = publish(plan, capacity, new Date());
        if (result.ok && result.plan !== plan && !(await store.savePlan(result.plan))) setSaveError("The plan could not be saved on this device. It is still a draft; try again.");
        setBusy(false);
    };
    const discard = async () => {
        if (busy) return;
        setBusy(true);
        await store.deletePlan(plan.id);
        navigate({ name: "newPlan" });
    };
    const setLimit = (key: "dailyMinutes" | "weeklyMinutes", hours: number) => {
        if (!Number.isFinite(hours) || hours < 0.25) return;
        const next = { ...capacity, [key]: Math.round(hours * 60) };
        setCapacity(next);
        writeCapacity(window.localStorage, next);
    };

    return (
        <section aria-label="Draft" className="flex flex-col gap-3 rounded-m border border-control bg-warn-wash p-4" data-testid="draft">
            <h2 className="text-base font-semibold">Draft: review before it goes on your schedule</h2>
            <p className="text-sm">This plan was made by the AI. It is not on your Today or Week screens and not in any calendar file until you publish it. Nothing here expires.</p>
            {violations.length > 0 && (
                <div role="alert" className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-bad">This plan cannot be published as it is:</p>
                    <ul className="ml-5 list-disc text-sm">
                        {violations.slice(0, 8).map((v, i) => (
                            <li key={i}>{v.message}</li>
                        ))}
                        {violations.length > 8 && <li>…and {violations.length - 8} more.</li>}
                    </ul>
                </div>
            )}
            {warnings.length > 0 && (
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold">Worth a look (does not block publishing):</p>
                    <ul className="ml-5 list-disc text-sm">
                        {warnings.slice(0, 5).map((v, i) => (
                            <li key={i}>{v.message}</li>
                        ))}
                    </ul>
                </div>
            )}
            <fieldset className="flex flex-wrap items-center gap-3 text-sm">
                <legend className="mb-1 font-semibold">Study limits (suggested defaults: 2 h a day, 10 h a week)</legend>
                <label className="flex items-center gap-2">
                    Per day, hours
                    <input type="number" min={0.25} step={0.25} value={capacity.dailyMinutes / 60} onChange={(e) => setLimit("dailyMinutes", Number(e.target.value))} className="min-h-11 w-24 rounded-m border border-control bg-raised px-2" />
                </label>
                <label className="flex items-center gap-2">
                    Per week, hours
                    <input type="number" min={0.25} step={0.5} value={capacity.weeklyMinutes / 60} onChange={(e) => setLimit("weeklyMinutes", Number(e.target.value))} className="min-h-11 w-24 rounded-m border border-control bg-raised px-2" />
                </label>
            </fieldset>
            {onlyCapacity && (
                <p className="text-sm">
                    This plan fits if you allow up to {Math.ceil((needed.dailyMinutes / 60) * 4) / 4} h a day and {Math.ceil((needed.weeklyMinutes / 60) * 2) / 2} h a week, or if you create it again with a later end date.
                </p>
            )}
            {saveError && <p role="alert" className="text-sm font-semibold text-bad">{saveError}</p>}
            <div className="flex flex-wrap gap-2">
                <Button look="primary" disabled={busy || violations.length > 0} onClick={() => void doPublish()}>
                    {busy ? "Working…" : "Publish plan"}
                </Button>
                <Link to={{ name: "newPlan" }} className={buttonClass("secondary")}>
                    Create it again
                </Link>
                <Button look="danger" disabled={busy} onClick={() => void discard()}>
                    Reject and delete
                </Button>
            </div>
        </section>
    );
}
