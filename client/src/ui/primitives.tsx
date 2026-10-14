import type { ReactNode } from "react";
import { durationMinutes } from "../domain/clock.ts";
import type { AgendaItem, SessionState } from "../domain/progress.ts";
import { hrefFor } from "../router/routes.ts";
import type { Route } from "../router/routes.ts";
import { handleLinkClick } from "../router/useRoute.ts";
import type { SessionStatus, StoredSession } from "../storage/model.ts";
import { KIND_LABELS, MARKS, minutesLabel, STATE_LABELS } from "./text.ts";

type LinkTarget = Exclude<Route, { name: "notFound" }>;

export function Link({ to, className, children, ...rest }: { to: LinkTarget; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
    return (
        <a href={hrefFor(to)} onClick={handleLinkClick} className={className} {...rest}>
            {children}
        </a>
    );
}

const BUTTON_BASE = "inline-flex min-h-11 items-center justify-center gap-2 rounded-m px-5 font-semibold transition-colors disabled:cursor-default disabled:opacity-55";
const BUTTON_LOOKS = {
    primary: "rounded-full bg-accent text-on-accent hover:opacity-90",
    secondary: "border border-line bg-raised text-ink hover:bg-sunk",
    quiet: "px-2 text-accent hover:bg-accent-wash",
    danger: "border border-line bg-raised text-bad hover:bg-bad-wash",
} as const;

export function buttonClass(look: keyof typeof BUTTON_LOOKS, extra = ""): string {
    return `${BUTTON_BASE} ${BUTTON_LOOKS[look]} ${extra}`.trim();
}

export function Button({ look = "secondary", className = "", ...rest }: { look?: keyof typeof BUTTON_LOOKS } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button type="button" className={buttonClass(look, className)} {...rest} />;
}

const NOTICE_LOOKS = { info: "bg-sunk", warn: "bg-warn-wash", bad: "bg-bad-wash", ok: "bg-ok-wash" } as const;
const NOTICE_TITLE = { info: "text-ink", warn: "text-warn", bad: "text-bad", ok: "text-ok" } as const;

export function Notice({ look = "info", title, children, role }: { look?: keyof typeof NOTICE_LOOKS; title: string; children?: ReactNode; role?: "alert" | "status" }) {
    return (
        <div role={role} className={`flex flex-col gap-2 rounded-m p-4 ${NOTICE_LOOKS[look]}`}>
            <p className={`font-semibold ${NOTICE_TITLE[look]}`}>{title}</p>
            {children}
        </div>
    );
}

export function KindLabel({ kind }: { kind: StoredSession["type"] }) {
    return (
        <span className="kind text-xs font-semibold" style={{ color: "var(--kind)" }} data-kind={kind}>
            {KIND_LABELS[kind]}
        </span>
    );
}

const STATE_LOOKS: Partial<Record<SessionState, string>> = {
    done: "bg-ok-wash text-ok",
    partial: "bg-ok-wash text-ok",
    skipped: "bg-sunk text-muted",
    missed: "bg-warn-wash text-warn",
    late: "bg-warn-wash text-warn",
    now: "bg-accent-wash text-accent",
};

export function StatePill({ state }: { state: SessionState }) {
    const label = STATE_LABELS[state];
    if (!label) return null;
    const mark = state === "done" ? "✓ " : "";
    return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_LOOKS[state] ?? ""}`}>{mark}{label}</span>;
}

/** The three ways to mark a session. Pressing the one already chosen clears it. */
export function Marks({ status, onMark, label, tight = false }: { status: SessionStatus; onMark: (next: SessionStatus) => void; label: string; tight?: boolean }) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {MARKS.map((mark) => (
                <button
                    key={mark.status}
                    type="button"
                    aria-pressed={status === mark.status}
                    onClick={() => onMark(status === mark.status ? "pending" : mark.status)}
                    className={`min-h-11 rounded-full border border-line px-3.5 text-[13px] font-semibold transition-colors aria-pressed:border-transparent aria-pressed:bg-ok-wash aria-pressed:text-ok hover:bg-sunk ${tight ? "blocks:xl:min-h-9 blocks:xl:px-2.5 blocks:xl:text-xs" : ""}`}
                >
                    {mark.label}
                </button>
            ))}
        </div>
    );
}

export function TimeRange({ session, className = "" }: { session: Pick<StoredSession, "startTime" | "endTime">; className?: string }) {
    return (
        <span className={`font-time tabular-nums ${className}`}>
            {session.startTime}
            <span aria-hidden="true">–</span>
            <span className="sr-only"> deri në </span>
            {session.endTime}
        </span>
    );
}

/** One session as a row: when, what kind, what, how long, and the marks. Used by Today, a plan and the week. */
export function SessionRow({ item, onMark, showDate, linkTo, compact = false }: { item: AgendaItem; onMark: (status: SessionStatus) => void; showDate?: string; linkTo: LinkTarget; compact?: boolean }) {
    const { session, state, subject } = item;
    const over = state === "done" || state === "partial" || state === "skipped";
    return (
        <li className={`fade-in grid grid-cols-[4.25rem_1fr] gap-3 rounded-m bg-raised p-3 notebook:rounded-none notebook:bg-transparent notebook:px-1 notebook:py-3.5 notebook:not-first:border-t notebook:not-first:border-dotted notebook:not-first:border-line ${compact ? "blocks:xl:grid-cols-1 blocks:xl:gap-1" : ""}`}>
            <div className="pt-0.5 text-sm font-semibold blocks:text-[15px] notebook:font-display notebook:text-base">
                <span className="font-time tabular-nums notebook:font-display">{session.startTime}</span>
                <span className="block text-xs font-normal text-muted">{showDate ?? minutesLabel(durationMinutes(session))}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <KindLabel kind={session.type} />
                    <StatePill state={state} />
                </div>
                <Link to={linkTo} className={`font-semibold leading-snug underline-offset-2 hover:underline ${over ? "text-muted" : ""} ${state === "done" ? "line-through decoration-1" : ""}`}>
                    {session.title}
                </Link>
                <p className="text-[13px] text-muted">
                    {subject} · <TimeRange session={session} />
                </p>
                {/* In the wide week grid of the blocks style the columns are narrow: the marks stay, in a tighter size. */}
                <Marks status={session.status} onMark={onMark} label={`Si shkoi: ${session.title}`} tight={compact} />
            </div>
        </li>
    );
}

export function ScreenTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
    return (
        <header className="flex flex-col gap-1">
            {eyebrow && <p className="text-[13px] text-muted notebook:font-display notebook:italic blocks:font-time blocks:text-xs blocks:uppercase blocks:tracking-wider">{eyebrow}</p>}
            <h1 className="text-3xl leading-tight">{title}</h1>
            {children}
        </header>
    );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
    return (
        <section className="flex flex-col gap-4 py-8">
            <h2 className="text-2xl">{title}</h2>
            {children}
        </section>
    );
}
