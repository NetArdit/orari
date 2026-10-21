import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ApiFailure } from "../api/client.ts";
import { useServices } from "../app/services.tsx";
import { navigate } from "../router/useRoute.ts";
import { Field, INPUT } from "../ui/forms.tsx";
import { Button, buttonClass, Link, Notice, ScreenTitle } from "../ui/primitives.tsx";

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
            <Notice look="warn" title="Accounts are not enabled on this server">
                <p className="text-sm">Orari works without an account, with your plan stored on this device only. Signing in and signing up work once the server has real storage and e-mail.</p>
            </Notice>
        );
    }
    if (state.status === "unreachable") {
        return (
            <Notice look="bad" role="alert" title="The server could not be reached">
                <p className="text-sm">{state.message}</p>
            </Notice>
        );
    }
    if ((state.status === "signedOut" || state.status === "signedIn") && state.mode === "memory") {
        return (
            <Notice look="warn" title="Demo version">
                <p className="text-sm">Accounts are kept in the server's memory only and are lost whenever it restarts. Do not use the password of a real account.</p>
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
            <ScreenTitle title="Sign in" />
            <ModeNotice />
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {failure && (
                    <Notice look="bad" role="alert" title={messageOf(failure)}>
                        {failure.retryAfterSeconds ? <p className="text-sm">Try again in {failure.retryAfterSeconds} seconds.</p> : null}
                    </Notice>
                )}
                <Field label="E-mail">{(props) => <input {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />}</Field>
                <Field label="Password">
                    {(props) => <input {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />}
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" look="primary" disabled={working || accountsOff(state) || !email || !password}>
                        {working ? "Signing in…" : "Sign in"}
                    </Button>
                    <Link to={{ name: "forgot" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                        Forgot your password?
                    </Link>
                </div>
            </form>
            <p className="text-muted">
                No account yet?{" "}
                <Link to={{ name: "signUp" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Sign up
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
                <ScreenTitle title="Check your e-mail" />
                <Notice look="ok" role="status" title="We sent you a confirmation link">
                    <p className="text-sm">
                        If {form.email} is new to us, you will find a link there to confirm it. If it already has an account, you will get a different message instead. The link is valid for 24 hours.
                    </p>
                </Notice>
                <p className="text-muted">You can sign in now, but the AI opens only after you confirm your e-mail.</p>
                <Link to={{ name: "signIn" }} className={buttonClass("primary", "self-start")}>
                    Sign in
                </Link>
            </>
        );
    }

    const field = fieldFor(failure?.code);
    const errorFor = (name: ReturnType<typeof fieldFor>) => (failure && field === name ? [messageOf(failure)] : undefined);
    const generic = failure && field === null;

    return (
        <>
            <ScreenTitle title="Sign up" />
            <ModeNotice />
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {generic && (
                    <Notice look="bad" role="alert" title={messageOf(failure)}>
                        {failure.retryAfterSeconds ? <p className="text-sm">Try again in {failure.retryAfterSeconds} seconds.</p> : null}
                    </Notice>
                )}
                <Field label="Name" errors={errorFor("name")}>
                    {(props) => <input {...props} type="text" autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />}
                </Field>
                <Field label="E-mail" errors={errorFor("email")}>
                    {(props) => <input {...props} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />}
                </Field>
                <Field label="Password" hint="At least 8 characters. A long sentence you can remember is better than a strange word." errors={errorFor("password")}>
                    {(props) => <input {...props} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={INPUT} />}
                </Field>
                <p className="text-[13px] text-muted">
                    Before accepting it, we check the password against an outside service (Have I Been Pwned) to see whether it has appeared in a data leak. Only the first 5 characters of a code derived from it are sent, never the password itself.
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
                        <span>I declare that I am 16 years old or older.</span>
                    </label>
                    {field === "age" && failure && <p className="text-[13px] font-semibold text-bad">{messageOf(failure)}</p>}
                </div>
                <p className="text-[13px] text-muted">The text you give the AI for a plan is sent to an outside AI provider. Do not write anything you would not share with others.</p>
                <Button type="submit" look="primary" className="self-start" disabled={working || accountsOff(state)}>
                    {working ? "Creating…" : "Create account"}
                </Button>
            </form>
            <p className="text-muted">
                Already have an account?{" "}
                <Link to={{ name: "signIn" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Sign in
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
            <ScreenTitle title="Forgot password" />
            <ModeNotice />
            {sent ? (
                <Notice look="ok" role="status" title="Check your e-mail">
                    <p className="text-sm">If there is an account with this address, you will receive a link to set a new password. The link is valid for 30 minutes and works only once.</p>
                </Notice>
            ) : (
                <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                    {failure && <Notice look="bad" role="alert" title={messageOf(failure)} />}
                    <Field label="Account e-mail">{(props) => <input {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />}</Field>
                    <Button type="submit" look="primary" className="self-start" disabled={working || accountsOff(state) || !email}>
                        {working ? "Sending…" : "Send the link"}
                    </Button>
                </form>
            )}
            <Link to={{ name: "signIn" }} className="font-semibold text-accent underline-offset-2 hover:underline">
                Back to sign in
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
                <ScreenTitle title="New password" />
                <Notice look="bad" title="This link is incomplete">
                    <p className="text-sm">Open the link exactly as it arrived in your e-mail, or ask for a new one.</p>
                </Notice>
                <Link to={{ name: "forgot" }} className={buttonClass("secondary", "self-start")}>
                    Ask for a new link
                </Link>
            </>
        );
    }

    if (done) {
        return (
            <>
                <ScreenTitle title="Password changed" />
                <Notice look="ok" role="status" title="Sign in with your new password">
                    <p className="text-sm">For safety, every other device was signed out. We did not sign you in: sign in now with your new password.</p>
                </Notice>
                <Link to={{ name: "signIn" }} className={buttonClass("primary", "self-start")}>
                    Sign in
                </Link>
            </>
        );
    }

    const field = fieldFor(failure?.code);
    return (
        <>
            <ScreenTitle title="New password" />
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {failure && field === null && (
                    <Notice look="bad" role="alert" title={messageOf(failure)}>
                        {failure.code === "TOKEN_INVALID" && (
                            <Link to={{ name: "forgot" }} className="font-semibold underline">
                                Ask for a new link
                            </Link>
                        )}
                    </Notice>
                )}
                <Field label="New password" hint="At least 8 characters." errors={failure && field === "password" ? [messageOf(failure)] : undefined}>
                    {(props) => <input {...props} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />}
                </Field>
                <Field label="Repeat it" errors={mismatch ? ["The two passwords are not the same."] : undefined}>
                    {(props) => <input {...props} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={INPUT} />}
                </Field>
                <p className="text-[13px] text-muted">We check the password against an outside leak-checking service; only 5 characters of a derived code are sent.</p>
                <Button type="submit" look="primary" className="self-start" disabled={working || !password || mismatch}>
                    {working ? "Saving…" : "Set the password"}
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
            <ScreenTitle title="Confirm e-mail" />
            {status === "working" && <p role="status" className="text-muted">Confirming…</p>}
            {status === "done" && (
                <>
                    <Notice look="ok" role="status" title="E-mail confirmed">
                        <p className="text-sm">The AI is now open for your account.</p>
                    </Notice>
                    <Link to={{ name: "today" }} className={buttonClass("primary", "self-start")}>
                        Continue
                    </Link>
                </>
            )}
            {(status === "failed" || status === "missing") && (
                <>
                    <Notice look="bad" role="alert" title={failure ? messageOf(failure) : "This link is incomplete."}>
                        <p className="text-sm">Sign in and ask for a new link from your account settings.</p>
                    </Notice>
                    <Link to={{ name: "signIn" }} className={buttonClass("secondary", "self-start")}>
                        Sign in
                    </Link>
                </>
            )}
        </>
    );
}

/** One editable part of the account: shows its own result, never someone else's. */
type Outcome = { kind: "ok" | "bad"; text: string } | null;

function ResultLine({ outcome }: { outcome: Outcome }) {
    if (!outcome) return null;
    return (
        <p role={outcome.kind === "bad" ? "alert" : "status"} className={`text-sm font-semibold ${outcome.kind === "bad" ? "text-bad" : "text-ok"}`}>
            {outcome.text}
        </p>
    );
}

function NameForm({ initial }: { initial: string }) {
    const { api, account } = useServices();
    const [name, setName] = useState(initial);
    const [working, setWorking] = useState(false);
    const [outcome, setOutcome] = useState<Outcome>(null);

    useEffect(() => setName(initial), [initial]);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working) return;
        setWorking(true);
        setOutcome(null);
        const result = await api.account.updateName(name);
        setWorking(false);
        if (result.ok) {
            setOutcome({ kind: "ok", text: "Name saved." });
            void account.refresh();
        } else setOutcome({ kind: "bad", text: result.message });
    };

    return (
        <form onSubmit={save} className="flex flex-col gap-3" noValidate>
            <Field label="Name">{(props) => <input {...props} type="text" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />}</Field>
            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" look="primary" disabled={working || name.trim() === "" || name.trim() === initial}>
                    {working ? "Saving…" : "Save name"}
                </Button>
                <ResultLine outcome={outcome} />
            </div>
        </form>
    );
}

function EmailForm({ current }: { current: string }) {
    const { api } = useServices();
    const [newEmail, setNewEmail] = useState("");
    const [password, setPassword] = useState("");
    const [working, setWorking] = useState(false);
    const [outcome, setOutcome] = useState<Outcome>(null);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working) return;
        setWorking(true);
        setOutcome(null);
        const result = await api.account.changeEmail({ newEmail, currentPassword: password });
        setWorking(false);
        setPassword("");
        if (result.ok) {
            setOutcome({ kind: "ok", text: `We sent a confirmation link to ${newEmail.trim()}. Your e-mail changes when you open it.` });
            setNewEmail("");
        } else setOutcome({ kind: "bad", text: result.message });
    };

    return (
        <form onSubmit={save} className="flex flex-col gap-3" noValidate>
            <p className="text-[13px] text-muted">Current e-mail: {current}</p>
            <Field label="New e-mail">{(props) => <input {...props} type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={INPUT} />}</Field>
            <Field label="Your password" hint="Needed to change the e-mail.">
                {(props) => <input {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" look="primary" disabled={working || !newEmail || !password}>
                    {working ? "Sending…" : "Change e-mail"}
                </Button>
                <ResultLine outcome={outcome} />
            </div>
        </form>
    );
}

function PasswordForm() {
    const { api } = useServices();
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [again, setAgain] = useState("");
    const [working, setWorking] = useState(false);
    const [outcome, setOutcome] = useState<Outcome>(null);
    const mismatch = again !== "" && next !== again;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (working || mismatch) return;
        setWorking(true);
        setOutcome(null);
        const result = await api.account.changePassword({ currentPassword: current, newPassword: next });
        setWorking(false);
        setCurrent("");
        if (result.ok) {
            setNext("");
            setAgain("");
            setOutcome({ kind: "ok", text: "Password changed. Your other devices were signed out." });
        } else setOutcome({ kind: "bad", text: result.message });
    };

    return (
        <form onSubmit={save} className="flex flex-col gap-3" noValidate>
            <Field label="Current password">
                {(props) => <input {...props} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={INPUT} />}
            </Field>
            <Field label="New password" hint="At least 8 characters.">
                {(props) => <input {...props} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={INPUT} />}
            </Field>
            <Field label="Repeat the new password" errors={mismatch ? ["The two passwords are not the same."] : undefined}>
                {(props) => <input {...props} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={INPUT} />}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" look="primary" disabled={working || !current || !next || mismatch}>
                    {working ? "Saving…" : "Change password"}
                </Button>
                <ResultLine outcome={outcome} />
            </div>
        </form>
    );
}

/** The account part of the settings screen: who you are, and the three things that can be changed. */
export function AccountPanel() {
    const { api } = useServices();
    const state = useAccountState();
    const [resent, setResent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (state.status === "loading") return null;

    return (
        <section aria-label="Account" className="flex flex-col gap-3">
            <ModeNotice />
            {state.status === "signedOut" && (
                <div className="flex flex-wrap gap-2">
                    <Link to={{ name: "signIn" }} className={buttonClass("primary")}>
                        Sign in
                    </Link>
                    <Link to={{ name: "signUp" }} className={buttonClass("secondary")}>
                        Sign up
                    </Link>
                </div>
            )}
            {state.status === "signedIn" && (
                <>
                    <div className="flex items-center gap-3 rounded-m bg-sunk p-4" data-testid="account-summary">
                        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-lg font-bold text-on-accent">{state.user.name.trim().charAt(0).toUpperCase() || "?"}</span>
                        <p className="min-w-0">
                            <span className="block truncate font-semibold">{state.user.name}</span>
                            <span className="block truncate text-sm text-muted">{state.user.email}</span>
                        </p>
                    </div>
                    {!state.user.emailVerified && (
                        <Notice look="warn" title="Your e-mail is not confirmed">
                            <p className="text-sm">The AI opens once you confirm it.</p>
                            {resent ? (
                                <p role="status" className="text-sm font-semibold">We sent you a new link.</p>
                            ) : (
                                <Button className="self-start" onClick={() => void api.account.resendVerification().then((r) => (r.ok ? setResent(true) : setError(r.message)))}>
                                    Send the link again
                                </Button>
                            )}
                        </Notice>
                    )}
                    {error && <p role="alert" className="text-sm font-semibold text-bad">{error}</p>}

                    <details className="group rounded-m border border-line bg-raised" data-testid="account-name">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 font-semibold">
                            <span>Name<span className="block text-[13px] font-normal text-muted">Shown on your account</span></span>
                            <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">⌄</span>
                        </summary>
                        <div className="border-t border-line p-4">
                            <NameForm initial={state.user.name} />
                        </div>
                    </details>
                    <details className="group rounded-m border border-line bg-raised" data-testid="account-email">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 font-semibold">
                            <span>E-mail<span className="block text-[13px] font-normal text-muted">{state.user.email}</span></span>
                            <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">⌄</span>
                        </summary>
                        <div className="border-t border-line p-4">
                            <EmailForm current={state.user.email} />
                        </div>
                    </details>
                    <details className="group rounded-m border border-line bg-raised" data-testid="account-password">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 font-semibold">
                            <span>Password<span className="block text-[13px] font-normal text-muted">Change it, other devices are signed out</span></span>
                            <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">⌄</span>
                        </summary>
                        <div className="border-t border-line p-4">
                            <PasswordForm />
                        </div>
                    </details>
                </>
            )}
        </section>
    );
}

/** The last thing on the settings screen: red, white text. Not shown when nobody is signed in. */
export function LogOutButton() {
    const { account } = useServices();
    const state = useAccountState();
    if (state.status !== "signedIn") return null;
    return (
        <button
            type="button"
            onClick={() => void account.signOut()}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-m bg-[#b42318] px-5 font-semibold text-white hover:bg-[#912018] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#b42318] sm:self-start"
        >
            Log out
        </button>
    );
}
