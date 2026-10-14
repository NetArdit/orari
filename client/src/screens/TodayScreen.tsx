import { useMemo } from "react";
import { createReplanFlow } from "../state/flows.ts";
import { durationMinutes } from "../domain/clock.ts";
import { currentPlan, needsReplan, nextSession, progressOf, streakDays, todayAgenda } from "../domain/progress.ts";
import { useClock, useFlow, useServices, useStoreState } from "../app/services.tsx";
import { AccountRecovery, Button, buttonClass, Empty, Link, Notice, ScreenTitle, SessionRow } from "../ui/primitives.tsx";
import { dayLabel, minutesLabel } from "../ui/text.ts";
import type { SessionStatus } from "../storage/model.ts";

export function TodayScreen() {
    const { api, store } = useServices();
    const state = useStoreState();
    const clock = useClock();
    const replan = useMemo(() => createReplanFlow({ api, store }), [api, store]);
    const replanState = useFlow(replan);

    if (state.status !== "ready") return null;
    const { plans, profile } = state;

    if (plans.length === 0) {
        return (
            <>
                <ScreenTitle eyebrow={dayLabel(clock.today)} title="Sot" />
                <Empty title="Ende s'ke orar">
                    <p className="text-muted">Krijoje të parin për dy minuta: trego çfarë ke për të mësuar, deri kur, dhe kur je e lirë.</p>
                    <Link to={{ name: "newPlan" }} className={buttonClass("primary", "self-start")}>
                        Krijo planin e parë
                    </Link>
                </Empty>
            </>
        );
    }

    const agenda = todayAgenda(plans, clock);
    const next = nextSession(plans, clock);
    const allSessions = plans.flatMap((p) => p.sessions);
    const progress = progressOf(allSessions, clock);
    const streak = streakDays(allSessions, clock);
    const behind = plans.find((p) => p.id === currentPlan(plans, clock)?.id && needsReplan(p, clock)) ?? plans.find((p) => needsReplan(p, clock));
    const doneToday = agenda.filter((i) => i.state === "done" || i.state === "partial").length;

    const mark = (planId: string, sessionId: string) => (status: SessionStatus) => void store.markSession(planId, sessionId, status);

    return (
        <>
            <ScreenTitle eyebrow={dayLabel(clock.today)} title="Sot">
                {agenda.length > 0 && (
                    <p className="text-muted">
                        {doneToday} nga {agenda.length} seanca të kryera{streak > 1 ? ` · ${streak} ditë rresht` : ""}
                    </p>
                )}
            </ScreenTitle>

            {state.saveError && (
                <Notice look="bad" role="alert" title="Ndryshimi nuk u ruajt në këtë pajisje">
                    <p className="text-sm">Shënimi u kthye mbrapa. Provo përsëri.</p>
                    <Button look="quiet" className="self-start" onClick={() => store.dismissSaveError()}>
                        Në rregull
                    </Button>
                </Notice>
            )}

            {behind && replanState.status !== "done" && (
                <Notice look="warn" title={`Ke seanca të humbura te "${behind.subject}"`}>
                    {replanState.status === "idle" && (
                        <>
                            <p className="text-sm">Mund ta rregullojmë pjesën e mbetur të planit që të futet në kohën që ke.</p>
                            <Button look="primary" className="self-start" onClick={() => replan.start({ planId: behind.id, profile: profile ?? { name: "Nxënës", educationLevel: null } })}>
                                Rregulloje planin
                            </Button>
                        </>
                    )}
                    {replanState.status === "working" && (
                        <div role="status" className="flex flex-col gap-2">
                            <p className="text-sm">Po e rregullojmë planin… zakonisht merr më pak se një minutë.</p>
                            <Button className="self-start" onClick={() => replan.cancel()}>
                                Ndale
                            </Button>
                        </div>
                    )}
                    {replanState.status === "failed" && (
                        <div role="alert" className="flex flex-col gap-2">
                            <p className="text-sm">{replanState.failure.message}</p>
                            <AccountRecovery kind={replanState.failure.kind} />
                            <div className="flex flex-wrap gap-2">
                                <Button look="primary" onClick={() => { replan.reset(); replan.start({ planId: behind.id, profile: profile ?? { name: "Nxënës", educationLevel: null } }); }}>
                                    Provo prapë
                                </Button>
                                <Button look="quiet" onClick={() => replan.reset()}>
                                    Mbyll
                                </Button>
                            </div>
                        </div>
                    )}
                </Notice>
            )}

            {replanState.status === "done" && (
                <Notice look="ok" role="status" title="Plani u rregullua">
                    <p className="text-sm">
                        {replanState.result.added} seanca të reja. Çfarë ke kryer mbetet siç ishte.
                        {replanState.result.alreadyOver > 0 ? ` ${replanState.result.alreadyOver} prej tyre janë sot, në orë që kanë kaluar.` : ""}
                    </p>
                    <Button look="quiet" className="self-start" onClick={() => replan.reset()}>
                        Në rregull
                    </Button>
                </Notice>
            )}

            {next ? (
                <section aria-label="Seanca e radhës" className="flex flex-col gap-3 rounded-l bg-raised p-5 shadow-raised notebook:bg-accent notebook:text-on-accent blocks:border blocks:border-line">
                    <p className="text-[13px] opacity-80">
                        Seanca e radhës · {next.subject}
                        {next.session.date !== clock.today ? ` · ${dayLabel(next.session.date)}` : ""}
                    </p>
                    <p className="flex items-baseline gap-3">
                        <span className="font-time text-3xl font-bold tabular-nums tracking-tight blocks:text-4xl blocks:text-accent">{next.session.startTime}</span>
                        <span className="text-sm opacity-80">{next.state === "now" ? "po vazhdon" : `deri ${next.session.endTime} · ${minutesLabel(durationMinutes(next.session))}`}</span>
                    </p>
                    <h2 className="text-xl leading-snug">{next.session.title}</h2>
                    {next.session.tasks.length > 0 && (
                        <ul className="ml-5 list-disc text-sm opacity-90">
                            {next.session.tasks.slice(0, 4).map((task) => (
                                <li key={task}>{task}</li>
                            ))}
                        </ul>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Link to={{ name: "session", planId: next.planId, sessionId: next.session.id }} className={buttonClass("primary", "notebook:bg-on-accent notebook:text-accent")}>
                            Hape seancën
                        </Link>
                    </div>
                </section>
            ) : (
                <Notice look="ok" title="S'ka seanca të tjera përpara">
                    <p className="text-sm">{progress.remaining === 0 ? "Gjithçka e planifikuar është kryer ose ka kaluar." : "Seancat e radhës janë në ditët e ardhshme."}</p>
                </Notice>
            )}

            <section aria-label="Sot" className="flex flex-col gap-2">
                <h2 className="text-base font-semibold text-muted">Sot</h2>
                {agenda.length === 0 ? (
                    <p className="text-muted">Nuk ke seanca të planifikuara sot.</p>
                ) : (
                    <ul className="flex flex-col gap-2 notebook:gap-0">
                        {agenda.map((item) => (
                            <SessionRow key={`${item.planId}:${item.session.id}`} item={item} onMark={mark(item.planId, item.session.id)} linkTo={{ name: "session", planId: item.planId, sessionId: item.session.id }} />
                        ))}
                    </ul>
                )}
            </section>

            <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                    ["Kryer", String(progress.done + progress.partial)],
                    ["Të humbura", String(progress.missed)],
                    ["Përpara", String(progress.remaining)],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-m bg-sunk p-3">
                        <dd className="font-time text-2xl font-bold tabular-nums">{value}</dd>
                        <dt className="text-xs text-muted">{label}</dt>
                    </div>
                ))}
            </dl>
        </>
    );
}
