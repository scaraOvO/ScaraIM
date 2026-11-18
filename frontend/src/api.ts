import { t } from "./i18n";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "Content-Type": "application/json" }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r
    .json()
    .catch(() => ({ error: t("服务暂时不可用，请检查后端是否启动") }));
  if (r.status === 401) window.dispatchEvent(new Event("scaraim:unauthorized"));
  if (!r.ok) throw new Error(t(data.error || "操作失败"));
  return data;
}
export async function upload(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error(t("文件不能超过20MB"));
  const form = new FormData();
  form.append("file", file);
  return api<{ id: string; url: string; mime: string }>(
    "/upload",
    "POST",
    form,
  );
}
