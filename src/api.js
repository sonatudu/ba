const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

async function request(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export function registerUser(body) {
  return request("/api/register", { method: "POST", body });
}

export function loginUser(body) {
  return request("/api/login", { method: "POST", body });
}

export function sendRequest(token, body) {
  return request("/api/requests", { method: "POST", token, body });
}

export function listRequests(token) {
  return request("/api/requests", { token });
}

export function acceptRequest(token, id) {
  return request(`/api/requests/${id}/accept`, { method: "POST", token });
}

export function declineRequest(token, id) {
  return request(`/api/requests/${id}/decline`, { method: "POST", token });
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

export function logoutCloud(token) {
  return request("/api/logout", { method: "POST", token }).catch(() => {});
}

export function deleteAccount(token, password) {
  return request("/api/account", { method: "DELETE", token, body: { password } });
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
