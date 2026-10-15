import { useEffect, useMemo, useState } from "react";
import { createParseFlow, createPlanFlow } from "../state/flows.ts";
import { clockFrom } from "../domain/clock.ts";
import { applyPlanDefaults, buildPlanInputs, emptyPlanForm, errorsAt, LIMITS, WEEKDAYS } from "../domain/planForm.ts";
import type { CommitmentDraft, CommitmentKind, Difficulty, Energy, PlanFormState, PlanMode, Weekday } from "../domain/planForm.ts";
import { navigate } from "../router/useRoute.ts";
import { useFlow, useServices, useStoreState } from "../app/services.tsx";
import { Field, INPUT } from "../ui/forms.tsx";
import { AccountRecovery, Button, buttonClass, Link, Notice, ScreenTitle } from "../ui/primitives.tsx";
import type { FieldError } from "../api/types.ts";

const WEEKDAY_NAMES: Record<Weekday, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const WEEKDAY_SHORT: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const MODES: [PlanMode, string][] = [["general", "General"], ["exam", "Exam"], ["new_subject", "New subject"], ["project", "Project"], ["assignment", "Assignment"], ["certification", "Certification"], ["skill", "Skill"], ["revision", "Revision"]];
const DIFFICULTIES: [Difficulty, string][] = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]];
const COMMITMENT_KINDS: [CommitmentKind, string][] = [["work", "Work"], ["school", "School"], ["commute", "Commute"], ["meal", "Meal"], ["sleep", "Sleep"], ["family", "Family"], ["gym", "Gym"], ["other", "Other"]];
const ENERGY: [Energy | "", string][] = [["", "—"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];

function Select<T extends string>({ value, options, onChange, ...rest }: { value: T; options: [T, string][]; onChange: (value: T) => void } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
    return (
        <select {...rest} value={value} onChange={(e) => onChange(e.target.value as T)} className={INPUT}>
            {options.map(([v, label]) => (
                <option key={v} value={v}>
                    {label}
                </option>
            ))}
        </select>
    );
}

export function NewPlanScreen() {
    const { api, store } = useServices();
    const state = useStoreState();
    const parse = useMemo(() => createParseFlow({ api, store }), [api, store]);
    const create = useMemo(() => createPlanFlow({ api, store }), [api, store]);
    const parseState = useFlow(parse);
    const createState = useFlow(create);

    const today = clockFrom(new Date()).today;
    const [step, setStep] = useState<"describe" | "check">("describe");
    const [text, setText] = useState("");
    const [form, setForm] = useState<PlanFormState>(() => emptyPlanForm(today));
    const [questions, setQuestions] = useState<string[]>([]);
    const [newDate, setNewDate] = useState("");

    const update = (change: (draft: PlanFormState) => void) =>
        setForm((previous) => {
            const next = structuredClone(previous);
            change(next);
            return next;
        });

    const profile = state.status === "ready" && state.profile ? state.profile : { name: "Student", educationLevel: null };

    // What the AI read becomes the form, once, with what the person left out filled in. When that is enough for a
    // plan, the plan is made at once: a short description is all it takes. Otherwise the form is shown to be completed.
    useEffect(() => {
        if (parseState.status !== "done") return;
        const completed = applyPlanDefaults(parseState.result.form, today);
        setForm(completed);
        setQuestions([]);
        setStep("check");
        parse.reset();
        if (buildPlanInputs(completed).ok) create.start({ form: completed, profile });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [parseState, parse]);

    // A created plan: go to it.
    useEffect(() => {
        if (createState.status === "done") navigate({ name: "plan", planId: createState.result.planId });
    }, [createState]);

    const fieldErrors: FieldError[] = createState.status === "failed" && "fields" in createState.failure && createState.failure.fields ? createState.failure.fields : [];
    const at = (path: string) => errorsAt(fieldErrors, path);
    const creating = createState.status === "working";

    if (step === "describe") {
        const failure = parseState.status === "failed" ? parseState.failure : null;
        const working = parseState.status === "working";
        return (
            <>
                <ScreenTitle eyebrow="New plan" title="What do you want to learn?" />
                <p className="text-muted">Write it as if you were telling a friend: the subject, until when, and when you are free. Anything you leave out, the AI works out for you and builds the plan right away.</p>

                <Field label="Your description" hint="Don't worry about spelling.">
                    {(props) => <textarea {...props} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={7} className={`${INPUT} py-2.5`} placeholder="e.g. I have my Maths exam on 30 October, chapters 3 to 5. I work from 9 to 5. I don't want to study on Sundays." />}
                </Field>

                {failure && (
                    <Notice look="bad" role="alert" title={failure.message}>
                        <AccountRecovery kind={failure.kind} />
                        {failure.kind !== "invalid" && "retryAfterSeconds" in failure && failure.retryAfterSeconds ? <p className="text-sm">Try again in {failure.retryAfterSeconds} seconds.</p> : null}
                    </Notice>
                )}

                {working ? (
                    <div role="status" className="flex flex-col gap-2">
                        <p className="text-muted">Reading your description… this usually takes under a minute.</p>
                        <Button className="self-start" onClick={() => parse.cancel()}>
                            Stop
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <Button look="primary" onClick={() => parse.start(text)}>
                            Continue
                        </Button>
                        <Button look="quiet" onClick={() => { setForm(emptyPlanForm(today)); setStep("check"); }}>
                            I'd rather fill it in myself
                        </Button>
                    </div>
                )}
                <p className="text-[13px] text-muted">The text you write is sent to an outside AI service to be read. Do not write anything you would not share with others.</p>
            </>
        );
    }

    return (
        <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
                event.preventDefault();
                create.reset();
                create.start({ form, profile });
            }}
            noValidate
        >
            <ScreenTitle eyebrow="New plan" title="Did we understand you correctly?">
                <p className="text-muted">Correct anything that is off, then create the schedule.</p>
            </ScreenTitle>

            {questions.length > 0 && (
                <Notice look="warn" title="The AI wanted to know:">
                    <ul className="ml-5 list-disc text-sm">
                        {questions.map((q) => (
                            <li key={q}>{q}</li>
                        ))}
                    </ul>
                    <p className="text-[13px]">Answer by changing the fields below.</p>
                </Notice>
            )}

            {createState.status === "failed" && fieldErrors.length === 0 && (
                <Notice look="bad" role="alert" title={createState.failure.message}>
                    <AccountRecovery kind={createState.failure.kind} />
                    {"retryAfterSeconds" in createState.failure && createState.failure.retryAfterSeconds ? <p className="text-sm">Try again in {createState.failure.retryAfterSeconds} seconds.</p> : null}
                </Notice>
            )}
            {fieldErrors.length > 0 && (
                <Notice look="bad" role="alert" title="Some fields need fixing">
                    <ul className="ml-5 list-disc text-sm">
                        {fieldErrors.map((e, i) => (
                            <li key={`${e.path}:${i}`}>{e.message}</li>
                        ))}
                    </ul>
                </Notice>
            )}

            <section className="flex flex-col gap-4">
                <Field label="Subject" errors={at("subject")}>
                    {(props) => <input {...props} type="text" value={form.subject} maxLength={120} onChange={(e) => update((d) => void (d.subject = e.target.value))} className={INPUT} />}
                </Field>
                <Field label="What it covers" hint="Chapters, pages, topics." errors={at("materialAmount")}>
                    {(props) => <input {...props} type="text" value={form.material} maxLength={200} onChange={(e) => update((d) => void (d.material = e.target.value))} className={INPUT} />}
                </Field>
                <Field label="What you want to achieve" errors={at("goal")}>
                    {(props) => <input {...props} type="text" value={form.goal} maxLength={300} onChange={(e) => update((d) => void (d.goal = e.target.value))} className={INPUT} />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Kind of plan">{(props) => <Select {...props} value={form.planMode} options={MODES} onChange={(v) => update((d) => void (d.planMode = v))} />}</Field>
                    <Field label="Difficulty">{(props) => <Select {...props} value={form.difficulty} options={DIFFICULTIES} onChange={(v) => update((d) => void (d.difficulty = v))} />}</Field>
                    <Field label="From" errors={at("startDate")}>
                        {(props) => <input {...props} type="date" value={form.startDate} onChange={(e) => update((d) => void (d.startDate = e.target.value))} className={INPUT} />}
                    </Field>
                    <Field label="Until" errors={at("endDate")} hint="Optional: leave it empty and the plan runs four weeks.">
                        {(props) => <input {...props} type="date" value={form.endDate} onChange={(e) => update((d) => void (d.endDate = e.target.value))} className={INPUT} />}
                    </Field>
                    <Field label="How long a session lasts" hint="Optional." errors={at("sessionPreferenceMinutes")}>
                        {(props) => (
                            <select {...props} value={form.sessionMinutes ?? ""} onChange={(e) => update((d) => void (d.sessionMinutes = e.target.value ? Number(e.target.value) : null))} className={INPUT}>
                                <option value="">Let the plan decide</option>
                                {[25, 30, 45, 60, 90, 120].map((m) => (
                                    <option key={m} value={m}>
                                        {m} minutes
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>
                </div>
            </section>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-lg font-semibold">When you are free</legend>
                <p className="text-[13px] text-muted">For each day choose: leave it unset, mark the hours when you study, or mark a rest day. If no day is set, any day can be planned.</p>
                {errorsAt(fieldErrors, "weeklyAvailability").length > 0 && at("weeklyAvailability").map((m) => <p key={m} className="text-[13px] font-semibold text-bad">{m}</p>)}
                {WEEKDAYS.map((day) => {
                    const entry = form.days[day];
                    return (
                        <div key={day} className="flex flex-col gap-2 rounded-m bg-sunk p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold">{WEEKDAY_NAMES[day]}</span>
                                <select
                                    aria-label={`${WEEKDAY_NAMES[day]}: what happens`}
                                    value={entry.mode}
                                    onChange={(e) => update((d) => { const mode = e.target.value as "unset" | "free" | "off"; d.days[day].mode = mode; if (mode === "free" && d.days[day].windows.length === 0) d.days[day].windows = [{ start: "17:00", end: "19:00" }]; })}
                                    className={`${INPUT} w-auto`}
                                >
                                    <option value="unset">Not set</option>
                                    <option value="free">Study</option>
                                    <option value="off">Rest</option>
                                </select>
                            </div>
                            {entry.mode === "free" && (
                                <div className="flex flex-col gap-2">
                                    {entry.windows.map((w, i) => {
                                        const idx = WEEKDAYS.filter((x) => form.days[x].mode !== "unset").indexOf(day);
                                        const errs = errorsAt(fieldErrors, `weeklyAvailability.${idx}.windows.${i}`);
                                        return (
                                            <div key={i} className="flex flex-wrap items-center gap-2">
                                                <input aria-label={`${WEEKDAY_NAMES[day]}, from`} aria-invalid={errs.length > 0} type="time" value={w.start} onChange={(e) => update((d) => void (d.days[day].windows[i]!.start = e.target.value))} className={`${INPUT} w-auto font-time`} />
                                                <span aria-hidden="true">–</span>
                                                <input aria-label={`${WEEKDAY_NAMES[day]}, until`} aria-invalid={errs.length > 0} type="time" value={w.end} onChange={(e) => update((d) => void (d.days[day].windows[i]!.end = e.target.value))} className={`${INPUT} w-auto font-time`} />
                                                <Button look="quiet" aria-label={`Remove time ${i + 1} of ${WEEKDAY_NAMES[day]}`} onClick={() => update((d) => void d.days[day].windows.splice(i, 1))}>
                                                    Remove
                                                </Button>
                                                {errs.length > 0 && <span className="text-[13px] font-semibold text-bad">{errs.join(" ")}</span>}
                                            </div>
                                        );
                                    })}
                                    {entry.windows.length < LIMITS.windowsPerDay && (
                                        <Button look="quiet" className="self-start" onClick={() => update((d) => void d.days[day].windows.push({ start: "20:00", end: "21:00" }))}>
                                            + Add a time
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-lg font-semibold">When you are busy</legend>
                <p className="text-[13px] text-muted">Work, school, sleep, commuting. Sessions are never placed over them. Sleep from 23:00 to 07:00 is assumed unless you add your own.</p>
                {form.commitments.map((c: CommitmentDraft, i) => {
                    const errs = errorsAt(fieldErrors, `commitments.${i}`);
                    return (
                        <div key={i} className="flex flex-col gap-3 rounded-m bg-sunk p-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Name" errors={errorsAt(fieldErrors, `commitments.${i}.label`)}>
                                    {(props) => <input {...props} type="text" value={c.label} maxLength={60} onChange={(e) => update((d) => void (d.commitments[i]!.label = e.target.value))} className={INPUT} />}
                                </Field>
                                <Field label="Kind">{(props) => <Select {...props} value={c.kind} options={COMMITMENT_KINDS} onChange={(v) => update((d) => void (d.commitments[i]!.kind = v))} />}</Field>
                                <Field label="From" errors={errorsAt(fieldErrors, `commitments.${i}.start`)}>
                                    {(props) => <input {...props} type="time" value={c.start} onChange={(e) => update((d) => void (d.commitments[i]!.start = e.target.value))} className={`${INPUT} font-time`} />}
                                </Field>
                                <Field label="Until" hint="May pass midnight." errors={errorsAt(fieldErrors, `commitments.${i}.end`)}>
                                    {(props) => <input {...props} type="time" value={c.end} onChange={(e) => update((d) => void (d.commitments[i]!.end = e.target.value))} className={`${INPUT} font-time`} />}
                                </Field>
                            </div>
                            <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
                                {WEEKDAYS.map((day) => (
                                    <button
                                        key={day}
                                        type="button"
                                        aria-pressed={c.days.includes(day)}
                                        aria-label={WEEKDAY_NAMES[day]}
                                        onClick={() => update((d) => { const list = d.commitments[i]!.days; const at = list.indexOf(day); if (at === -1) list.push(day); else list.splice(at, 1); })}
                                        className="min-h-11 min-w-11 rounded-full border border-control px-3 text-[13px] font-semibold aria-pressed:border-accent aria-pressed:bg-accent-wash aria-pressed:text-accent aria-pressed:before:content-['✓_']"
                                    >
                                        {WEEKDAY_SHORT[day]}
                                    </button>
                                ))}
                                <span className="self-center text-[13px] text-muted">{c.days.length === 0 ? "every day" : ""}</span>
                            </div>
                            {errs.length > 0 && <p className="text-[13px] font-semibold text-bad">{errs.join(" ")}</p>}
                            <Button look="danger" className="self-start" onClick={() => update((d) => void d.commitments.splice(i, 1))}>
                                Remove
                            </Button>
                        </div>
                    );
                })}
                {form.commitments.length < LIMITS.commitments && (
                    <Button className="self-start" onClick={() => update((d) => void d.commitments.push({ label: "", kind: "work", days: [], start: "09:00", end: "17:00" }))}>
                        + Add something
                    </Button>
                )}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-lg font-semibold">Days without study</legend>
                <p className="text-[13px] text-muted">Another exam, a trip, a holiday.</p>
                <div className="flex flex-wrap gap-2">
                    {form.unavailableDates.map((date, i) => (
                        <span key={date} className="inline-flex items-center gap-1 rounded-full bg-sunk py-1 pl-3 pr-1 text-sm">
                            <span className="font-time tabular-nums">{date}</span>
                            <button type="button" aria-label={`Remove ${date}`} onClick={() => update((d) => void d.unavailableDates.splice(i, 1))} className="min-h-9 min-w-9 rounded-full hover:bg-line">
                                ×
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <input aria-label="New date without study" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={`${INPUT} w-auto`} />
                    <Button disabled={!newDate} onClick={() => { update((d) => { if (!d.unavailableDates.includes(newDate)) d.unavailableDates.push(newDate); }); setNewDate(""); }}>
                        Add
                    </Button>
                </div>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-3">
                <legend className="mb-2 text-lg font-semibold">Energy</legend>
                {(["morning", "afternoon", "evening"] as const).map((part) => (
                    <Field key={part} label={{ morning: "In the morning", afternoon: "In the afternoon", evening: "In the evening" }[part]}>
                        {(props) => <Select {...props} value={form.energy[part] ?? ""} options={ENERGY} onChange={(v) => update((d) => void (d.energy[part] = v === "" ? null : v))} />}
                    </Field>
                ))}
            </fieldset>

            {creating ? (
                <div role="status" className="flex flex-col gap-2">
                    <p className="text-muted">Building your schedule… this usually takes under a minute.</p>
                    <Button className="self-start" onClick={() => create.cancel()}>
                        Stop
                    </Button>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" look="primary">
                        Create the schedule
                    </Button>
                    <Button look="quiet" onClick={() => { create.reset(); setStep("describe"); }}>
                        Back to the description
                    </Button>
                </div>
            )}
        </form>
    );
}
