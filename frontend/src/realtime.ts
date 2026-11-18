export class Realtime {
  private ws?: WebSocket;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private pending = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private event: (data: any) => void,
    private status: (ready: boolean) => void,
  ) {
    this.connect();
  }
  private connect() {
    if (this.stopped) return;
    const ws = (this.ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/ws`,
    ));
    const alive = () => {
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(() => ws.close(), 40000);
    };
    ws.onopen = alive;
    ws.onmessage = (e) => {
      if (this.stopped) return;
      const data = JSON.parse(e.data);
      alive();
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (data.type === "ready") {
        this.attempts = 0;
        this.status(true);
      }
      const pending = this.pending.get(data.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(data.request_id);
        data.type === "error"
          ? pending.reject(new Error(data.error))
          : pending.resolve(data.data);
      } else this.event(data);
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      clearTimeout(this.watchdog);
      this.status(false);
      if (!this.stopped && typeof window !== "undefined")
        fetch("/api/me")
          .then((r) => {
            if (r.status === 401 && !this.stopped)
              window.dispatchEvent(new Event("scaraim:unauthorized"));
          })
          .catch(() => {});
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          new Error("连接中断，发送结果未确认；重连后请检查聊天记录再重发"),
        );
      }
      this.pending.clear();
      if (!this.stopped)
        this.retry = setTimeout(
          () => this.connect(),
          Math.min(1000 * 2 ** this.attempts++, 15000),
        );
    };
  }
  request<T = any>(
    type: string,
    target: string,
    payload?: unknown,
  ): Promise<T> {
    if (this.ws?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("实时连接尚未就绪，请稍后重试"));
    const request_id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        reject(new Error("服务器未确认发送结果，请检查聊天记录后再重试"));
        this.ws?.close();
      }, 15000);
      this.pending.set(request_id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type, target, payload, request_id }));
    });
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.watchdog);
    this.ws?.close();
  }
}
