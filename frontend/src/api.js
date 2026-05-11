export function isLoggedIn() {
  return document.cookie.split(";").some(c => c.trim().startsWith("token="));
}

export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  // 有 body 且非 FormData 时设置 Content-Type
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  const res = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (res.status === 401) {
    window.location.reload();
    return res;
  }
  return res;
}
