export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

// 401 回调：由 App.jsx 注册，避免 apiFetch 直接操作页面跳转
let onUnauthorized = null;
export function setOnUnauthorized(cb) { onUnauthorized = cb; }

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `请求失败 (${status})`);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  // 有 body 且非 FormData 时设置 Content-Type
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  const res = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
  }
  return res;
}

// 带自动错误处理的 fetch：非 2xx 时抛出 ApiError
export async function apiFetchJson(url, options = {}) {
  const res = await apiFetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
