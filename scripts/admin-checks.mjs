import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function adminChecks({
  a,
  b,
  c,
  alice,
  bob,
  carol,
  binary,
  cwd,
  check,
}) {
  await a("/login", "POST", {
    username: "alice_test",
    password: "Example-password-123",
  });
  await b("/admin/stats", "GET", undefined, 403);
  check(true, "ordinary users cannot access admin system data");
  await exec(binary, ["--grant-admin", "alice_test"], { cwd });
  check((await a("/me")).role === "admin", "local admin bootstrap grants role");
  const sys = await a("/admin/stats");
  check(
    sys.memory_total > 0 &&
      sys.cpu_threads > 0 &&
      sys.database_bytes > 0 &&
      sys.messages > 0,
    "system stats include hardware and storage",
  );
  const ws = await b.connect();
  check(
    (await ws.request("command", "", { line: "/ping" })).data.reply === "pong",
    "user slash ping works",
  );
  check(
    (await ws.request("command", "", { line: "/sysinfo" })).data.arch,
    "user sysinfo works",
  );
  check(
    (await ws.request("command", "", { line: "/users" })).type === "error",
    "privileged commands reject ordinary users",
  );
  check(
    (await ws.request("command", "", { line: "/welcome" })).data.text ===
      "Hello from plugin",
    "declarative command plugin loads",
  );
  check(
    (await ws.request("command", "", { line: "/admin-note" })).type === "error",
    "plugin permissions enforced on server",
  );
  const help = (await ws.request("command", "", { line: "/help" })).data;
  check(
    help.commands.includes("ping") && !help.commands.includes("ban"),
    "command discovery filters privileges",
  );
  const created = await a("/admin/users", "POST", {
    username: "managed_user",
    nickname: "管理测试",
    password: "Temp-password-123",
  });
  check(
    created.id && created.role === "user",
    "admin creates user without exposing password",
  );
  const list = await a("/admin/users?q=managed_user");
  check(
    list.total === 1 && !JSON.stringify(list).includes("password"),
    "admin user listing excludes password hashes",
  );
  await b("/admin/users/" + created.id, "DELETE", undefined, 403);
  check(true, "ordinary user cannot delete accounts");
  const self = await a("/me");
  await a(
    "/admin/users/" + alice.id,
    "PATCH",
    { ...self, status: "online", role: "user", banned: false, reason: "" },
    400,
  );
  await a("/admin/users/" + alice.id, "DELETE", undefined, 400);
  check(true, "administrator cannot delete or demote self");
  const imgForm = new FormData();
  imgForm.append(
    "file",
    new Blob([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    ]),
    "badge.png",
  );
  const image = await a("/upload", "POST", imgForm);
  await a("/admin/badges", "POST", {
    id: "founder",
    name: "创始成员",
    image: image.url,
  });
  await a("/admin/users/" + bob.id + "/badges", "POST", {
    badge_id: "founder",
    award: true,
  });
  check(
    (await b("/me")).badge_details.some((x) => x.id === "founder"),
    "badge award appears in user profile",
  );
  await c("/files/" + image.id);
  check(true, "authenticated users can load awarded badge artwork");
  await b(
    "/admin/badges",
    "POST",
    { id: "forged", name: "x", image: image.url },
    403,
  );
  check(true, "badge forgery is denied");
  await a("/admin/badges", "POST", {
    id: "founder",
    name: "Founder v2",
    image: image.url,
  });
  check(
    (await b("/me")).badge_details[0].name === "Founder v2",
    "badge catalog edits propagate",
  );
  await a("/admin/users/" + bob.id + "/badges", "POST", {
    badge_id: "founder",
    award: false,
  });
  check((await b("/me")).badge_details.length === 0, "badge revocation works");
  const exported = await a("/admin/users/" + bob.id + "/export");
  check(
    exported.format === "ScaraIM.messages.v1" &&
      exported.messages.length > 0 &&
      exported.messages.every(
        (m) => m.sender === bob.id || m.receiver === bob.id,
      ),
    "JSON export contains only target user messages",
  );
  await b("/admin/users/" + alice.id + "/export", "GET", undefined, 403);
  check(true, "message export requires administrator");
  const updated = {
    ...created,
    username: "managed_changed",
    nickname: "新昵称",
    avatar: image.url,
    banner: image.url,
    status: "busy",
    role: "user",
    banned: true,
    reason: "test",
    password: "Changed-password-123",
  };
  await a("/admin/users/" + created.id, "PATCH", updated);
  const login = async (password, expected) => {
    const r = await fetch("http://127.0.0.1:3109/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "managed_changed", password }),
    });
    assert.equal(r.status, expected);
    return r;
  };
  await login("Changed-password-123", 403);
  check(true, "banned account cannot log in");
  await a("/admin/users/" + created.id, "PATCH", {
    ...updated,
    banned: false,
    password: "",
  });
  await login("Temp-password-123", 400);
  const valid = await login("Changed-password-123", 200);
  check(true, "password reset and unban work");
  const managedCookie = valid.headers.get("set-cookie").split(";")[0];
  const profileResponse = await fetch("http://127.0.0.1:3109/api/me", {
    method: "PATCH",
    headers: { Cookie: managedCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: "修改头像后昵称",
      avatar: image.url,
      banner: image.url,
      status: "online",
    }),
  });
  assert.equal(profileResponse.status, 200);
  check(true, "users can retain admin-assigned profile images");
  await a("/admin/users/" + created.id + "/sessions", "DELETE");
  const gone = await fetch("http://127.0.0.1:3109/api/me", {
    headers: { Cookie: managedCookie },
  });
  check(gone.status === 401, "revoking sessions invalidates HTTP credentials");
  const binfo = await b("/me");
  await a("/admin/users/" + bob.id, "PATCH", {
    ...binfo,
    status: "online",
    role: "user",
    banned: true,
    reason: "test",
  });
  await b("/me", "GET", undefined, 401);
  const result = await ws
    .request("send", alice.id, { body: "blocked after ban" })
    .catch(() => null);
  check(
    !result || result.type === "error",
    "ban revokes active WebSocket sending",
  );
  await a("/admin/users/" + bob.id, "PATCH", {
    ...binfo,
    status: "online",
    role: "user",
    banned: false,
    reason: "",
  });
  await a("/admin/badges/founder", "DELETE");
  check(
    !(await a("/admin/badges")).some((x) => x.id === "founder"),
    "badge deletion removes catalog entry",
  );
  await a("/admin/users/" + created.id, "DELETE");
  check(
    (await a("/admin/users?q=managed_changed")).total === 0,
    "admin permanently deletes selected user",
  );
  const audit = await a("/admin/logs");
  check(
    audit.audit.some((x) => x.action === "export-messages") &&
      audit.audit.some((x) => x.action === "delete-user") &&
      !JSON.stringify(audit).includes("Changed-password-123"),
    "audit records actions without passwords",
  );
  const local = await exec(binary, ["--command", "/sysinfo"], { cwd });
  check(
    local.stdout.includes('"arch"'),
    "local command runner uses shared dispatcher",
  );
}
