/** A minimal SMTP server for tests and smoke runs: accepts every message and keeps it. */
import { createServer } from "node:net";

export function smtpSink({ refuse = false } = {}) {
    const received = [];
    const server = createServer((socket) => {
        socket.setEncoding("utf8");
        let inData = false;
        let buffer = "";
        let mail = { to: [] };
        socket.write("220 sink ESMTP\r\n");
        socket.on("data", (chunk) => {
            buffer += chunk;
            for (;;) {
                if (inData) {
                    const end = buffer.indexOf("\r\n.\r\n");
                    if (end === -1) return;
                    mail.data = buffer.slice(0, end);
                    buffer = buffer.slice(end + 5);
                    inData = false;
                    if (refuse) socket.write("554 refused\r\n");
                    else {
                        received.push(mail);
                        socket.write("250 queued\r\n");
                    }
                    mail = { to: [] };
                    continue;
                }
                const lineEnd = buffer.indexOf("\r\n");
                if (lineEnd === -1) return;
                const line = buffer.slice(0, lineEnd);
                buffer = buffer.slice(lineEnd + 2);
                const upper = line.toUpperCase();
                if (upper.startsWith("EHLO") || upper.startsWith("HELO")) socket.write("250 sink\r\n");
                else if (upper.startsWith("MAIL FROM")) { mail.from = line; socket.write("250 ok\r\n"); }
                else if (upper.startsWith("RCPT TO")) { mail.to.push(line); socket.write("250 ok\r\n"); }
                else if (upper === "DATA") { inData = true; socket.write("354 go\r\n"); }
                else if (upper === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
                else socket.write("250 ok\r\n");
            }
        });
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, received, close: () => new Promise((r) => server.close(r)) })));
}
