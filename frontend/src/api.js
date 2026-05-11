export function isLoggedIn() {
  return document.cookie.split(";").some(c => c.trim().startsWith("token="));
}

export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

// 401 回调：由 App.jsx 注册，避免 apiFetch 直接操作页面跳转
let onUnauthorized = null;
export function setOnUnauthorized(cb) { onUnauthorized = cb; }

export async function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  // 有 body 且非 FormData 时设置 Content-Type
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  const res = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401) {
    // 通知 App 清除用户状态回到登录页，而非 reload
    if (onUnauthorized) onUnauthorized();
    return res;
  }
  return res;
}
