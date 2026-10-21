/* Orari service worker: shows a reminder when the push service delivers one, and handles its two buttons.
   It keeps no cache and does nothing else: the app works the same without it. The payload is only an id and generic
   text unless the person chose to see details. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = {};
    }
    const canSnooze = typeof data.snoozes === "number" && data.snoozes < 3;
    event.waitUntil(
        self.registration.showNotification(data.title || "Study time", {
            body: data.body || "A study session starts soon.",
            tag: data.id || "orari",
            data: { id: data.id },
            actions: [{ action: "open", title: "Open" }, ...(canSnooze ? [{ action: "snooze", title: "Snooze 10 min" }] : [])],
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const id = event.notification.data && event.notification.data.id;
    if (event.action === "snooze" && id) {
        // The cookie of the signed-in person travels with this request (same origin). A refusal (the limit, no session) is silent: the app lists the reminder.
        event.waitUntil(
            fetch("/api/push/snooze", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "orari" }, body: JSON.stringify({ id, minutes: 10 }) }).catch(() => undefined),
        );
        return;
    }
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
            for (const w of windows) if ("focus" in w) return w.focus();
            return self.clients.openWindow("/app/");
        }),
    );
});
