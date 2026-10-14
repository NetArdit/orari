import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ApiFailure } from "../api/client.ts";
import type { AccountSession } from "../api/types.ts";
import { useServices } from "../app/services.tsx";
import { navigate } from "../router/useRoute.ts";
import { Field, INPUT } from "../ui/forms.tsx";
import { Button, buttonClass, Link, Notice, ScreenTitle } from "../ui/primitives.tsx";
import { shortDate } from "../ui/text.ts";
import { downloadPlans, uploadPlans } from "../state/accountSync.ts";

/** The server's own message for a failure, or ours if it sent none. */
const messageOf = (failure: ApiFailure) => failure.message;

/** Which form field an error code belongs to, so the message appears next to it. */
function fieldFor(code: string | undefined): "email" | "name" | "password" | "age" | null {
    switch (code) {
        case "EMAIL_INVALID":
            return "email";
        case "NAME_INVALID":
            return "name";
        case "AGE_NOT_CONFIRMED":
            return "age";
        case "PASSWORD_TOO_SHORT":
        case "PASSWORD_TOO_LONG":
        case "PASSWORD_INVALID":
        case "PASSWORD_COMPROMISED":
        case "PASSWORD_CHECK_UNAVAILABLE":
            return "password";
        default:
            return null;
    }
}

export function useAccountState() {
    const { account } = useServices();
    return useSyncExternalStore(account.subscribe, account.getState);
}

/** Shown on every account screen: what kind of accounts these are, or that there are none. Never a fake success. */
function ModeNotice() {
    const state = useAccountState();
    if (state.status === "off") {
        return (
            <Notice look="warn" title="Llogaritë nuk janë aktivizuar në këtë server">
                <p className="text-sm">Orari funksionon pa llogari, me planin e ruajtur vetëm në këtë pajisje. Hyrja dhe regjistrimi do të punojnë kur serveri të ketë ruajtje të vërtetë dhe dërgim email-i.</p>
            </Notice>
        );
    }
    if (state.status === "unreachable") {
        return (
            <Notice look="bad" role="alert" title="Serveri nuk u kontaktua">
                <p className="text-sm">{state.message}</p>
            </Notice>
        );
    }
    if ((state.status === "signedOut" || state.status === "signedIn") && state.mode === "memory") {
        return (
            <Notice look="warn" title="Version demo">
                <p className="text-sm">Llogaritë ruhen vetëm në kujtesën e serverit dhe humbasin sa herë që ai riniset. Mos përdor fjalëkalimin e një llogarie të vërtetë.</p>
            </Notice>
        );
    }
    return null;
}

const accountsOff = (state: ReturnType<typeof useAccountState>) => state.status === "off" || state.status === "unreachable" || state.status === "loading";

export function SignInScreen() {
    const { account } = useServices();
    const state = useAccountState();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [working, setWorking] = useState(false);
    const [failure, setFailure] = useState<ApiFailure | null>(null);

    useEffect(() => {
        if (state.status === "signedIn") navigate({ name: "me" });
    }, [state.status]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working) return;
        setWorking(true);
        setFailure(null);
        const result = await account.signIn(email, password);
        setWorking(false);
        if (!result.ok) {
            setFailure(result);
            setPassword("");
        }
    };

    return (
        <>
            <ScreenTitle title="Hyr" />
            <ModeNotice />
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {failure && (
                    <Notice look="bad" role="alert" title={messageOf(failure)}>
                        {failure.retryAfterSeconds ? <p className="text-sm">Provo përsëri pas {failure.retryAfterSeconds} sekondash.</p> : null}
                    </Notice>
                )}
                <Field label="Email">{(props) => <input {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />}</Field>
                <Field label="Fjalëkalimi">
                    {(props) => <input {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />}
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" look="primary" disabled={working || accountsOff(state) || !email || !password}>
                        {working ? "Po hyj…" : "Hyr"}
                    </Button>
                    <Link to={{ name: "forgot" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                        E harrova fjalëkalimin
                    </Link>
                </div>
            </form>
            <p className="text-muted">
                Nuk ke llogari?{" "}
                <Link to={{ name: "signUp" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Regjistrohu
                </Link>
            </p>
        </>
    );
}

export function SignUpScreen() {
    const { api } = useServices();
    const state = useAccountState();
    const [form, setForm] = useState({ name: "", email: "", password: "", confirmsAge16: false });
    const [working, setWorking] = useState(false);
    const [failure, setFailure] = useState<ApiFailure | null>(null);
    const [done, setDone] = useState(false);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working) return;
        setWorking(true);
        setFailure(null);
        const result = await api.account.signUp(form);
        setWorking(false);
        if (result.ok) setDone(true);
        else setFailure(result);
    };

    if (done) {
        return (
            <>
                <ScreenTitle title="Kontrollo email-in" />
                <Notice look="ok" role="status" title="Të dërguam një lidhje konfirmimi">
                    <p className="text-sm">
                        Nëse adresa {form.email} është e re, aty do të gjesh një lidhje për ta konfirmuar. Nëse ke tashmë një llogari me të, do të marrësh një njoftim tjetër. Lidhja vlen 24 orë.
                    </p>
                </Notice>
                <p className="text-muted">Mund të hysh që tani, por sinkronizimi dhe AI hapen vetëm pasi ta konfirmosh email-in.</p>
                <Link to={{ name: "signIn" }} className={buttonClass("primary", "self-start")}>
                    Hyr
                </Link>
            </>
        );
    }

    const field = fieldFor(failure?.code);
    const errorFor = (name: ReturnType<typeof fieldFor>) => (failure && field === name ? [messageOf(failure)] : undefined);
    const generic = failure && field === null;

    return (
        <>
            <ScreenTitle title="Regjistrohu" />
            <ModeNotice />
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {generic && (
                    <Notice look="bad" role="alert" title={messageOf(failure)}>
                        {failure.retryAfterSeconds ? <p className="text-sm">Provo përsëri pas {failure.retryAfterSeconds} sekondash.</p> : null}
                    </Notice>
                )}
                <Field label="Emri" errors={errorFor("name")}>
                    {(props) => <input {...props} type="text" autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />}
                </Field>
                <Field label="Email" errors={errorFor("email")}>
                    {(props) => <input {...props} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />}
                </Field>
                <Field
                    label="Fjalëkalimi"
                    hint="Të paktën 8 shkronja. Një fjali e gjatë që e mban mend është më e mirë se një fjalë e çuditshme."
                    errors={errorFor("password")}
                >
                    {(props) => <input {...props} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={INPUT} />}
                </Field>
                <p className="text-[13px] text-muted">
                    Para se ta pranojmë, e kontrollojmë fjalëkalimin te një shërbim i jashtëm (Have I Been Pwned) për të parë nëse ka dalë në rrjedhje të dhënash. Dërgohen vetëm 5 shkronjat e para të një kodi të derivuar prej tij, jo vetë fjalëkalimi.
                </p>
                <div className="flex flex-col gap-1.5">
                    <label className="flex min-h-11 items-start gap-3">
                        <input
                            type="checkbox"
                            checked={form.confirmsAge16}
                            onChange={(e) => setForm({ ...form, confirmsAge16: e.target.checked })}
                            aria-invalid={field === "age"}
                            className="mt-1 size-5 accent-[var(--accent)]"
                        />
                        <span>Deklaroj se jam 16 vjeç ose më shumë.</span>
                    </label>
                    {field === "age" && failure && <p className="text-[13px] font-semibold text-bad">{messageOf(failure)}</p>}
                </div>
                <p className="text-[13px] text-muted">Teksti që i jep AI-t për një plan i dërgohet një ofruesi të jashtëm të inteligjencës artificiale. Mos shkruaj gjëra që s'do t'i ndaje me të tjerët.</p>
                <Button type="submit" look="primary" className="self-start" disabled={working || accountsOff(state)}>
                    {working ? "Po krijohet…" : "Krijo llogarinë"}
                </Button>
            </form>
            <p className="text-muted">
                Ke tashmë llogari?{" "}
                <Link to={{ name: "signIn" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Hyr
                </Link>
            </p>
        </>
    );
}

export function ForgotScreen() {
    const { api } = useServices();
    const state = useAccountState();
    const [email, setEmail] = useState("");
    const [working, setWorking] = useState(false);
    const [failure, setFailure] = useState<ApiFailure | null>(null);
    const [sent, setSent] = useState(false);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working) return;
        setWorking(true);
        setFailure(null);
        const result = await api.account.forgotPassword(email);
        setWorking(false);
        if (result.ok) setSent(true);
        else setFailure(result);
    };

    return (
        <>
            <ScreenTitle title="Fjalëkalim i harruar" />
            <ModeNotice />
            {sent ? (
                <Notice look="ok" role="status" title="Kontrollo email-in">
                    <p className="text-sm">Nëse ka një llogari me këtë adresë, do të marrësh një lidhje për të vendosur fjalëkalim të ri. Lidhja vlen 30 minuta dhe përdoret vetëm një herë.</p>
                </Notice>
            ) : (
                <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                    {failure && <Notice look="bad" role="alert" title={messageOf(failure)} />}
                    <Field label="Email-i i llogarisë">{(props) => <input {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />}</Field>
                    <Button type="submit" look="primary" className="self-start" disabled={working || accountsOff(state) || !email}>
                        {working ? "Po dërgohet…" : "Dërgo lidhjen"}
                    </Button>
                </form>
            )}
            <Link to={{ name: "signIn" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                Kthehu te hyrja
            </Link>
        </>
    );
}

/** The token is in the URL fragment, which the browser does not send to the server and does not pass on in Referer. */
const tokenFromHash = () => new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";

export function ResetScreen() {
    const { api } = useServices();
    const [password, setPassword] = useState("");
    const [again, setAgain] = useState("");
    const [working, setWorking] = useState(false);
    const [failure, setFailure] = useState<ApiFailure | null>(null);
    const [done, setDone] = useState(false);
    const token = useRef(tokenFromHash());

    useEffect(() => {
        // The address is not needed again, and a link left in the history would be a reusable secret until it expires.
        if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    }, []);

    const mismatch = again !== "" && password !== again;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working || mismatch) return;
        setWorking(true);
        setFailure(null);
        const result = await api.account.resetPassword({ token: token.current, newPassword: password });
        setWorking(false);
        if (result.ok) setDone(true);
        else setFailure(result);
    };

    if (!token.current && !done) {
        return (
            <>
                <ScreenTitle title="Fjalëkalim i ri" />
                <Notice look="bad" title="Kjo lidhje nuk është e plotë">
                    <p className="text-sm">Hape lidhjen siç të erdhi në email, ose kërko një të re.</p>
                </Notice>
                <Link to={{ name: "forgot" }} className={buttonClass("secondary", "self-start")}>
                    Kërko lidhje të re
                </Link>
            </>
        );
    }

    if (done) {
        return (
            <>
                <ScreenTitle title="Fjalëkalimi u ndryshua" />
                <Notice look="ok" role="status" title="Hyr me fjalëkalimin e ri">
                    <p className="text-sm">Për siguri, të gjitha pajisjet e tjera u shkëputën. Nuk të futëm vetë: hyr tani me fjalëkalimin e ri.</p>
                </Notice>
                <Link to={{ name: "signIn" }} className={buttonClass("primary", "self-start")}>
                    Hyr
                </Link>
            </>
        );
    }

    const field = fieldFor(failure?.code);
    return (
        <>
            <ScreenTitle title="Fjalëkalim i ri" />
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {failure && field === null && (
                    <Notice look="bad" role="alert" title={messageOf(failure)}>
                        {failure.code === "TOKEN_INVALID" && (
                            <Link to={{ name: "forgot" }} className="font-semibold underline">
                                Kërko lidhje të re
                            </Link>
                        )}
                    </Notice>
                )}
                <Field label="Fjalëkalimi i ri" hint="Të paktën 8 shkronja." errors={failure && field === "password" ? [messageOf(failure)] : undefined}>
                    {(props) => <input {...props} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />}
                </Field>
                <Field label="Shkruaje përsëri" errors={mismatch ? ["Dy fjalëkalimet nuk janë njësoj."] : undefined}>
                    {(props) => <input {...props} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={INPUT} />}
                </Field>
                <p className="text-[13px] text-muted">E kontrollojmë fjalëkalimin te një shërbim i jashtëm për rrjedhje të dhënash; dërgohen vetëm 5 shkronja të një kodi të derivuar.</p>
                <Button type="submit" look="primary" className="self-start" disabled={working || !password || mismatch}>
                    {working ? "Po ruhet…" : "Vendose fjalëkalimin"}
                </Button>
            </form>
        </>
    );
}

export function VerifyScreen() {
    const { api, account } = useServices();
    const [status, setStatus] = useState<"working" | "done" | "failed" | "missing">("working");
    const [failure, setFailure] = useState<ApiFailure | null>(null);
    const started = useRef(false);

    useEffect(() => {
        // The link works once. React runs effects twice in development; the second run must not use it again.
        if (started.current) return;
        started.current = true;
        const token = tokenFromHash();
        if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
        if (!token) return setStatus("missing");
        void api.account.verify(token).then((result) => {
            if (result.ok) {
                setStatus("done");
                void account.refresh();
            } else {
                setFailure(result);
                setStatus("failed");
            }
        });
    }, [api, account]);

    return (
        <>
            <ScreenTitle title="Konfirmo email-in" />
            {status === "working" && <p role="status" className="text-muted">Po e konfirmojmë…</p>}
            {status === "done" && (
                <>
                    <Notice look="ok" role="status" title="Email-i u konfirmua">
                        <p className="text-sm">Sinkronizimi dhe AI tani janë të hapura për llogarinë tënde.</p>
                    </Notice>
                    <Link to={{ name: "today" }} className={buttonClass("primary", "self-start")}>
                        Vazhdo
                    </Link>
                </>
            )}
            {(status === "failed" || status === "missing") && (
                <>
                    <Notice look="bad" role="alert" title={failure ? messageOf(failure) : "Kjo lidhje nuk është e plotë."}>
                        <p className="text-sm">Hyr dhe kërko një lidhje të re nga cilësimet e llogarisë.</p>
                    </Notice>
                    <Link to={{ name: "signIn" }} className={buttonClass("secondary", "self-start")}>
                        Hyr
                    </Link>
                </>
            )}
        </>
    );
}

/** The account part of the settings screen. */
export function AccountPanel() {
    const { api, account } = useServices();
    const state = useAccountState();
    const [sessions, setSessions] = useState<AccountSession[] | null>(null);
    const [resent, setResent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncNote, setSyncNote] = useState<string | null>(null);
    const { store } = useServices();

    async function runSync(direction: "up" | "down") {
        setSyncing(true);
        setSyncNote(null);
        const current = store.getState();
        const local = current.status === "ready" ? current.plans : [];
        if (direction === "up") {
            const outcome = await uploadPlans(api, local);
            setSyncNote(outcome.ok ? `U dërguan ${outcome.report.sent} plane. Ishin tashmë në llogari: ${outcome.report.alreadyThere}.${outcome.report.failed ? ` Nuk u dërguan: ${outcome.report.failed}.` : ""}` : outcome.message);
        } else {
            const outcome = await downloadPlans(api, new Set(local.map((p) => p.id)), (plan) => store.addPlan(plan));
            setSyncNote(outcome.ok ? `U shtuan ${outcome.report.added} plane në këtë pajisje. Ishin tashmë këtu: ${outcome.report.alreadyHere}.${outcome.report.unreadable ? ` Nuk u lexuan: ${outcome.report.unreadable}.` : ""}` : outcome.message);
        }
        setSyncing(false);
    }

    useEffect(() => {
        if (state.status !== "signedIn") return setSessions(null);
        let cancelled = false;
        void api.account.sessions().then((r) => {
            if (!cancelled && r.ok) setSessions(r.data.sessions);
        });
        return () => {
            cancelled = true;
        };
    }, [api, state.status]);

    if (state.status === "loading") return null;

    return (
        <section aria-label="Llogaria" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Llogaria</h2>
            <ModeNotice />
            {state.status === "signedOut" && (
                <div className="flex flex-wrap gap-2">
                    <Link to={{ name: "signIn" }} className={buttonClass("primary")}>
                        Hyr
                    </Link>
                    <Link to={{ name: "signUp" }} className={buttonClass("secondary")}>
                        Regjistrohu
                    </Link>
                </div>
            )}
            {state.status === "signedIn" && (
                <>
                    <p>
                        <span className="font-semibold">{state.user.name}</span> · <span className="text-muted">{state.user.email}</span>
                    </p>
                    {!state.user.emailVerified && (
                        <Notice look="warn" title="Email-i nuk është konfirmuar">
                            <p className="text-sm">Sinkronizimi dhe AI hapen pasi ta konfirmosh.</p>
                            {resent ? (
                                <p role="status" className="text-sm font-semibold">Të dërguam një lidhje të re.</p>
                            ) : (
                                <Button className="self-start" onClick={() => void api.account.resendVerification().then((r) => (r.ok ? setResent(true) : setError(r.message)))}>
                                    Dërgo lidhjen përsëri
                                </Button>
                            )}
                        </Notice>
                    )}
                    {error && <p role="alert" className="text-sm font-semibold text-bad">{error}</p>}

                    {state.user.emailVerified && (
                        <div className="flex flex-col gap-2" data-testid="sync">
                            <h3 className="text-base font-semibold">Planet mes pajisjeve</h3>
                            <p className="text-[13px] text-muted">{state.mode === "memory" ? "Vetëm kur e kërkon ti. Asnjë plan nuk fshihet apo mbishkruhet. Në këtë version demonstrues llogaria harrohet kur ndalet serveri, ndaj kopja e vërtetë mbetet në këtë pajisje." : "Vetëm kur e kërkon ti. Asnjë plan nuk fshihet apo mbishkruhet: planet e kësaj pajisjeje dërgohen në llogari ose merren prej saj."}</p>
                            <div className="flex flex-wrap gap-2">
                                <Button disabled={syncing} onClick={() => void runSync("up")}>Dërgo planet e kësaj pajisjeje</Button>
                                <Button disabled={syncing} onClick={() => void runSync("down")}>Merr planet nga llogaria</Button>
                            </div>
                            {syncNote && <p role="status" className="text-sm font-semibold">{syncNote}</p>}
                        </div>
                    )}

                    {sessions && (
                        <div className="flex flex-col gap-2">
                            <h3 className="text-base font-semibold">Pajisjet ku je i/e kyçur</h3>
                            <ul className="flex flex-col gap-2">
                                {sessions.map((s) => (
                                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-m bg-sunk p-3">
                                        <span>
                                            {s.device || "Pajisje e panjohur"}
                                            {s.current ? " (kjo)" : ""}
                                            <span className="block text-[13px] text-muted">hyrë më {shortDate(s.createdAt.slice(0, 10))}</span>
                                        </span>
                                        {!s.current && (
                                            <Button look="danger" onClick={() => void api.account.revokeSession(s.id).then(() => api.account.sessions()).then((r) => r.ok && setSessions(r.data.sessions))}>
                                                Shkëpute
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <Button className="self-start" onClick={() => void account.signOut()}>
                        Dil
                    </Button>
                </>
            )}
        </section>
    );
}
