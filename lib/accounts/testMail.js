/**
 * A mailer that sends nothing. For tests and for ACCOUNTS_MODE=memory on a developer's machine.
 *
 * Messages are kept in memory, and, if a directory is given, appended as JSON lines to
 * <directory>/outbox.jsonl so that a developer can open the link of a sign-up they made themselves.
 * That file is git-ignored and never leaves the machine. It is not a production behaviour: a real
 * provider adapter replaces this one, and nothing that handles real addresses may use this.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function createTestMail({ directory } = {}) {
    const messages = [];

    const record = (kind) => async (message) => {
        const entry = { at: new Date().toISOString(), kind, ...message };
        messages.push(entry);
        if (directory) {
            mkdirSync(directory, { recursive: true });
            appendFileSync(path.join(directory, "outbox.jsonl"), JSON.stringify(entry) + "\n");
        }
    };

    return {
        messages,
        sendVerification: record("verification"),
        sendReset: record("reset"),
        sendPasswordChanged: record("changed"),
        sendAccountExists: record("exists"),
        sendAccountDeleted: record("deleted"),
    };
}
