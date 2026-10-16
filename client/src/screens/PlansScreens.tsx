import { useMemo, useState } from "react";
import { byTime } from "../domain/clock.ts";
import { icsFileName, planToIcs } from "../domain/ics.ts";
import { needsReplan, progressOf, sessionState } from "../domain/progress.ts";
import { createReplanFlow } from "../state/flows.ts";
import { navigate } from "../router/useRoute.ts";
import { useClock, useFlow, useServices, useStoreState } from "../app/services.tsx";
import { Button, buttonClass, Empty, KindLabel, Link, Marks, Notice, ScreenTitle, SessionRow, StatePill, TimeRange } from "../ui/primitives.tsx";
import { dayLabel, shortDate } from "../ui/text.ts";
import type { SessionStatus } from "../storage/model.ts";

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
        const blob = new Blob([planToIcs(plan, { now: new Date() })], { type: "text/calendar;charset=utf-8" });
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
                <Button onClick={exportIcs}>Add to calendar (.ics)</Button>
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
