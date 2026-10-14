/**
 * Who is signed in on this device, as far as the server says. No React here.
 *
 * The session itself is a cookie the page cannot read; this holds only what the server answered.
 * `mode` comes from /api/account/status and decides what the screens may say: "off" means there are
 * no accounts on this server at all, and no screen may pretend otherwise; "memory" means they exist
 * but are kept in memory and lost on restart.
 */
import type { ApiClient, ApiFailure } from "../api/client.ts";
import type { AccountUser } from "../api/types.ts";

export type AccountState =
    | { status: "loading" }
    /** The server could not be asked. */
    | { status: "unreachable"; message: string }
    | { status: "off" }
    | { status: "signedOut"; mode: "memory" }
    | { status: "signedIn"; mode: "memory"; user: AccountUser };

export function createAccountStore(api: ApiClient) {
    let state: AccountState = { status: "loading" };
    const listeners = new Set<() => void>();
    const set = (next: AccountState) => {
        state = next;
        for (const listener of listeners) listener();
    };
    let loads = 0;

    async function load(): Promise<void> {
        const mine = ++loads;
        const status = await api.account.status();
        if (mine !== loads) return;
        if (!status.ok) return set({ status: "unreachable", message: status.message });
        if (status.data.accounts === "off") return set({ status: "off" });

        const me = await api.account.me();
        if (mine !== loads) return;
        if (me.ok) return set({ status: "signedIn", mode: "memory", user: me.data.user });
        // 401 is the ordinary "nobody signed in"; anything else is the server failing, not a signed-out person.
        if (me.kind === "unauthenticated") return set({ status: "signedOut", mode: "memory" });
        return set({ status: "unreachable", message: me.message });
    }

    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        load,

        /** Signs in. On success the state is signed in; on failure it is unchanged and the failure is returned. */
        async signIn(email: string, password: string): Promise<{ ok: true } | ApiFailure> {
            const result = await api.account.logIn({ email, password });
            if (!result.ok) return result;
            set({ status: "signedIn", mode: "memory", user: result.data.user });
            return { ok: true };
        },

        async signOut(): Promise<void> {
            await api.account.logOut();
            // Whatever the answer, this device no longer treats the person as signed in.
            set({ status: "signedOut", mode: "memory" });
        },

        /** After an action that may have changed the address's verified state, or ended the session. */
        refresh: load,
    };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
