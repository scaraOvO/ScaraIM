import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const binary = process.env.IM_TEST_BINARY || path.join(root, "backend/target/debug", process.platform === "win32" ? "scaraim.exe" : "scaraim");
await mkdir(path.join(root, ".cache"), { recursive: true });
const cwd = await mkdtemp(path.join(root, ".cache/platform-"));
const data = path.join(cwd, "数据 with spaces");
const run = (args) => spawnSync(binary, args, { cwd, encoding: "utf8", timeout: 20000 });
assert.equal(run(["--help"]).status, 0);
assert.equal(run(["--version"]).status, 0);
assert.equal(run(["--set-admin"]).status, 2);
assert.equal(run(["--unknown"]).status, 2);
assert.equal(run(["--set-admin", "a", "--command", "/ping"]).status, 2);
await assert.rejects(access(path.join(cwd, "data")));
const args = ["--data-dir", data];
assert.equal(run([...args, "--set-admin", "missing"]).status, 1);
const server = spawn(binary, [...args, "--bind", "127.0.0.1:3119", "--frontend-dir", path.join(root, "frontend/dist"), "--tui"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
server.stdout.on("data", b => logs += b);
server.stderr.on("data", b => logs += b);
try {
  let ready = false;
  for (let i=0;i<100;i++) {
    try { await fetch("http://127.0.0.1:3119/api/me"); ready = true; break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  const res = await fetch("http://127.0.0.1:3119/api/register", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:"platform_admin",password:"PlatformTest123!",nickname:"跨平台"}) });
  assert.equal(res.status, 200, await res.text());
  const cookie = res.headers.get("set-cookie").split(";")[0];
  assert.equal(run([...args, "--set-admin", "PLATFORM_ADMIN"]).status, 0);
  const me = await fetch("http://127.0.0.1:3119/api/me", {headers:{cookie}});
  assert.equal((await me.json()).role, "admin");
  assert.equal(run([...args, "--command", "/setadmin platform_admin"]).status, 0);
  const page = await fetch("http://127.0.0.1:3119/");
  assert.match(await page.text(), /ScaraIM/);
  await access(path.join(data, "im.db"));
  await access(path.join(data, "server.log"));
  await assert.rejects(access(path.join(cwd, "data")));
  console.log("Platform checks passed: CLI, admin assignment, Unicode paths, custom data directory, redirected TUI, frontend serving.");
} finally {
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null || server.signalCode !== null) resolve(); else server.once("exit", resolve); });
}
