import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ApiClient } from "../api/client.ts";
import { clockFrom } from "../domain/clock.ts";
import type { Clock } from "../domain/clock.ts";
import type { AccountStore } from "../state/accountStore.ts";
import type { PlanStore, StoreState } from "../state/planStore.ts";
import type { Appearance } from "../settings/appearance.ts";
import type { Repository } from "../storage/repository.ts";

export interface Services {
    api: ApiClient;
    repository: Repository;
    store: PlanStore;
    account: AccountStore;
    appearance: Appearance;
    setAppearance: (next: Appearance) => void;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
    const services = useContext(ServicesContext);
    if (!services) throw new Error("useServices outside the provider");
    return services;
}

/** The plan store's state, re-read whenever it changes. */
export function useStoreState(): StoreState {
    const { store } = useServices();
    return useSyncExternalStore(store.subscribe, store.getState);
}

/** Anything with the shape of a flow in state/flows.ts. */
export function useFlow<T>(flow: { getState(): T; subscribe(listener: () => void): () => void }): T {
    return useSyncExternalStore(flow.subscribe, flow.getState);
}

/** The person's local date and minute, refreshed every 30 seconds so "now" and "late" stay true. */
export function useClock(): Clock {
    const [clock, setClock] = useState(() => clockFrom(new Date()));
    useEffect(() => {
        const tick = () => setClock((previous) => {
            const next = clockFrom(new Date());
            return previous.today === next.today && previous.minutes === next.minutes ? previous : next;
        });
        const id = window.setInterval(tick, 30_000);
        document.addEventListener("visibilitychange", tick);
        return () => {
            window.clearInterval(id);
            document.removeEventListener("visibilitychange", tick);
        };
    }, []);
    return clock;
}
