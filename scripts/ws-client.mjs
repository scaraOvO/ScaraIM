import { createRequire } from "node:module";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const WebSocket = require("ws");
export async function connect(cookie, origin = "http://127.0.0.1:3109") {
  const ws = new WebSocket("ws://127.0.0.1:3109/api/ws", {
    headers: { Cookie: cookie, Origin: origin },
  });
  const events = [];
  const pending = new Map();
  const waiters = [];
  const wait = (predicate) =>
    new Promise((resolve, reject) => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      const w = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error("WebSocket event timed out"));
        }, 5000),
      };
      waiters.push(w);
    });
  ws.on("message", (raw) => {
    const e = JSON.parse(raw);
    if (e.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    events.push(e);
    for (const w of [...waiters]) {
      if (w.predicate(e)) {
        clearTimeout(w.timer);
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
    const p = pending.get(e.request_id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(e.request_id);
      p.resolve(e);
    }
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await wait((e) => e.type === "ready");
  return {
    ws,
    events,
    wait,
    request: (type, target, payload) =>
      new Promise((resolve, reject) => {
        const request_id = crypto.randomUUID();
        pending.set(request_id, {
          resolve,
          timer: setTimeout(() => {
            pending.delete(request_id);
            reject(new Error("WebSocket acknowledgement timed out"));
          }, 5000),
        });
        ws.send(JSON.stringify({ type, target, payload, request_id }));
      }),
  };
}
