import { adminChecks } from "./admin-checks.mjs";
import { testClient } from "./client-reconnect.mjs";
import { connect } from "./ws-client.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, ".cache"), { recursive: true });
const cwd = await mkdtemp(path.join(root, ".cache", "integration-"));
await mkdir(path.join(cwd, "data", "plugins"), { recursive: true });
await writeFile(
  path.join(cwd, "data", "plugins", "test.json"),
  JSON.stringify({
    id: "test-plugin",
    command: "welcome",
    response: { text: "Hello from plugin" },
  }),
);
await writeFile(
  path.join(cwd, "data", "plugins", "admin.json"),
  JSON.stringify({
    id: "admin-plugin",
    command: "admin-note",
    admin_only: true,
    response: { ok: true },
  }),
);
const server = spawn(
  process.env.IM_TEST_BINARY ||
    path.join(
      root,
      "backend",
      "target",
      "debug",
      process.platform === "win32" ? "scaraim.exe" : "scaraim",
    ),
  [],
  {
    cwd,
    env: { ...process.env, BIND_ADDR: "127.0.0.1:3109" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.on("data", (b) => (output += b));
server.stderr.on("data", (b) => (output += b));
const base = "http://127.0.0.1:3109/api";
let checks = 0;
function check(value, label) {
  assert.ok(value, label);
  checks++;
  console.log("PASS", label);
}
const sockets = [];
function client() {
  let cookie = "";
  let socket;
  const call = async (url, method = "GET", body, expected = 200) => {
    const match = url.match(/^\/messages\/([^/]+)(\/read)?$/);
    if (method === "POST" && match) {
      const r = await socket.request(
        match[2] ? "read" : "send",
        match[1],
        body,
      );
      assert.equal(r.type === "error" ? r.status : 200, expected, r.error);
      return r.data;
    }

    const r = await fetch(base + url, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal(
      r.status,
      expected,
      `${method} ${url}: ${await r.clone().text()}`,
    );
    return r.headers.get("content-type")?.includes("application/json")
      ? r.json()
      : r.arrayBuffer();
  };
  call.connect = async (origin) => {
    socket = await connect(cookie, origin);
    sockets.push(socket);
    return socket;
  };
  call.cookie = () => cookie;
  return call;
}
const a = client(),
  b = client(),
  c = client(),
  anonymous = client();
try {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + "/me");
      break;
    } catch {
      if (i === 99) throw new Error(output);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const alice = await a("/register", "POST", {
    username: "alice_test",
    password: "Example-password-123",
    nickname: "林间",
  });
  const bob = await b("/register", "POST", {
    username: "bob_test",
    password: "Example-password-123",
    nickname: "小舟",
  });
  const carol = await c("/register", "POST", {
    username: "carol_test",
    password: "Example-password-123",
    nickname: "远山",
  });
  const sa = await a.connect(),
    sb = await b.connect(),
    sc = await c.connect();
  await assert.rejects(() => connect(""));
  checks++;
  await assert.rejects(() => connect(a.cookie(), "https://evil.example"));
  checks++;
  check(
    alice.id !== bob.id && alice.badges.length === 1,
    "register unique IDs and system badge",
  );
  await anonymous("/me", "GET", undefined, 401);
  checks++;
  await anonymous(
    "/register",
    "POST",
    { username: "alice_test", password: "Example-password-123" },
    400,
  );
  checks++;
  await anonymous(
    "/login",
    "POST",
    { username: "alice_test", password: "wrong-password" },
    400,
  );
  checks++;
  await a("/messages/" + bob.id, "POST", { body: "blocked" }, 400);
  checks++;
  await a("/friends/" + bob.id, "POST");
  check((await b("/friends"))[0].id === alice.id, "friendship is mutual");
  await a("/friends/" + bob.id, "PATCH", { remark: "我的朋友" });
  check(
    (await a("/friends"))[0].remark === "我的朋友" &&
      (await b("/friends"))[0].remark === "",
    "remarks are private",
  );
  check((await a("/users?q=" + bob.id))[0].id === bob.id, "search by user ID");
  const m = await a("/messages/" + bob.id, "POST", { body: "你好，世界 ✨" });
  check(
    (await b("/messages/" + alice.id))[0].body === m.body,
    "text messages persist",
  );
  check((await b("/friends"))[0].unread === 1, "unread counts");
  await b("/messages/" + alice.id + "/read", "POST");
  check((await a("/messages/" + bob.id))[0].seen, "read receipts");
  const form = new FormData();
  form.append("file", new Blob(["private file contents"]), "测试文档.txt");
  const attachment = await a("/upload", "POST", form);
  await c("/files/" + attachment.id, "GET", undefined, 404);
  checks++;
  const fm = await a("/messages/" + bob.id, "POST", { file_id: attachment.id });
  check(
    new TextDecoder().decode(await b("/files/" + attachment.id)) ===
      "private file contents",
    "recipient can download attachment",
  );
  await c("/messages/" + bob.id, "POST", { forward_id: fm.id }, 400);
  checks++;
  await b("/friends/" + carol.id, "POST");
  await b("/messages/" + carol.id, "POST", { forward_id: fm.id });
  check(
    new TextDecoder().decode(await c("/files/" + attachment.id)) ===
      "private file contents",
    "forward grants recipient attachment access",
  );
  check(
    (await c("/messages/" + bob.id))[0].forwarded,
    "forwarded message is labeled",
  );
  check(
    (await c("/messages/" + alice.id)).length === 0,
    "other conversations are isolated",
  );
  const image = new FormData();
  image.append(
    "file",
    new Blob([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    ]),
    "image.png",
  );
  const img = await a("/upload", "POST", image);
  check(img.mime === "image/png", "image signature is recognized");
  await a("/me", "PATCH", {
    nickname: "林间新昵称",
    avatar: img.url,
    banner: img.url,
    status: "busy",
  });
  const profile = await a("/me");
  check(
    profile.avatar === img.url &&
      profile.status === "busy" &&
      profile.nickname === "林间新昵称",
    "profile images, nickname, presence persist",
  );
  await a("/messages/" + bob.id, "POST", { file_id: img.id });
  check(
    (await b("/messages/" + alice.id)).at(-1).kind === "image",
    "image message type",
  );
  await b(
    "/me",
    "PATCH",
    { nickname: "小舟", avatar: img.url, banner: "", status: "online" },
    400,
  );
  checks++;
  for (let i = 0; i < 103; i++)
    await a("/messages/" + bob.id, "POST", { body: "分页消息 " + i });
  const latest = await a("/messages/" + bob.id);
  const earlier = await a(`/messages/${bob.id}?before=${latest[0].id}`);
  check(
    latest.length === 100 &&
      earlier.length === 6 &&
      earlier.at(-1).id < latest[0].id,
    "history pagination without overlap",
  );
  await a("/friends/" + bob.id, "DELETE");
  check(
    !(await b("/friends")).some((x) => x.id === alice.id),
    "delete removes both sides",
  );
  await a("/messages/" + bob.id, "POST", { body: "blocked" }, 400);
  checks++;
  await a("/friends/" + bob.id, "POST");
  check(
    (await a("/messages/" + bob.id)).length === 100,
    "history survives re-adding friend",
  );
  await a("/logout", "POST");
  await a("/me", "GET", undefined, 401);
  checks++;
  await a("/login", "POST", {
    username: "alice_test",
    password: "Example-password-123",
  });
  check((await a("/me")).id === alice.id, "login restores same account");
  const saLatest = await a.connect();
  const sb2 = await b.connect();
  const pushed = await a("/messages/" + bob.id, "POST", {
    body: "实时推送验证",
  });
  check(
    (await sb.wait((e) => e.type === "message" && e.message.id === pushed.id))
      .message.body === "实时推送验证",
    "recipient receives WebSocket push",
  );
  check(
    (await sb2.wait((e) => e.type === "message" && e.message.id === pushed.id))
      .message.id === pushed.id,
    "multiple sessions receive same message",
  );
  check(
    !sc.events.some((e) => e.type === "message" && e.message.id === pushed.id),
    "unrelated users receive no private message events",
  );
  const closed = new Promise((r) => sb2.ws.once("close", r));
  sb2.ws.close();
  await closed;
  check(
    (await a("/friends")).find((f) => f.id === bob.id).status === "online",
    "closing one window keeps other window online",
  );
  const closedMain = new Promise((r) => sb.ws.once("close", r));
  sb.ws.close();
  await closedMain;
  const offline = await a("/messages/" + bob.id, "POST", {
    body: "离线后补载",
  });
  await b.connect();
  check(
    (await b("/messages/" + alice.id)).some((m) => m.id === offline.id),
    "reconnect recovers offline messages through HTTP history",
  );
  await testClient(a.cookie(), bob.id, a);
  checks++;
  await a("/logout", "POST");
  const stale = await saLatest
    .request("send", bob.id, { body: "revoked session" })
    .catch(() => null);
  check(
    stale === null || stale.type === "error",
    "revoked session cannot send over existing socket",
  );
  await adminChecks({
    a,
    b,
    c,
    alice,
    bob,
    carol,
    cwd,
    check,
    binary:
      process.env.IM_TEST_BINARY ||
      path.join(
        root,
        "backend",
        "target",
        "debug",
        process.platform === "win32" ? "scaraim.exe" : "scaraim",
      ),
  });
  console.log(`SUCCESS: ${checks} checks. Isolated test data: ${cwd}`);
} finally {
  sockets.forEach((s) => s.ws.terminate());
  server.kill();
}
