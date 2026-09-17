export const API_BASE = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function request(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    const onPages = typeof location !== "undefined" && /\.github\.io$/i.test(location.hostname);
    throw new Error(
      onPages && !API_BASE
        ? "Ba’s server is not connected to this GitHub Pages site yet."
        : "Can't reach the room."
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed.");
    err.needSetup = Boolean(data.needSetup);
    throw err;
  }
  return data;
}

export function enterRoom(body) {
  return request("/api/enter", { method: "POST", body });
}

export function setIdentity(token, who) {
  return request("/api/identity", { method: "POST", token, body: { who } });
}

export function loadMe(token) {
  return request("/api/me", { token });
}

export function loadCloud(token) {
  return request("/api/data", { token });
}

export function saveCloud(token, body) {
  return request("/api/data", { method: "PUT", token, body });
}

export function logoutCloud(token, deviceId) {
  return request("/api/logout", {
    method: "POST",
    token,
    body: deviceId ? { deviceId } : {},
  }).catch(() => {});
}

export function deleteAccount(token, code) {
  return request("/api/account", { method: "DELETE", token, body: { code } });
}

export function loadChat(token) {
  return request("/api/chat", { token });
}

export function sendChat(token, body) {
  return request("/api/chat", { method: "POST", token, body });
}

export function readChat(token) {
  return request("/api/chat/read", { method: "POST", token, body: {} });
}

export function updateChat(token, id, body) {
  return request(`/api/chat/${id}`, { method: "PUT", token, body });
}

export function removeChat(token, id) {
  return request(`/api/chat/${id}`, { method: "DELETE", token });
}

export function clearChat(token) {
  return request("/api/chat", { method: "DELETE", token, body: { confirm: true } });
}

export function typingChat(token, on) {
  return request("/api/chat/typing", { method: "POST", token, body: { on: Boolean(on) } }).catch(() => {});
}

export function pingPresence(token) {
  return request("/api/presence", { method: "POST", token, body: {} }).catch(() => {});
}

export function sendSignal(token, body) {
  return request("/api/signal", { method: "POST", token, body });
}

export function loadSignals(token) {
  return request("/api/signal", { token });
}

export function setDisappear(token, ms) {
  return request("/api/disappear", { method: "POST", token, body: { ms } });
}

export function sendStatus(token, body) {
  return request("/api/status", { method: "POST", token, body });
}

export function loadPlaces(token) {
  return request("/api/location", { token });
}

export function sendPlace(token, body) {
  return request("/api/location", { method: "POST", token, body });
}

export function registerPushToken(token, body) {
  return request("/api/push-token", { method: "POST", token, body });
}
