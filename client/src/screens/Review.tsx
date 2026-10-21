import { useMemo, useState } from "react";
import { useServices } from "../app/services.tsx";
import { clockFrom } from "../domain/clock.ts";
import { mondayOf, reviewWeek, suggestionsFrom } from "../domain/review.ts";
import { applyProposal, proposalToShow, type ProposalMemory } from "../domain/schedule.ts";
import { readCapacity, writeCapacity } from "../domain/validate.ts";
import type { StoredPlan } from "../storage/model.ts";
import { Button, Notice } from "../ui/primitives.tsx";
import { shortDate } from "../ui/text.ts";

const MEMORY_KEY = "orari.proposalMemory";
const loadMemory = (): ProposalMemory => {
    try {
        const v = JSON.parse(window.localStorage.getItem(MEMORY_KEY) ?? "null") as ProposalMemory | null;
        return v && typeof v.dismissedAt === "object" && v.dismissedAt ? v : { dismissedAt: {} };
    } catch {
        return { dismissedAt: {} };
    }
};
const saveMemory = (m: ProposalMemory) => {
    try {
        window.localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
    } catch {
        /* the cooldown then holds for this visit only */
    }
};

/**
 * Missed sessions moved to new places: a proposal with a diff (what moves, from where to where, why), applied only when
 * the person confirms. Nothing is changed by looking at it. After "Not now" it stays away for a day.
 */
export function RescheduleProposal({ plan }: { plan: StoredPlan }) {
    const { store } = useServices();
    const [memory, setMemory] = useState(loadMemory);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const capacity = readCapacity(window.localStorage);
    const proposal = useMemo(() => (plan.state === "draft" ? null : proposalToShow(plan, new Date(), capacity, memory)), [plan, memory, capacity.dailyMinutes, capacity.weeklyMinutes]);

    if (done) return <Notice look="ok" role="status" title="The sessions were moved. Nothing else changed." />;
    if (!proposal) return null;
    const apply = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        const next = applyProposal(plan, proposal, capacity);
        if (!next) setError("The plan changed since this was worked out, or the result would break a rule. Nothing was changed; a new proposal will be made.");
        else if (!(await store.savePlan(next))) setError("The change could not be saved on this device. Nothing was changed.");
        else setDone(true);
        setBusy(false);
    };
    const dismiss = () => {
        const next = { dismissedAt: { ...memory.dismissedAt, [plan.id]: Date.now() } };
        setMemory(next);
        saveMemory(next);
    };
    const fmt = (p: { date: string; startTime: string; endTime: string }) => `${shortDate(p.date)} ${p.startTime}–${p.endTime}`;
    return (
        <section aria-labelledby="proposal-title" className="flex flex-col gap-2 rounded-m border border-control bg-warn-wash p-4" data-testid="reschedule">
            <h2 id="proposal-title" className="text-base font-semibold">Move the missed sessions?</h2>
            <p className="text-sm">These sessions ended without being marked done or skipped. This is a proposal: nothing changes until you confirm.</p>
            {proposal.moves.length > 0 && (
                <ul className="flex flex-col gap-2 text-sm">
                    {proposal.moves.map((m) => (
                        <li key={m.sessionId}>
                            <span className="font-semibold">{m.title}</span>: <s>{fmt(m.from)}</s> → {fmt(m.to)}
                            <span className="block text-[13px] text-muted">{m.reason}</span>
                        </li>
                    ))}
                </ul>
            )}
            {proposal.unplaced.length > 0 && (
                <div className="text-sm" role="status">
                    <p className="font-semibold">Not placed:</p>
                    <ul className="ml-5 list-disc">
                        {proposal.unplaced.map((u) => (
                            <li key={u.sessionId}>
                                {u.title}: {u.reason} {u.fitsIfEndDate ? `It would fit if the end date moved to ${shortDate(u.fitsIfEndDate)}, or if you allowed more study time.` : "It does not fit even four weeks later with your limits; change the limits or the goal."}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {error && <p role="alert" className="text-sm font-semibold text-bad">{error}</p>}
            <div className="flex flex-wrap gap-2">
                {proposal.moves.length > 0 && (
                    <Button look="primary" disabled={busy} onClick={() => void apply()}>
                        {busy ? "Working…" : "Move them"}
                    </Button>
                )}
                <Button disabled={busy} onClick={dismiss}>
                    Not now
                </Button>
            </div>
        </section>
    );
}

/** The week at a glance, from what is recorded; suggestions are offered, never applied. */
export function WeeklyReview({ plans, weekStart }: { plans: readonly StoredPlan[]; weekStart?: string }) {
    const clock = clockFrom(new Date());
    const start = weekStart ?? mondayOf(clock.today);
    const review = reviewWeek(plans, start, new Date());
    const [dismissed, setDismissed] = useState<string[]>(() => {
        try {
            return JSON.parse(window.localStorage.getItem(`orari.dismissed.${start}`) ?? "[]") as string[];
        } catch {
            return [];
        }
    });
    const [capacity, setCapacity] = useState(() => readCapacity(window.localStorage));
    const [open, setOpen] = useState<string | null>(null);
    if (review.planned === 0) return null;
    const suggestions = suggestionsFrom(review).filter((s) => !dismissed.includes(s.id));
    const dismiss = (id: string) => {
        const next = [...dismissed, id];
        setDismissed(next);
        try {
            window.localStorage.setItem(`orari.dismissed.${start}`, JSON.stringify(next));
        } catch {
            /* this visit only */
        }
    };
    const hours = (m: number) => `${Math.floor(m / 60)} h ${m % 60} min`;
    return (
        <section aria-labelledby="review-title" className="flex flex-col gap-3 rounded-m bg-sunk p-4" data-testid="weekly-review">
            <h2 id="review-title" className="text-lg font-semibold">This week, as recorded</h2>
            <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                {[
                    ["Planned", review.planned],
                    ["Marked completed", review.completed],
                    ["Partly done", review.partial],
                    ["Skipped", review.skipped],
                    ["Ended, not marked", review.unmarked],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-m bg-raised p-3">
                        <dd className="font-time text-2xl font-bold tabular-nums">{value}</dd>
                        <dt className="text-xs text-muted">{label}</dt>
                    </div>
                ))}
            </dl>
            <p className="text-sm">
                Study time in sessions marked completed: <span className="font-semibold">{hours(review.confirmedMinutes)}</span>. Sessions that ended without a mark are not counted, because nothing says whether they happened. {review.upcoming} still to come.
            </p>
            {review.perPlan.length > 0 && (
                <ul className="text-sm">
                    {review.perPlan.map((p) => (
                        <li key={p.planId}>
                            {p.subject}: {p.completed} of {p.planned} marked completed
                        </li>
                    ))}
                </ul>
            )}
            {suggestions.map((s) => (
                <div key={s.id} className="flex flex-col gap-1 rounded-m bg-raised p-3 text-sm" role="note">
                    <p className="text-[13px] text-muted">Based on: {s.evidence}.</p>
                    <p>{s.text}</p>
                    {open === s.id && s.action === "limits" && (
                        <label className="flex items-center gap-2">
                            Daily limit, hours
                            <input
                                type="number"
                                min={0.25}
                                step={0.25}
                                value={capacity.dailyMinutes / 60}
                                onChange={(e) => {
                                    const h = Number(e.target.value);
                                    if (!Number.isFinite(h) || h < 0.25) return;
                                    const next = { ...capacity, dailyMinutes: Math.round(h * 60) };
                                    setCapacity(next);
                                    writeCapacity(window.localStorage, next);
                                }}
                                className="min-h-11 w-24 rounded-m border border-control bg-raised px-2"
                            />
                        </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {s.action !== "none" && open !== s.id && <Button onClick={() => setOpen(s.id)}>{s.action === "reschedule" ? "Show me" : "Change the limit"}</Button>}
                        <Button look="quiet" onClick={() => dismiss(s.id)}>
                            Dismiss
                        </Button>
                    </div>
                    {open === s.id && s.action === "reschedule" && <p>Open the plan: a proposal with the exact moves is shown there, and nothing moves until you confirm.</p>}
                </div>
            ))}
        </section>
    );
}
