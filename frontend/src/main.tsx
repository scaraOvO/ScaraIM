import Admin, { SystemGrid } from "./Admin";
import { t, useLocale, locale, LanguagePicker } from "./i18n";
import { api } from "./api";
import { Realtime } from "./realtime";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MessageCircle,
  Shield,
  Terminal,
  Languages,
  Users,
  Plus,
  Search,
  Settings,
  LogOut,
  Send,
  Paperclip,
  Image as ImageIcon,
  Forward,
  X,
  ArrowLeft,
  CheckCheck,
  Link as LinkIcon,
  UserPlus,
  Trash2,
  Pencil,
  File,
  LoaderCircle,
  ChevronDown,
} from "lucide-react";
import "./style.css";

type User = {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  banner: string;
  status: string;
  preferred_status: string;
  badges: string[];
  role: string;
  badge_details?: { id: string; name: string; image: string }[];
  remark?: string;
  unread?: number;
  last?: { body: string; kind: string; created: number };
};
type Message = {
  id: number;
  sender: string;
  receiver: string;
  body: string;
  kind: string;
  file_id: string | null;
  forwarded: boolean;
  created: number;
  seen: boolean;
};
const statuses: Record<string, string> = {
  online: "在线",
  away: "离开",
  busy: "忙碌",
  offline: "离线",
};
function Avatar({ user, large = false }: { user: User; large?: boolean }) {
  return (
    <span
      className={"avatar " + (large ? "large" : "")}
      style={{
        background: `hsl(${[...user.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 360} 45% 89%)`,
      }}
    >
      {user.avatar ? (
        <img src={user.avatar} alt="" />
      ) : (
        user.nickname.slice(0, 1).toUpperCase()
      )}
      <i className={"presence " + user.status} />
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon" aria-label={t("关闭")} onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function App() {
  useLocale();
  const [adminView, setAdminView] = useState(location.hash === "#admin");
  const [commandResults, setCommandResults] = useState<
    {
      id: string;
      peer: string;
      line: string;
      created: number;
      data?: Record<string, unknown>;
      error?: string;
      pending: boolean;
    }[]
  >([]);
  useEffect(() => {
    const expired = () => {
      setMe(null);
      setCommandResults([]);
      setSelected(null);
      setMessages([]);
      setFriends([]);
      setModal(null);
    };
    window.addEventListener("scaraim:unauthorized", expired);
    return () => window.removeEventListener("scaraim:unauthorized", expired);
  }, []);
  const [me, setMe] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [friends, setFriends] = useState<User[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState("messages"),
    [filter, setFilter] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [draft, setDraft] = useState("");
  const [modal, setModal] = useState<
      "add" | "profile" | "detail" | "forward" | null
    >(null),
    [search, setSearch] = useState(""),
    [results, setResults] = useState<User[]>([]),
    [forward, setForward] = useState<Message | null>(null),
    [profile, setProfile] = useState<User | null>(null),
    [remark, setRemark] = useState(""),
    [canLoad, setCanLoad] = useState(false),
    [connected, setConnected] = useState(false);
  const end = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    selectedRef = useRef(selected),
    epoch = useRef(0);
  selectedRef.current = selected;
  const peer = friends.find((f) => f.id === selected);
  const handleError = (e: unknown) =>
    setError(e instanceof Error ? t(e.message) : t("操作失败"));
  async function refresh() {
    setFriends(await api<User[]>("/friends"));
  }
  useEffect(() => {
    api<User>("/me")
      .then(setMe)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const realtime = useRef<Realtime | null>(null);
  async function loadHistory(target: string) {
    const version = epoch.current;
    const m = await api<Message[]>("/messages/" + target);
    if (selectedRef.current !== target || version !== epoch.current) return;
    setCanLoad(m.length === 100);
    setMessages((old) => {
      const merged = new Map(m.map((x) => [x.id, x]));
      // Keep events received while the HTTP snapshot was in flight.
      old
        .filter((x) => x.id >= (m[0]?.id ?? 0))
        .forEach((x) =>
          merged.set(x.id, {
            ...x,
            seen: x.seen || merged.get(x.id)?.seen || false,
          }),
        );
      return [...merged.values()].sort((a, b) => a.id - b.id);
    });
    if (document.visibilityState === "visible")
      realtime.current?.request("read", target).catch(handleError);
  }
  useEffect(() => {
    if (!me) return;
    let alive = true;
    let refreshVersion = 0;
    const refreshList = async () => {
      const v = ++refreshVersion;
      try {
        const f = await api<User[]>("/friends");
        if (alive && v === refreshVersion) setFriends(f);
      } catch (e) {
        if (alive) handleError(e);
      }
    };
    const rt = new Realtime(
      (data) => {
        if (!alive) return;
        if (data.type === "ready") {
          refreshList();
          api<User>("/me")
            .then((u) => {
              if (alive) setMe(u);
            })
            .catch(handleError);
          if (selectedRef.current)
            loadHistory(selectedRef.current).catch(handleError);
        }
        if (data.type === "friends_changed") {
          refreshList();
          api<User>("/me")
            .then((u) => {
              if (alive) setMe(u);
            })
            .catch(handleError);
        }
        if (data.type === "message") {
          const m: Message = data.message;
          const peer = m.sender === me.id ? m.receiver : m.sender;
          if (selectedRef.current === peer) {
            setMessages((old) =>
              old.some((x) => x.id === m.id)
                ? old
                : [...old, m].sort((a, b) => a.id - b.id),
            );
            if (m.receiver === me.id && document.visibilityState === "visible")
              rt.request("read", peer).catch(handleError);
          }
          refreshList();
        }
        if (data.type === "read") {
          setMessages((old) =>
            old.map((m) =>
              m.sender === data.peer && m.receiver === data.reader
                ? { ...m, seen: true }
                : m,
            ),
          );
          refreshList();
        }
      },
      (ready) => {
        if (alive) setConnected(ready);
      },
    );
    realtime.current = rt;
    const visible = () => {
      if (document.visibilityState === "visible" && selectedRef.current)
        rt.request("read", selectedRef.current).catch(() => {});
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      rt.close();
      realtime.current = null;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [me?.id]);
  useEffect(() => {
    setMessages([]);
    setCanLoad(false);
    setDraft("");
    ++epoch.current;
    if (selected && me) loadHistory(selected).catch(handleError);
  }, [selected, me?.id]);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [messages.at(-1)?.id, commandResults, selected]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6500);
    return () => clearTimeout(t);
  }, [error]);
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const d = Object.fromEntries(new FormData(e.currentTarget));
    try {
      setMe(await api("/" + (register ? "register" : "login"), "POST", d));
      setError("");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function send(payload: unknown) {
    if (!selected) return;
    const target = selected;
    const m = await realtime.current!.request<Message>("send", target, payload);
    if (selectedRef.current === target)
      setMessages((old) =>
        old.some((x) => x.id === m.id) ? old : [...old, m],
      );
    await refresh();
  }
  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    if (draft.trim().startsWith("/") && !draft.trim().startsWith("//")) {
      if (!selected || !me) return;
      const line = draft.trim(),
        id = crypto.randomUUID();
      setCommandResults((old) => [
        ...old.slice(-99),
        { id, peer: selected, line, created: Date.now() / 1000, pending: true },
      ]);
      setDraft("");
      setBusy(true);
      const started = performance.now();
      try {
        if (!realtime.current) throw new Error(t("连接不可用"));
        const data = await realtime.current.request<Record<string, unknown>>(
          "command",
          "",
          { line },
        );
        setCommandResults((old) =>
          old.map((r) =>
            r.id === id
              ? {
                  ...r,
                  pending: false,
                  data:
                    line === "/ping"
                      ? {
                          ...data,
                          round_trip_ms: Math.round(
                            performance.now() - started,
                          ),
                        }
                      : data,
                }
              : r,
          ),
        );
      } catch (e) {
        setCommandResults((old) =>
          old.map((r) =>
            r.id === id
              ? {
                  ...r,
                  pending: false,
                  error: e instanceof Error ? t(e.message) : t("操作失败"),
                }
              : r,
          ),
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await send({ body: draft.startsWith("//") ? draft.slice(1) : draft });
      setDraft("");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: globalThis.File) {
    if (file.size > 20 * 1024 * 1024) throw new Error(t("文件不能超过20MB"));
    const d = new FormData();
    d.append("file", file);
    return api<{ id: string; url: string; mime: string }>("/upload", "POST", d);
  }
  async function attachment(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    try {
      const a = await upload(f);
      await send({ file_id: a.id });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function profileImage(
    e: React.ChangeEvent<HTMLInputElement>,
    field: "avatar" | "banner",
  ) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const a = await upload(f);
      if (!a.mime.startsWith("image/"))
        throw new Error(t("请使用 PNG、JPEG、GIF 或 WebP 图片"));
      setProfile((p) => (p ? { ...p, [field]: a.url } : p));
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    try {
      setMe(
        await api("/me", "PATCH", {
          ...profile,
          status: profile.preferred_status,
        }),
      );
      setModal(null);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function older() {
    if (!selected || !messages.length) return;
    const target = selected;
    try {
      const m = await api<Message[]>(
        `/messages/${target}?before=${messages[0].id}`,
      );
      if (selectedRef.current !== target) return;
      setCanLoad(m.length === 100);
      setMessages((old) => [
        ...m,
        ...old.filter((x) => !m.some((y) => y.id === x.id)),
      ]);
    } catch (e) {
      handleError(e);
    }
  }
  const filtered = friends
    .filter((f) =>
      (f.nickname + f.username + f.id + (f.remark || ""))
        .toLowerCase()
        .includes(filter.toLowerCase()),
    )
    .sort((a, b) => (b.last?.created || 0) - (a.last?.created || 0));
  if (me?.role === "admin" && adminView)
    return (
      <Admin
        me={me}
        onClose={() => {
          setAdminView(false);
          location.hash = "";
        }}
      />
    );
  if (loading)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        {t("正在连接 ScaraIM…")}
      </div>
    );
  return (
    <>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button aria-label={t("关闭提示")} onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!me ? (
        <main className="auth">
          <div className="auth-languages">
            <LanguagePicker />
          </div>
          <section className="auth-story">
            <div className="brand">
              <LinkIcon /> ScaraIM
            </div>
            <div>
              <span className="eyebrow">SMALL MOMENTS. REAL CONNECTIONS.</span>
              <h1>
                {t("让每一句，")}
                <br />
                {t("都有回应。")}
              </h1>
              <p>
                {t("聊日常，分享灵感。")}
                <br />
                {t("和在意的人，在这里保持联系。")}
              </p>
              <div className="art-chat">
                <span>{t("有个新想法，想和你分享 ✨")}</span>
                <span>{t("我在，慢慢说。")}</span>
                <div className="dots">● ● ●</div>
              </div>
            </div>
            <small>{t("你的朋友，你的空间。")}</small>
          </section>
          <section className="auth-form">
            <form onSubmit={authenticate}>
              <div className="mini-logo">
                <MessageCircle />
              </div>
              <h2>{register ? t("开始新的连接") : t("欢迎回来")}</h2>
              <p>
                {register
                  ? t("创建账号，和朋友打个招呼。")
                  : t("登录 ScaraIM，接上还没聊完的话题。")}
              </p>
              <label>
                {t("用户名")}
                <input
                  name="username"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9_]+"
                  placeholder={t("字母、数字或下划线")}
                />
              </label>
              {register && (
                <label>
                  {t("昵称")}
                  <input
                    name="nickname"
                    required
                    maxLength={32}
                    placeholder={t("希望朋友如何称呼你")}
                  />
                </label>
              )}
              <label>
                {t("密码")}
                <input
                  name="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder={t("至少 8 位密码")}
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? t("请稍候…") : register ? t("创建账号") : t("登录")}{" "}
                <span>→</span>
              </button>
              <p className="auth-switch">
                {register ? t("已经有账号？") : t("第一次来到这里？")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setRegister(!register);
                    setError("");
                  }}
                >
                  {register ? t("去登录") : t("注册账号")}
                </button>
              </p>
            </form>
          </section>
        </main>
      ) : (
        <main className={"shell " + (selected ? "has-selection" : "")}>
          <nav className="rail">
            <div className="rail-logo">
              <LinkIcon size={26} />
            </div>
            <button
              title={t("消息")}
              aria-label={t("消息")}
              className={tab === "messages" ? "active" : ""}
              onClick={() => setTab("messages")}
            >
              <MessageCircle size={23} />
              {friends.some((f) => f.unread) && <i />}
            </button>
            <button
              title={t("好友")}
              aria-label={t("好友")}
              className={tab === "friends" ? "active" : ""}
              onClick={() => setTab("friends")}
            >
              <Users size={23} />
            </button>
            {me.role === "admin" && (
              <button
                title={t("管理后台")}
                aria-label={t("管理后台")}
                onClick={() => {
                  setAdminView(true);
                  location.hash = "#admin";
                }}
              >
                <Shield size={23} />
              </button>
            )}
            <div className="rail-bottom">
              <details className="rail-language">
                <summary title="Language" aria-label="Language">
                  <Languages size={22} />
                </summary>
                <LanguagePicker />
              </details>
              <button
                title={t("个人设置")}
                aria-label={t("个人设置")}
                onClick={() => {
                  setProfile({ ...me });
                  setModal("profile");
                }}
              >
                <Settings size={22} />
              </button>
              <button
                title={t("退出登录")}
                aria-label={t("退出登录")}
                onClick={async () => {
                  try {
                    await api("/logout", "POST");
                    setMe(null);
                    setCommandResults([]);
                    setFriends([]);
                    setSelected(null);
                    setMessages([]);
                  } catch (e) {
                    handleError(e);
                  }
                }}
              >
                <LogOut size={21} />
              </button>
              <button
                className="self-avatar"
                aria-label={t("我的资料")}
                onClick={() => {
                  setProfile({ ...me });
                  setModal("profile");
                }}
              >
                <Avatar user={me} />
              </button>
            </div>
          </nav>
          <aside className="sidebar">
            <div className="sidebar-heading">
              <h1>
                {tab === "messages" ? t("消息") : t("好友")}
                <span>{friends.length}</span>
              </h1>
              <button
                className="add-button"
                title={t("添加好友")}
                aria-label={t("添加好友")}
                onClick={() => {
                  setSearch("");
                  setResults([]);
                  setModal("add");
                }}
              >
                <Plus size={20} />
              </button>
            </div>
            <label className="search">
              <Search size={17} />
              <input
                aria-label={t("搜索好友或会话")}
                placeholder={t("搜索好友或会话")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <span>⌕</span>
            </label>
            <div className="list-caption">
              {tab === "messages" ? t("全部会话") : t("我的好友")}
              <ChevronDown size={14} />
            </div>
            <div className="conversation-list">
              {filtered.map((f) => (
                <button
                  key={f.id}
                  className={
                    "conversation " + (f.id === selected ? "selected" : "")
                  }
                  onClick={() => {
                    setSelected(f.id);
                    setTab("messages");
                  }}
                >
                  <Avatar user={f} />
                  <div className="conversation-info">
                    <div>
                      <strong>{f.remark || f.nickname}</strong>
                      <time>
                        {f.last
                          ? new Date(f.last.created * 1000).toLocaleTimeString(
                              locale(),
                              { hour: "2-digit", minute: "2-digit" },
                            )
                          : ""}
                      </time>
                    </div>
                    <div>
                      <p>
                        {tab === "friends"
                          ? `@${f.username} · ${t(statuses[f.status])}`
                          : f.last
                            ? f.last.kind === "text"
                              ? f.last.body
                              : f.last.kind === "image"
                                ? t("[图片]")
                                : t("[文件] ") + f.last.body
                            : t("打个招呼，开始聊天吧")}
                      </p>
                      {!!f.unread && <b className="unread">{f.unread}</b>}
                    </div>
                  </div>
                </button>
              ))}
              {!filtered.length && (
                <div className="list-empty">
                  <Users size={30} />
                  <p>
                    {filter
                      ? t("没有找到匹配的好友")
                      : t("你的下一段对话，从这里开始")}
                  </p>
                  <button onClick={() => setModal("add")}>
                    {t("添加一位好友")}
                  </button>
                </div>
              )}
            </div>
            <div className={"connection " + (!connected ? "disconnected" : "")}>
              <i />
              {connected
                ? t("已连接 · WebSocket 实时")
                : t("连接中断，正在重试…")}
            </div>
          </aside>
          <section className="chat">
            {peer ? (
              <>
                <header className="chat-header">
                  <button
                    className="icon back"
                    aria-label={t("返回列表")}
                    onClick={() => setSelected(null)}
                  >
                    <ArrowLeft />
                  </button>
                  <Avatar user={peer} />
                  <div>
                    <h2>{peer.remark || peer.nickname}</h2>
                    <p>
                      <i className={"status-dot " + peer.status} />
                      {t(statuses[peer.status])}
                      <span>{t("私人聊天")}</span>
                    </p>
                  </div>
                  <button
                    className="icon detail-button"
                    title={t("好友资料")}
                    aria-label={t("好友资料")}
                    onClick={() => {
                      setRemark(peer.remark || "");
                      setModal("detail");
                    }}
                  >
                    <Users size={20} />
                  </button>
                </header>
                <div className="message-area">
                  {canLoad && (
                    <button className="load-more" onClick={older}>
                      {t("加载更早消息")}
                    </button>
                  )}
                  <div className="chat-start">
                    <Avatar user={peer} large />
                    <h3>{peer.nickname}</h3>
                    <p>{t("这是你们的私人对话，打个招呼吧。")}</p>
                  </div>
                  {[
                    ...messages,
                    ...commandResults.filter((r) => r.peer === selected),
                  ]
                    .sort((a, b) => a.created - b.created)
                    .map((m, i, timeline) =>
                      "line" in m ? (
                        <article
                          className="inline-command"
                          key={m.id}
                          aria-live="polite"
                          aria-busy={m.pending}
                        >
                          <header>
                            <Terminal size={15} />
                            <code>{m.line}</code>
                            <small>{t("仅自己可见")}</small>
                          </header>
                          {m.pending ? (
                            <LoaderCircle
                              className="command-spinner"
                              size={18}
                            />
                          ) : m.error ? (
                            <p role="alert">{m.error}</p>
                          ) : m.line === "/sysinfo" || m.line === "/stats" ? (
                            <SystemGrid stats={m.data} />
                          ) : (
                            <pre>{JSON.stringify(m.data, null, 2)}</pre>
                          )}
                        </article>
                      ) : (
                        <React.Fragment key={m.id}>
                          {(i === 0 ||
                            new Date(
                              timeline[i - 1].created * 1000,
                            ).toDateString() !==
                              new Date(m.created * 1000).toDateString()) && (
                            <div className="date-divider">
                              <span>
                                {new Date(m.created * 1000).toLocaleDateString(
                                  locale(),
                                  { month: "long", day: "numeric" },
                                )}
                              </span>
                            </div>
                          )}
                          <div
                            className={
                              "message " + (m.sender === me.id ? "mine" : "")
                            }
                          >
                            <Avatar user={m.sender === me.id ? me : peer} />
                            <div className="message-content">
                              <div className="bubble">
                                {m.forwarded && (
                                  <div className="forward-label">
                                    <Forward size={13} />
                                    {t("转发的消息")}
                                  </div>
                                )}
                                {m.kind === "text" ? (
                                  <p>{m.body}</p>
                                ) : m.kind === "image" ? (
                                  <a
                                    href={"/api/files/" + m.file_id}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <img
                                      className="message-image"
                                      src={"/api/files/" + m.file_id}
                                      alt={m.body}
                                    />
                                  </a>
                                ) : (
                                  <a
                                    className="file-message"
                                    href={"/api/files/" + m.file_id}
                                    download={m.body}
                                  >
                                    <File size={30} />
                                    <div>
                                      <strong>{m.body}</strong>
                                      <small>{t("点击下载文件")}</small>
                                    </div>
                                    <span>↓</span>
                                  </a>
                                )}
                              </div>
                              <div className="message-meta">
                                <time>
                                  {new Date(
                                    m.created * 1000,
                                  ).toLocaleTimeString(locale(), {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </time>
                                {m.sender === me.id && (
                                  <span
                                    title={m.seen ? t("已读") : t("已发送")}
                                  >
                                    <CheckCheck
                                      size={13}
                                      color={m.seen ? "#7660d0" : "#aaa"}
                                    />
                                  </span>
                                )}
                                <button
                                  title={t("转发消息")}
                                  aria-label={t("转发消息")}
                                  onClick={() => {
                                    setForward(m);
                                    setModal("forward");
                                  }}
                                >
                                  <Forward size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </React.Fragment>
                      ),
                    )}
                  <div ref={end} />
                </div>
                <form className="composer" onSubmit={sendText}>
                  <div className="composer-tools">
                    <button
                      type="button"
                      className="icon"
                      title={t("发送图片")}
                      aria-label={t("发送图片")}
                      disabled={busy}
                      onClick={() => imageInput.current?.click()}
                    >
                      <ImageIcon size={21} />
                    </button>
                    <button
                      type="button"
                      className="icon"
                      title={t("发送文件")}
                      aria-label={t("发送文件")}
                      disabled={busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip size={21} />
                    </button>
                    <span>{t("分享一点今天的新鲜事")}</span>
                  </div>
                  {draft.startsWith("/") && (
                    <div className="command-suggestions">
                      {["ping", "sysinfo", "help"].map((c) => (
                        <button
                          type="button"
                          key={c}
                          onClick={() => setDraft("/" + c)}
                        >
                          /{c}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    aria-label={t("消息内容")}
                    placeholder={t("消息内容") + " /"}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <footer>
                    <span>{t("Enter 发送 · Shift + Enter 换行")}</span>
                    <button
                      className="primary"
                      title={t("发送")}
                      aria-label={t("发送")}
                      disabled={busy || !draft.trim()}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : null}
                      <Send size={16} />
                    </button>
                  </footer>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    onChange={attachment}
                  />
                  <input
                    ref={imageInput}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    onChange={attachment}
                  />
                </form>
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-icon">
                  <MessageCircle size={48} />
                  <span>✦</span>
                </div>
                <span className="eyebrow">YOUR EVERYDAY CONNECTION</span>
                <h2>
                  {t("好久不见，")}
                  {me.nickname}
                </h2>
                <p>
                  {t("选一位朋友，开始今天的第一句问候。")}
                  <br />
                  {t("文字、照片，或是想分享的一切。")}
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setSearch("");
                    setResults([]);
                    setModal("add");
                  }}
                >
                  <UserPlus size={18} />
                  {t("添加好友")}
                </button>
                <small>{t("每一次连接，都从一句「你好」开始")}</small>
              </div>
            )}
          </section>
        </main>
      )}
      {modal === "add" && (
        <Modal
          error={error}
          title={t("发现新朋友")}
          onClose={() => setModal(null)}
        >
          <p className="muted">{t("输入用户名、用户 ID 或昵称查找朋友。")}</p>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setResults(await api("/users?q=" + encodeURIComponent(search)));
              } catch (e) {
                handleError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              aria-label={t("查找用户")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("用户名 / ID / 昵称")}
              required
            />
            <button className="primary" disabled={busy}>
              {t("查找")}
            </button>
          </form>
          <div className="results">
            {results.map((u) => (
              <div className="result" key={u.id}>
                <Avatar user={u} />
                <div>
                  <strong>{u.nickname}</strong>
                  <small>@{u.username}</small>
                </div>
                <button
                  className="secondary"
                  disabled={busy || friends.some((f) => f.id === u.id)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api("/friends/" + u.id, "POST");
                      await refresh();
                      setSelected(u.id);
                      setModal(null);
                    } catch (e) {
                      handleError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {friends.some((f) => f.id === u.id) ? t("已添加") : t("添加")}
                </button>
              </div>
            ))}
            {!results.length && (
              <p className="empty-hint">{t("搜索结果会显示在这里")}</p>
            )}
          </div>
        </Modal>
      )}
      {modal === "profile" && profile && (
        <Modal
          error={error}
          title={t("我的资料")}
          onClose={() => setModal(null)}
        >
          <form onSubmit={saveProfile}>
            <div
              className="profile-banner"
              style={
                profile.banner
                  ? { backgroundImage: `url("${profile.banner}")` }
                  : undefined
              }
            >
              <label className="upload-label">
                {t("更换横幅")}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => profileImage(e, "banner")}
                />
              </label>
            </div>
            <div className="profile-avatar">
              <Avatar user={profile} large />
              <label className="text-button">
                {t("更换头像")}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => profileImage(e, "avatar")}
                />
              </label>
            </div>
            <label>
              {t("用户 ID")}
              <input readOnly value={profile.id} />
            </label>
            <label>
              {t("用户名")}
              <input readOnly value={profile.username} />
            </label>
            <label>
              {t("昵称")}
              <input
                required
                maxLength={32}
                value={profile.nickname}
                onChange={(e) =>
                  setProfile({ ...profile, nickname: e.target.value })
                }
              />
            </label>
            <label>
              {t("在线状态")}
              <select
                value={profile.preferred_status}
                onChange={(e) =>
                  setProfile({ ...profile, preferred_status: e.target.value })
                }
              >
                {Object.entries(statuses).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <div className="badges">
              {profile.badge_details?.map((b) => (
                <img
                  className="user-badge"
                  key={b.id}
                  src={b.image}
                  alt={b.name}
                  title={b.name + " · " + b.id}
                />
              ))}
              {profile.badges.map((b) => (
                <span key={b}>✦ {t(b)}</span>
              ))}
            </div>
            <button className="primary full" disabled={busy}>
              {t("保存资料")}
            </button>
          </form>
        </Modal>
      )}
      {modal === "detail" && peer && (
        <Modal
          error={error}
          title={t("好友资料")}
          onClose={() => setModal(null)}
        >
          <div
            className="profile-banner"
            style={
              peer.banner
                ? { backgroundImage: `url("${peer.banner}")` }
                : undefined
            }
          />
          <div className="profile-avatar">
            <Avatar user={peer} large />
            <div>
              <h3>{peer.nickname}</h3>
              <small>
                @{peer.username} · {t(statuses[peer.status])}
              </small>
            </div>
          </div>
          <label>
            {t("用户 ID")}
            <input value={peer.id} readOnly />
          </label>
          <div className="badges">
            {peer.badge_details?.map((b) => (
              <img
                className="user-badge"
                key={b.id}
                src={b.image}
                alt={b.name}
                title={b.name + " · " + b.id}
              />
            ))}
            {peer.badges.map((b) => (
              <span key={b}>✦ {t(b)}</span>
            ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/friends/" + peer.id, "PATCH", { remark });
                await refresh();
                setModal(null);
              } catch (e) {
                handleError(e);
              }
            }}
          >
            <label>
              {t("好友备注")}
              <input
                value={remark}
                maxLength={64}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("给朋友起个专属名字")}
              />
            </label>
            <button className="primary full">
              <Pencil size={16} />
              {t("保存备注")}
            </button>
          </form>
          <button
            className="danger full"
            onClick={async () => {
              if (
                !confirm(
                  t("确定删除这位好友？双方好友关系会解除，历史消息仍会保留。"),
                )
              )
                return;
              try {
                await api("/friends/" + peer.id, "DELETE");
                setSelected(null);
                await refresh();
                setModal(null);
              } catch (e) {
                handleError(e);
              }
            }}
          >
            <Trash2 size={16} />
            {t("删除好友")}
          </button>
        </Modal>
      )}
      {modal === "forward" && forward && (
        <Modal
          error={error}
          title={t("转发给好友")}
          onClose={() => setModal(null)}
        >
          <blockquote>
            {forward.kind === "text"
              ? forward.body
              : `[${forward.kind === "image" ? t("图片") : t("文件")}] ${forward.body}`}
          </blockquote>
          <div className="results">
            {friends.map((f) => (
              <button
                className="result forward-target"
                key={f.id}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await realtime.current!.request("send", f.id, {
                      forward_id: forward.id,
                    });
                    setSelected(f.id);
                    await refresh();
                    setModal(null);
                  } catch (e) {
                    handleError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Avatar user={f} />
                <strong>{f.remark || f.nickname}</strong>
                <Forward size={17} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import "./admin.css";
