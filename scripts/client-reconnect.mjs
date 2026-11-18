import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const ts = require("typescript"),
  WS = require("ws");
export async function testClient(cookie, target, other) {
  const code = ts.transpileModule(
    await readFile(
      new URL("../frontend/src/realtime.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
  const { Realtime } = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
  const oldSocket = globalThis.WebSocket,
    oldLocation = globalThis.location;
  globalThis.location = { protocol: "http:", host: "127.0.0.1:3109" };
  globalThis.WebSocket = class extends WS {
    constructor(url) {
      super(url, {
        headers: { Cookie: cookie, Origin: "http://127.0.0.1:3109" },
      });
    }
  };
  let ready = 0;
  const events = [];
  const client = new Realtime(
    (e) => events.push(e),
    (r) => {
      if (r) ready++;
    },
  );
  const until = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Client reconnect timed out");
  };
  try {
    await until(() => ready === 1);
    const m = await client.request("send", target, { body: "客户端连接测试" });
    assert.ok(m.id);
    client.ws.terminate();
    await until(() => ready === 2);
    const after = await client.request("send", target, {
      body: "客户端自动重连后发送",
    });
    assert.ok(after.id > m.id);
    const pushed = await other("/messages/" + target, "POST", {
      body: "重连后的推送",
    });
    await until(() =>
      events.some((e) => e.type === "message" && e.message.id === pushed.id),
    );
    console.log(
      "PASS frontend client automatically reconnects, sends and receives",
    );
  } finally {
    client.close();
    globalThis.WebSocket = oldSocket;
    globalThis.location = oldLocation;
  }
}
