/**
 * Connecting to PostgreSQL and preparing the schema. This is the only place that knows about the `pg` package.
 *
 * DATABASE_URL is the connection string of the provider (Neon, Supabase, ...). Hosted providers require TLS;
 * a local database (127.0.0.1 / localhost) is used without TLS.
 */
import pg from "pg";
import { SCHEMA_SQL } from "./schemaSql.js";

export { SCHEMA_SQL };

/** @param {{connectionString: string, max?: number}} options */
export function createPool({ connectionString, max = 5 }) {
    if (typeof connectionString !== "string" || !connectionString.startsWith("postgres")) {
        throw new Error("DATABASE_URL must be a postgres:// connection string.");
    }
    let url;
    try {
        url = new URL(connectionString);
    } catch {
        throw new Error("DATABASE_URL is not a valid connection string.");
    }
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    // TLS is decided here, not by the URL: a sslmode that weakens verification is refused, and the parameters
    // that would override the explicit setting are removed before the string reaches the driver.
    const mode = url.searchParams.get("sslmode");
    if (!local && mode && ["disable", "allow", "prefer", "no-verify"].includes(mode)) {
        throw new Error("DATABASE_URL: sslmode=" + mode + " is refused; the connection must be verified TLS.");
    }
    for (const name of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(name);
    const pool = new pg.Pool({
        connectionString: url.toString(),
        max,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
    });
    // An idle client that loses its connection emits "error"; without a listener that would end the process.
    pool.on("error", (error) => console.error("PostgreSQL pool error:", error.message));
    return pool;
}

/** Applies the schema. Every statement is CREATE ... IF NOT EXISTS, so running it at each start is safe. */
export async function migrate(pool) {
    await pool.query(SCHEMA_SQL);
}
