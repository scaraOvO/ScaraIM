import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Shield,
  Users,
  Award,
  Activity,
  RefreshCw,
  Plus,
  Save,
  Trash2,
  Download,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
  Upload,
  Database,
  Cpu,
  MemoryStick,
} from "lucide-react";
import { api, upload } from "./api";
import { t, useLocale, LanguagePicker } from "./i18n";
export function bytes(n: number) {
  if (!n) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** index).toFixed(index ? 1 : 0) + " " + units[index];
}
function value(key: string, v: any) {
  if (key.includes("bytes") || key.startsWith("memory_"))
    return bytes(Number(v));
  if (key === "cpu_usage") return Number(v || 0).toFixed(1) + "%";
  if (key.includes("uptime"))
    return (
      Math.floor(Number(v || 0) / 3600) +
      "h " +
      Math.floor((Number(v || 0) % 3600) / 60) +
      "m"
    );
  return String(v ?? "—");
}
export function SystemGrid({ stats }: { stats: any }) {
  return (
    <div className="system-grid">
      {Object.entries(stats || {}).map(([k, v]) => (
        <div key={k}>
          <small>{t(k)}</small>
          <strong>{value(k, v)}</strong>
        </div>
      ))}
    </div>
  );
}
export default function Admin({
  me,
  onClose,
}: {
  me: any;
  onClose: () => void;
}) {
  useLocale();
  const [section, setSection] = useState("overview"),
    [stats, setStats] = useState<any>({}),
    [users, setUsers] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<any>(null),
    [creating, setCreating] = useState(false),
    [badges, setBadges] = useState<any[]>([]),
    [badge, setBadge] = useState({ id: "", name: "", image: "" }),
    [badgeEdit, setBadgeEdit] = useState(false),
    [logs, setLogs] = useState<any>({ logs: [], audit: [] }),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const report = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : t("操作失败"));
  async function refresh() {
    if (section === "overview") setStats(await api("/admin/stats"));
    if (section === "users") {
      const r = await api(
        "/admin/users?q=" + encodeURIComponent(query) + "&page=" + page,
      );
      setUsers(r.users);
      setTotal(r.total);
      setBadges(await api("/admin/badges"));
    }
    if (section === "badges") setBadges(await api("/admin/badges"));
    if (section === "logs") setLogs(await api("/admin/logs"));
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        await refresh();
      } catch (e) {
        if (active) report(e);
      }
      if (active && (section === "overview" || section === "logs"))
        timer = setTimeout(run, 5000);
    };
    run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [section, page]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(t("操作完成"));
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function picture(file: File | undefined, apply: (url: string) => void) {
    if (!file) return;
    await action(async () => {
      const r = await upload(file);
      if (!r.mime.startsWith("image/"))
        throw new Error(t("请使用 PNG、JPEG、GIF 或 WebP 图片"));
      apply(r.url);
    });
  }
  async function exportMessages(uid: string) {
    const r = await fetch("/api/admin/users/" + uid + "/export");
    if (!r.ok) {
      const e = await r.json();
      throw new Error(t(e.error));
    }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "ScaraIM-" + uid + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="admin-shell">
      <aside className="admin-nav">
        <div className="admin-brand">
          <Shield />
          ScaraIM<small>ADMIN</small>
        </div>
        {[
          ["overview", "系统概览", Activity],
          ["users", "用户管理", Users],
          ["badges", "徽章管理", Award],
          ["logs", "日志与审计", Database],
        ].map(([key, label, Icon]: any) => (
          <button
            key={key}
            className={section === key ? "selected" : ""}
            onClick={() => {
              setSection(key);
              setSelected(null);
            }}
          >
            <Icon size={20} />
            {t(label)}
          </button>
        ))}
        <div className="admin-nav-bottom">
          <LanguagePicker />
          <button onClick={onClose}>
            <ArrowLeft size={18} />
            {t("消息")}
          </button>
        </div>
      </aside>
      <section className="admin-main">
        <header>
          <div>
            <small>SCARAIM / CONTROL CENTER</small>
            <h1>
              {t(
                (
                  {
                    overview: "系统概览",
                    users: "用户管理",
                    badges: "徽章管理",
                    logs: "日志与审计",
                  } as any
                )[section],
              )}
            </h1>
          </div>
          <button
            className="secondary"
            title={t("刷新")}
            aria-label={t("刷新")}
            onClick={() => refresh().catch(report)}
          >
            <RefreshCw size={18} />
          </button>
        </header>
        {notice && (
          <p role="status" className="admin-notice">
            {notice}
          </p>
        )}
        {section === "overview" && (
          <>
            <div className="metric-cards">
              {[
                ["storage_bytes", Database],
                ["memory_used", MemoryStick],
                ["cpu_usage", Cpu],
                ["online_users", Users],
              ].map(([key, Icon]: any) => (
                <article key={key}>
                  <Icon size={22} />
                  <small>{t(key)}</small>
                  <h2>{value(key, stats[key])}</h2>
                </article>
              ))}
            </div>
            <section className="admin-card">
              <SystemGrid stats={stats} />
            </section>
            <p className="muted">
              {t("message_text_bytes")} ≠ {t("database_bytes")} +{" "}
              {t("upload_disk_bytes")}
            </p>
          </>
        )}
        {section === "users" && (
          <>
            <form
              className="admin-toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(0);
                refresh().catch(report);
              }}
            >
              <Search size={18} />
              <input
                aria-label={t("查找用户")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("用户名 / ID / 昵称")}
              />
              <button className="secondary">{t("查找")}</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setCreating(true);
                  setSelected({
                    username: "",
                    nickname: "",
                    password: "",
                    avatar: "",
                    banner: "",
                    status: "online",
                    role: "user",
                    banned: false,
                    reason: "",
                  });
                }}
              >
                <Plus size={16} />
                {t("创建用户")}
              </button>
            </form>
            <div className={"admin-users " + (selected ? "editing" : "")}>
              <section className="admin-card">
                <div className="admin-user-list">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      className={selected?.id === u.id ? "selected" : ""}
                      onClick={() => {
                        setCreating(false);
                        setSelected({
                          ...u,
                          status: u.preferred_status || u.status,
                          password: "",
                          banned: !!u.banned,
                          reason: u.reason || "",
                        });
                      }}
                    >
                      <span className="avatar">
                        {u.avatar ? (
                          <img src={u.avatar} alt="" />
                        ) : (
                          u.nickname[0]
                        )}
                      </span>
                      <span>
                        <strong>{u.nickname}</strong>
                        <small>@{u.username}</small>
                      </span>
                      {u.role === "admin" && <Shield size={15} />}
                      <i className={u.banned ? "user-banned" : "user-status"}>
                        {u.banned
                          ? t("封禁")
                          : t(
                              (
                                {
                                  online: "在线",
                                  offline: "离线",
                                  busy: "忙碌",
                                  away: "离开",
                                } as any
                              )[u.status],
                            )}
                      </i>
                    </button>
                  ))}
                </div>
                <footer className="pagination">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label={t("上一页")}
                  >
                    <ChevronLeft />
                  </button>
                  <span>
                    {page + 1} / {Math.max(1, Math.ceil(total / 50))} · {total}
                  </span>
                  <button
                    disabled={(page + 1) * 50 >= total}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label={t("下一页")}
                  >
                    <ChevronRight />
                  </button>
                </footer>
              </section>
              {selected && (
                <section className="admin-card editor">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        if (creating) {
                          await api("/admin/users", "POST", selected);
                          setSelected(null);
                        } else {
                          await api(
                            "/admin/users/" + selected.id,
                            "PATCH",
                            selected,
                          );
                          setSelected({ ...selected, password: "" });
                        }
                      });
                    }}
                  >
                    <h2>{t(creating ? "创建用户" : "用户管理")}</h2>
                    {!creating && (
                      <small className="user-id">{selected.id}</small>
                    )}
                    {["username", "nickname", "password"].map((key, i) => (
                      <label key={key}>
                        {t(
                          i === 0
                            ? "用户名"
                            : i === 1
                              ? "昵称"
                              : creating
                                ? "密码"
                                : "新密码（留空不修改）",
                        )}
                        <input
                          autoComplete={
                            key === "password" ? "new-password" : "off"
                          }
                          type={key === "password" ? "password" : "text"}
                          required={key !== "password" || creating}
                          minLength={key === "password" ? 8 : undefined}
                          maxLength={
                            key === "nickname"
                              ? 32
                              : key === "username"
                                ? 32
                                : 128
                          }
                          value={selected[key]}
                          onChange={(e) =>
                            setSelected({ ...selected, [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    {!creating && (
                      <>
                        <div className="admin-images">
                          {(["avatar", "banner"] as const).map((key, i) => (
                            <label key={key}>
                              {t(i ? "横幅" : "头像")}
                              {selected[key] && (
                                <img src={selected[key]} alt="" />
                              )}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                onChange={(e) =>
                                  picture(e.target.files?.[0], (url) =>
                                    setSelected({ ...selected, [key]: url }),
                                  )
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setSelected({ ...selected, [key]: "" })
                                }
                              >
                                {t("清除")}
                              </button>
                            </label>
                          ))}
                        </div>
                        <label>
                          {t("在线状态")}
                          <select
                            value={selected.status}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                status: e.target.value,
                                preferred_status: e.target.value,
                              })
                            }
                          >
                            {[
                              ["online", "在线"],
                              ["offline", "离线"],
                              ["away", "离开"],
                              ["busy", "忙碌"],
                            ].map(([k, v]) => (
                              <option key={k} value={k}>
                                {t(v)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("角色")}
                          <select
                            disabled={selected.id === me.id}
                            value={selected.role}
                            onChange={(e) =>
                              setSelected({ ...selected, role: e.target.value })
                            }
                          >
                            <option value="user">{t("普通用户")}</option>
                            <option value="admin">{t("管理员")}</option>
                          </select>
                        </label>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            disabled={selected.id === me.id}
                            checked={selected.banned}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                banned: e.target.checked,
                              })
                            }
                          />
                          {t("封禁")}
                        </label>
                        <label>
                          {t("封禁原因")}
                          <input
                            maxLength={250}
                            value={selected.reason}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                reason: e.target.value,
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                    <button className="primary full" disabled={busy}>
                      <Save size={16} />
                      {t("保存")}
                    </button>
                  </form>
                  {!creating && (
                    <>
                      <div className="admin-actions">
                        <button
                          disabled={busy}
                          title={t("导出消息")}
                          onClick={() =>
                            action(() => exportMessages(selected.id))
                          }
                        >
                          <Download size={17} />
                          {t("导出消息")}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              await api(
                                "/admin/users/" + selected.id + "/sessions",
                                "DELETE",
                              );
                            })
                          }
                        >
                          <LogOut size={17} />
                          {t("撤销会话")}
                        </button>
                        <button
                          disabled={busy || selected.id === me.id}
                          className="danger"
                          onClick={() => {
                            if (
                              confirm(t("确认永久删除用户及其全部聊天记录？"))
                            )
                              action(async () => {
                                await api(
                                  "/admin/users/" + selected.id,
                                  "DELETE",
                                );
                                setSelected(null);
                              });
                          }}
                        >
                          <Trash2 size={17} />
                          {t("删除")}
                        </button>
                      </div>
                      <h3>{t("徽章管理")}</h3>
                      {badges.map((b) => {
                        const has = selected.badge_details?.some(
                          (x: any) => x.id === b.id,
                        );
                        return (
                          <div className="award-row" key={b.id}>
                            <img src={b.image} alt="" />
                            <span>
                              {b.name}
                              <small>{b.id}</small>
                            </span>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                action(async () => {
                                  await api(
                                    "/admin/users/" + selected.id + "/badges",
                                    "POST",
                                    { badge_id: b.id, award: !has },
                                  );
                                  setSelected({
                                    ...selected,
                                    badge_details: has
                                      ? selected.badge_details.filter(
                                          (x: any) => x.id !== b.id,
                                        )
                                      : [...(selected.badge_details || []), b],
                                  });
                                })
                              }
                            >
                              {t(has ? "收回" : "发放")}
                            </button>
                          </div>
                        );
                      })}
                    </>
                  )}
                </section>
              )}
            </div>
          </>
        )}
        {section === "badges" && (
          <div className="badge-workspace">
            <section className="admin-card">
              <button
                className="primary"
                onClick={() => {
                  setBadge({ id: "", name: "", image: "" });
                  setBadgeEdit(false);
                }}
              >
                <Plus size={16} />
                {t("添加")}
              </button>
              {badges.map((b) => (
                <button
                  key={b.id}
                  className="badge-catalog-row"
                  onClick={() => {
                    setBadge(b);
                    setBadgeEdit(true);
                  }}
                >
                  <img src={b.image} alt="" />
                  <span>
                    {b.name}
                    <small>{b.id}</small>
                  </span>
                </button>
              ))}
            </section>
            <form
              className="admin-card editor"
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await api("/admin/badges", "POST", badge);
                  setBadgeEdit(true);
                });
              }}
            >
              <div className="badge-preview">
                {badge.image ? (
                  <img src={badge.image} alt="" />
                ) : (
                  <Award size={56} />
                )}
              </div>
              <label>
                {t("图案")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(e) =>
                    picture(e.target.files?.[0], (url) =>
                      setBadge({ ...badge, image: url }),
                    )
                  }
                />
              </label>
              <label>
                {t("徽章 ID")}
                <input
                  required
                  disabled={badgeEdit}
                  pattern="[A-Za-z0-9_-]+"
                  maxLength={64}
                  value={badge.id}
                  onChange={(e) => setBadge({ ...badge, id: e.target.value })}
                />
              </label>
              <label>
                {t("名称")}
                <input
                  required
                  maxLength={64}
                  value={badge.name}
                  onChange={(e) => setBadge({ ...badge, name: e.target.value })}
                />
              </label>
              <button className="primary full" disabled={busy || !badge.image}>
                <Upload size={16} />
                {t("保存")}
              </button>
              {badgeEdit && (
                <button
                  type="button"
                  className="danger full"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t("确认删除徽章并收回所有授予？")))
                      action(async () => {
                        await api("/admin/badges/" + badge.id, "DELETE");
                        setBadge({ id: "", name: "", image: "" });
                        setBadgeEdit(false);
                      });
                  }}
                >
                  <Trash2 size={16} />
                  {t("删除")}
                </button>
              )}
            </form>
          </div>
        )}
        {section === "logs" && (
          <>
            <section className="admin-card">
              <h2>{t("日志与审计")}</h2>
              <pre className="server-logs">
                {logs.logs.join("\n") || t("无数据")}
              </pre>
            </section>
            <section className="admin-card audit-table">
              <table>
                <thead>
                  <tr>
                    {["时间", "操作者", "操作", "目标"].map((k) => (
                      <th key={k}>{t(k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.audit.map((r: any) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created * 1000).toLocaleString()}</td>
                      <td>{r.actor}</td>
                      <td>{r.action}</td>
                      <td>{r.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
