import { useEffect, useMemo, useState } from "react";
import { createParseFlow, createPlanFlow } from "../state/flows.ts";
import { clockFrom } from "../domain/clock.ts";
import { emptyPlanForm, errorsAt, LIMITS, WEEKDAYS } from "../domain/planForm.ts";
import type { CommitmentDraft, CommitmentKind, Difficulty, Energy, PlanFormState, PlanMode, Weekday } from "../domain/planForm.ts";
import { navigate } from "../router/useRoute.ts";
import { useFlow, useServices, useStoreState } from "../app/services.tsx";
import { Field, INPUT } from "../ui/forms.tsx";
import { AccountRecovery, Button, buttonClass, Link, Notice, ScreenTitle } from "../ui/primitives.tsx";
import type { FieldError } from "../api/types.ts";

const WEEKDAY_NAMES: Record<Weekday, string> = { mon: "E hënë", tue: "E martë", wed: "E mërkurë", thu: "E enjte", fri: "E premte", sat: "E shtunë", sun: "E diel" };
const WEEKDAY_SHORT: Record<Weekday, string> = { mon: "Hën", tue: "Mar", wed: "Mër", thu: "Enj", fri: "Pre", sat: "Sht", sun: "Die" };
const MODES: [PlanMode, string][] = [["general", "I përgjithshëm"], ["exam", "Provim"], ["new_subject", "Lëndë e re"], ["project", "Projekt"], ["assignment", "Detyrë"], ["certification", "Certifikim"], ["skill", "Aftësi"], ["revision", "Përsëritje"]];
const DIFFICULTIES: [Difficulty, string][] = [["easy", "E lehtë"], ["medium", "Mesatare"], ["hard", "E vështirë"]];
const COMMITMENT_KINDS: [CommitmentKind, string][] = [["work", "Punë"], ["school", "Shkollë"], ["commute", "Rrugë"], ["meal", "Ushqim"], ["sleep", "Gjumë"], ["family", "Familje"], ["gym", "Palestër"], ["other", "Tjetër"]];
const ENERGY: [Energy | "", string][] = [["", "—"], ["high", "E lartë"], ["medium", "Mesatare"], ["low", "E ulët"]];

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

    // What the AI read becomes the form, once.
    useEffect(() => {
        if (parseState.status !== "done") return;
        setForm(parseState.result.form);
        setQuestions(parseState.result.questions);
        setStep("check");
        parse.reset();
    }, [parseState, parse]);

    // A created plan: go to it.
    useEffect(() => {
        if (createState.status === "done") navigate({ name: "plan", planId: createState.result.planId });
    }, [createState]);

    const fieldErrors: FieldError[] = createState.status === "failed" && "fields" in createState.failure && createState.failure.fields ? createState.failure.fields : [];
    const at = (path: string) => errorsAt(fieldErrors, path);
    const profile = state.status === "ready" && state.profile ? state.profile : { name: "Nxënës", educationLevel: null };
    const creating = createState.status === "working";

    if (step === "describe") {
        const failure = parseState.status === "failed" ? parseState.failure : null;
        const working = parseState.status === "working";
        return (
            <>
                <ScreenTitle eyebrow="Plan i ri" title="Çfarë ke për të mësuar?" />
                <p className="text-muted">Shkruaje si t'ia tregoje një shoku: lëndën, deri kur, dhe kur je e lirë. Para se ta krijojmë orarin, do ta shohësh çfarë kemi kuptuar dhe mund ta ndreqësh.</p>

                <Field label="Përshkrimi yt" hint="Mos u mërzit për drejtshkrimin.">
                    {(props) => <textarea {...props} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={7} className={`${INPUT} py-2.5`} placeholder="P.sh. Më 30 tetor kam provimin e Matematikës, kapitujt 3 deri 5. Punoj prej 9 deri në 5. Të dielave s'dua me mësu." />}
                </Field>

                {failure && (
                    <Notice look="bad" role="alert" title={failure.message}>
                        <AccountRecovery kind={failure.kind} />
                        {failure.kind !== "invalid" && "retryAfterSeconds" in failure && failure.retryAfterSeconds ? <p className="text-sm">Provo përsëri pas {failure.retryAfterSeconds} sekondash.</p> : null}
                    </Notice>
                )}

                {working ? (
                    <div role="status" className="flex flex-col gap-2">
                        <p className="text-muted">Po e lexojmë përshkrimin… zakonisht merr më pak se një minutë.</p>
                        <Button className="self-start" onClick={() => parse.cancel()}>
                            Ndale
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <Button look="primary" onClick={() => parse.start(text)}>
                            Vazhdo
                        </Button>
                        <Button look="quiet" onClick={() => { setForm(emptyPlanForm(today)); setStep("check"); }}>
                            Më mirë e plotësoj vetë
                        </Button>
                    </div>
                )}
                <p className="text-[13px] text-muted">Teksti që shkruan i dërgohet një shërbimi të jashtëm të inteligjencës artificiale për ta lexuar. Mos shkruaj gjëra që s'do t'i ndaje me të tjerët.</p>
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
            <ScreenTitle eyebrow="Plan i ri" title="A e kemi kuptuar mirë?">
                <p className="text-muted">Ndreqe çfarëdo që s'është ashtu, pastaj krijoje orarin.</p>
            </ScreenTitle>

            {questions.length > 0 && (
                <Notice look="warn" title="AI donte ta dinte:">
                    <ul className="ml-5 list-disc text-sm">
                        {questions.map((q) => (
                            <li key={q}>{q}</li>
                        ))}
                    </ul>
                    <p className="text-[13px]">Përgjigju duke ndryshuar fushat poshtë.</p>
                </Notice>
            )}

            {createState.status === "failed" && fieldErrors.length === 0 && (
                <Notice look="bad" role="alert" title={createState.failure.message}>
                    <AccountRecovery kind={createState.failure.kind} />
                    {"retryAfterSeconds" in createState.failure && createState.failure.retryAfterSeconds ? <p className="text-sm">Provo përsëri pas {createState.failure.retryAfterSeconds} sekondash.</p> : null}
                </Notice>
            )}
            {fieldErrors.length > 0 && (
                <Notice look="bad" role="alert" title="Disa fusha duhen ndrequr">
                    <ul className="ml-5 list-disc text-sm">
                        {fieldErrors.map((e, i) => (
                            <li key={`${e.path}:${i}`}>{e.message}</li>
                        ))}
                    </ul>
                </Notice>
            )}

            <section className="flex flex-col gap-4">
                <Field label="Lënda" errors={at("subject")}>
                    {(props) => <input {...props} type="text" value={form.subject} maxLength={120} onChange={(e) => update((d) => void (d.subject = e.target.value))} className={INPUT} />}
                </Field>
                <Field label="Çfarë mbulon" hint="Kapituj, faqe, tema." errors={at("materialAmount")}>
                    {(props) => <input {...props} type="text" value={form.material} maxLength={200} onChange={(e) => update((d) => void (d.material = e.target.value))} className={INPUT} />}
                </Field>
                <Field label="Çfarë dëshiron të arrish" errors={at("goal")}>
                    {(props) => <input {...props} type="text" value={form.goal} maxLength={300} onChange={(e) => update((d) => void (d.goal = e.target.value))} className={INPUT} />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Lloji i planit">{(props) => <Select {...props} value={form.planMode} options={MODES} onChange={(v) => update((d) => void (d.planMode = v))} />}</Field>
                    <Field label="Vështirësia">{(props) => <Select {...props} value={form.difficulty} options={DIFFICULTIES} onChange={(v) => update((d) => void (d.difficulty = v))} />}</Field>
                    <Field label="Prej" errors={at("startDate")}>
                        {(props) => <input {...props} type="date" value={form.startDate} onChange={(e) => update((d) => void (d.startDate = e.target.value))} className={INPUT} />}
                    </Field>
                    <Field label="Deri" errors={at("endDate")}>
                        {(props) => <input {...props} type="date" value={form.endDate} onChange={(e) => update((d) => void (d.endDate = e.target.value))} className={INPUT} />}
                    </Field>
                    <Field label="Sa zgjat një seancë" hint="Opsionale." errors={at("sessionPreferenceMinutes")}>
                        {(props) => (
                            <select {...props} value={form.sessionMinutes ?? ""} onChange={(e) => update((d) => void (d.sessionMinutes = e.target.value ? Number(e.target.value) : null))} className={INPUT}>
                                <option value="">Sipas planit</option>
                                {[25, 30, 45, 60, 90, 120].map((m) => (
                                    <option key={m} value={m}>
                                        {m} minuta
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>
                </div>
            </section>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-lg font-semibold">Kur je e lirë</legend>
                <p className="text-[13px] text-muted">Për secilën ditë zgjidh: lëre pa caktuar, shëno orët kur mëson, ose shëno pushim. Nëse nuk caktohet asnjë ditë, mund të planifikohet çdo ditë.</p>
                {errorsAt(fieldErrors, "weeklyAvailability").length > 0 && at("weeklyAvailability").map((m) => <p key={m} className="text-[13px] font-semibold text-bad">{m}</p>)}
                {WEEKDAYS.map((day) => {
                    const entry = form.days[day];
                    return (
                        <div key={day} className="flex flex-col gap-2 rounded-m bg-sunk p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold">{WEEKDAY_NAMES[day]}</span>
                                <select
                                    aria-label={`${WEEKDAY_NAMES[day]}: çfarë bëhet`}
                                    value={entry.mode}
                                    onChange={(e) => update((d) => { const mode = e.target.value as "unset" | "free" | "off"; d.days[day].mode = mode; if (mode === "free" && d.days[day].windows.length === 0) d.days[day].windows = [{ start: "17:00", end: "19:00" }]; })}
                                    className={`${INPUT} w-auto`}
                                >
                                    <option value="unset">Pa caktuar</option>
                                    <option value="free">Mësoj</option>
                                    <option value="off">Pushim</option>
                                </select>
                            </div>
                            {entry.mode === "free" && (
                                <div className="flex flex-col gap-2">
                                    {entry.windows.map((w, i) => {
                                        const idx = WEEKDAYS.filter((x) => form.days[x].mode !== "unset").indexOf(day);
                                        const errs = errorsAt(fieldErrors, `weeklyAvailability.${idx}.windows.${i}`);
                                        return (
                                            <div key={i} className="flex flex-wrap items-center gap-2">
                                                <input aria-label={`${WEEKDAY_NAMES[day]}, nga`} aria-invalid={errs.length > 0} type="time" value={w.start} onChange={(e) => update((d) => void (d.days[day].windows[i]!.start = e.target.value))} className={`${INPUT} w-auto font-time`} />
                                                <span aria-hidden="true">–</span>
                                                <input aria-label={`${WEEKDAY_NAMES[day]}, deri`} aria-invalid={errs.length > 0} type="time" value={w.end} onChange={(e) => update((d) => void (d.days[day].windows[i]!.end = e.target.value))} className={`${INPUT} w-auto font-time`} />
                                                <Button look="quiet" aria-label={`Hiqe kohën ${i + 1} të ditës ${WEEKDAY_NAMES[day]}`} onClick={() => update((d) => void d.days[day].windows.splice(i, 1))}>
                                                    Hiqe
                                                </Button>
                                                {errs.length > 0 && <span className="text-[13px] font-semibold text-bad">{errs.join(" ")}</span>}
                                            </div>
                                        );
                                    })}
                                    {entry.windows.length < LIMITS.windowsPerDay && (
                                        <Button look="quiet" className="self-start" onClick={() => update((d) => void d.days[day].windows.push({ start: "20:00", end: "21:00" }))}>
                                            + Shto një kohë
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-lg font-semibold">Kohët kur je e zënë</legend>
                <p className="text-[13px] text-muted">Punë, shkollë, gjumë, rrugë. Seancat nuk vendosen mbi to. Një gjumë 23:00–07:00 supozohet nëse nuk shton tëndin.</p>
                {form.commitments.map((c: CommitmentDraft, i) => {
                    const errs = errorsAt(fieldErrors, `commitments.${i}`);
                    return (
                        <div key={i} className="flex flex-col gap-3 rounded-m bg-sunk p-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Emri" errors={errorsAt(fieldErrors, `commitments.${i}.label`)}>
                                    {(props) => <input {...props} type="text" value={c.label} maxLength={60} onChange={(e) => update((d) => void (d.commitments[i]!.label = e.target.value))} className={INPUT} />}
                                </Field>
                                <Field label="Lloji">{(props) => <Select {...props} value={c.kind} options={COMMITMENT_KINDS} onChange={(v) => update((d) => void (d.commitments[i]!.kind = v))} />}</Field>
                                <Field label="Nga" errors={errorsAt(fieldErrors, `commitments.${i}.start`)}>
                                    {(props) => <input {...props} type="time" value={c.start} onChange={(e) => update((d) => void (d.commitments[i]!.start = e.target.value))} className={`${INPUT} font-time`} />}
                                </Field>
                                <Field label="Deri" hint="Mund të kalojë mesnatën." errors={errorsAt(fieldErrors, `commitments.${i}.end`)}>
                                    {(props) => <input {...props} type="time" value={c.end} onChange={(e) => update((d) => void (d.commitments[i]!.end = e.target.value))} className={`${INPUT} font-time`} />}
                                </Field>
                            </div>
                            <div role="group" aria-label="Ditët" className="flex flex-wrap gap-1.5">
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
                                <span className="self-center text-[13px] text-muted">{c.days.length === 0 ? "çdo ditë" : ""}</span>
                            </div>
                            {errs.length > 0 && <p className="text-[13px] font-semibold text-bad">{errs.join(" ")}</p>}
                            <Button look="danger" className="self-start" onClick={() => update((d) => void d.commitments.splice(i, 1))}>
                                Hiqe
                            </Button>
                        </div>
                    );
                })}
                {form.commitments.length < LIMITS.commitments && (
                    <Button className="self-start" onClick={() => update((d) => void d.commitments.push({ label: "", kind: "work", days: [], start: "09:00", end: "17:00" }))}>
                        + Shto diçka
                    </Button>
                )}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
                <legend className="text-lg font-semibold">Ditë pa mësim</legend>
                <p className="text-[13px] text-muted">Provim tjetër, udhëtim, festë.</p>
                <div className="flex flex-wrap gap-2">
                    {form.unavailableDates.map((date, i) => (
                        <span key={date} className="inline-flex items-center gap-1 rounded-full bg-sunk py-1 pl-3 pr-1 text-sm">
                            <span className="font-time tabular-nums">{date}</span>
                            <button type="button" aria-label={`Hiqe ${date}`} onClick={() => update((d) => void d.unavailableDates.splice(i, 1))} className="min-h-9 min-w-9 rounded-full hover:bg-line">
                                ×
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <input aria-label="Data e re pa mësim" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={`${INPUT} w-auto`} />
                    <Button disabled={!newDate} onClick={() => { update((d) => { if (!d.unavailableDates.includes(newDate)) d.unavailableDates.push(newDate); }); setNewDate(""); }}>
                        Shtoje
                    </Button>
                </div>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-3">
                <legend className="mb-2 text-lg font-semibold">Energjia</legend>
                {(["morning", "afternoon", "evening"] as const).map((part) => (
                    <Field key={part} label={{ morning: "Në mëngjes", afternoon: "Pasdite", evening: "Në mbrëmje" }[part]}>
                        {(props) => <Select {...props} value={form.energy[part] ?? ""} options={ENERGY} onChange={(v) => update((d) => void (d.energy[part] = v === "" ? null : v))} />}
                    </Field>
                ))}
            </fieldset>

            {creating ? (
                <div role="status" className="flex flex-col gap-2">
                    <p className="text-muted">Po e ndërtojmë orarin… zakonisht merr më pak se një minutë.</p>
                    <Button className="self-start" onClick={() => create.cancel()}>
                        Ndale
                    </Button>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" look="primary">
                        Krijo orarin
                    </Button>
                    <Button look="quiet" onClick={() => { create.reset(); setStep("describe"); }}>
                        Kthehu te përshkrimi
                    </Button>
                </div>
            )}
        </form>
    );
}
