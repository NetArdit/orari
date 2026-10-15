import { useState } from "react";
import { addDays, byTime } from "../domain/clock.ts";
import { sessionState } from "../domain/progress.ts";
import type { AgendaItem } from "../domain/progress.ts";
import { useClock, useServices, useStoreState } from "../app/services.tsx";
import { Button, Empty, buttonClass, Link, ScreenTitle, SessionRow } from "../ui/primitives.tsx";
import { dayLabel, shortDate, weekdayShort } from "../ui/text.ts";
import type { SessionStatus } from "../storage/model.ts";

/** The Monday of the week that holds `date`. */
function mondayOf(date: string): string {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
    return addDays(date, -((weekday + 6) % 7));
}

export function WeekScreen() {
    const { store } = useServices();
    const state = useStoreState();
    const clock = useClock();
    const [offset, setOffset] = useState(0);

    if (state.status !== "ready") return null;
    if (state.plans.length === 0) {
        return (
            <>
                <ScreenTitle title="Week" />
                <Empty title="No schedule yet">
                    <Link to={{ name: "newPlan" }} className={buttonClass("primary", "self-start")}>
                        Create your first plan
                    </Link>
                </Empty>
            </>
        );
    }

    const start = addDays(mondayOf(clock.today), offset * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const items: AgendaItem[] = state.plans.flatMap((plan) =>
        plan.sessions.map((session) => ({ planId: plan.id, subject: plan.subject, session, state: sessionState(session, clock) }))
    );
    const mark = (planId: string, sessionId: string) => (status: SessionStatus) => void store.markSession(planId, sessionId, status);

    return (
        <>
            <ScreenTitle eyebrow={`${shortDate(days[0]!)} – ${shortDate(days[6]!)}`} title="This week" />

            <div className="flex flex-wrap gap-2" role="group" aria-label="Java">
                <Button onClick={() => setOffset(offset - 1)}>← Java e kaluar</Button>
                <Button onClick={() => setOffset(0)} disabled={offset === 0}>
                    This week
                </Button>
                <Button onClick={() => setOffset(offset + 1)}>Next week →</Button>
            </div>

            <div className="grid gap-4 blocks:xl:grid-cols-7 blocks:xl:gap-2">
                {days.map((date) => {
                    const ofDay = items.filter((i) => i.session.date === date).sort((a, b) => byTime(a.session, b.session));
                    const isToday = date === clock.today;
                    return (
                        <section key={date} aria-label={dayLabel(date)} className={`flex min-w-0 flex-col gap-2 ${isToday ? "rounded-m bg-accent-wash p-2" : ""}`}>
                            <h2 className="flex items-baseline gap-2 border-b-2 border-ink pb-1 text-sm font-semibold notebook:border-line blocks:border-line blocks:font-time blocks:text-xs blocks:uppercase">
                                <span>{weekdayShort(date)}</span>
                                <span className={`text-lg ${isToday ? "text-accent" : ""}`}>{date.slice(8).replace(/^0/, "")}</span>
                                {isToday && <span className="text-xs text-accent">sot</span>}
                            </h2>
                            {ofDay.length === 0 ? (
                                <p className="py-1 text-[13px] text-muted">Pa seanca.</p>
                            ) : (
                                <ul className="flex flex-col gap-2 notebook:gap-0">
                                    {ofDay.map((item) => (
                                        <SessionRow key={`${item.planId}:${item.session.id}`} item={item} onMark={mark(item.planId, item.session.id)} showDate={weekdayShort(date)} compact linkTo={{ name: "session", planId: item.planId, sessionId: item.session.id }} />
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>
        </>
    );
}
