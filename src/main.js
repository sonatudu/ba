import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { API_BASE, enterRoom, loadChat, loadCloud, loadMe, loadPlaces, loadSignals, logoutCloud, pingPresence, readChat, removeChat, clearChat, saveCloud, sendChat, sendPlace, sendSignal, typingChat, updateChat } from "./api.js";
import { decryptPayload, deriveSpaceKey, encryptPayload } from "./crypto.js";
import { drawFamilyLines, ensureFamilyTree, familyTreeHtml, mapPerson, missingLockFlags, removePerson } from "./familyTree.js";
import { routineHtml } from "./routine.js";

const SESSION_KEY = "ba-session-v2";
const DEVICE_KEY = "ba-device-v1";
const SETUP_KEY = "ba-setup-v1";
const WHO_KEY = "ba-who-v1";
const THEME_KEY = "ba-theme-v1";
const SHARE_LOC_KEY = "ba-share-loc";
const LAST_PIN_KEY = "ba-last-pin";
const KEEP_MS = 24 * 60 * 60 * 1000;

function readSavedWho() {
  try {
    const who = String(localStorage.getItem(WHO_KEY) || "").trim().toLowerCase();
    if (who === "ba" || who === "ma") return who;
  } catch {
    /* ignore */
  }
  try {
    const match = String(document.cookie || "").match(/(?:^|; )ba-who-v1=(ba|ma)/);
    if (match) return match[1];
  } catch {
    /* ignore */
  }
  return "";
}

function saveWho(who) {
  if (who !== "ba" && who !== "ma") return;
  try {
    localStorage.setItem(WHO_KEY, who);
  } catch {
    /* ignore */
  }
  try {
    document.cookie = `${WHO_KEY}=${who}; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

function coupleId(value) {
  const who = String(value || "").trim().toLowerCase();
  return who === "ba" || who === "ma" ? who : "";
}

function selfId() {
  return coupleId(session?.username) || readSavedWho();
}

function partnerId() {
  return selfId() === "ma" ? "ba" : "ma";
}

function isMine(from) {
  const me = selfId();
  const who = coupleId(from);
  return Boolean(me && who && who === me);
}

function chatSeenKey() {
  return `ba-chat-seen:${session?.roomId || ""}:${session?.username || ""}`;
}

function sectionSeenKey() {
  return `ba-section-seen:${session?.roomId || ""}:${session?.username || ""}`;
}

const CONTENT_SECTIONS = ["today", "memories", "us", "todo", "family", "poke"];

function sectionSigs(source) {
  const s = source || state;
  return {
    today: JSON.stringify(s.notes || []),
    memories: JSON.stringify(s.dates || []),
    us: String(s.startedOn || ""),
    todo: JSON.stringify(s.todos || []),
    family: JSON.stringify(s.familyTree || s.family || null),
    poke: JSON.stringify(s.pokes || []),
  };
}

function patchSections(patch) {
  const ids = [];
  if ("notes" in patch) ids.push("today");
  if ("dates" in patch) ids.push("memories");
  if ("startedOn" in patch) ids.push("us");
  if ("todos" in patch) ids.push("todo");
  if ("familyTree" in patch || "family" in patch) ids.push("family");
  if ("pokes" in patch) ids.push("poke");
  return ids;
}

function loadSectionSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(sectionSeenKey()) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSectionSeen(seen) {
  try {
    localStorage.setItem(sectionSeenKey(), JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

function otherPlaceSig() {
  return wherePins()
    .filter((pin) => pin.id !== deviceId())
    .map((pin) => `${pin.id}:${Number(pin.at) || 0}:${Number(pin.lat)}:${Number(pin.lng)}`)
    .sort()
    .join("|");
}

function rememberOwnSections(ids) {
  if (!ids.length) return;
  const seen = loadSectionSeen();
  const sig = sectionSigs(state);
  ids.forEach((id) => {
    seen[id] = sig[id];
    sectionUnread[id] = false;
  });
  saveSectionSeen(seen);
}

function markSectionSeen(id) {
  const key = id === "dates" ? "memories" : id;
  if (key === "chat" || key === "routine" || key === "settings" || key === "home") return;
  const seen = loadSectionSeen();
  if (key === "where") seen.where = otherPlaceSig();
  else seen[key] = sectionSigs(state)[key];
  sectionUnread[key] = false;
  saveSectionSeen(seen);
  setHomeBadges();
}

function seedSectionSeen() {
  const seen = loadSectionSeen();
  const sig = sectionSigs(state);
  CONTENT_SECTIONS.forEach((id) => {
    if (seen[id] == null) seen[id] = sig[id];
    else if (seen[id] !== sig[id]) sectionUnread[id] = true;
  });
  const place = otherPlaceSig();
  if (seen.where == null) seen.where = place;
  else if (place && seen.where !== place) sectionUnread.where = true;
  saveSectionSeen(seen);
}

function loadChatSeen() {
  try {
    return Number(localStorage.getItem(chatSeenKey()) || 0) || 0;
  } catch {
    return 0;
  }
}

function markChatSeen(at = Date.now()) {
  const next = Math.max(chatSeenAt, Number(at) || 0);
  if (next <= chatSeenAt) return;
  chatSeenAt = next;
  try {
    localStorage.setItem(chatSeenKey(), String(chatSeenAt));
  } catch {
    /* ignore */
  }
}

function unreadFromMessages(messages, since) {
  if (!selfId()) return 0;
  const now = Date.now();
  return messages.filter((item) => {
    if (isMine(item.from)) return false;
    if (!item.kept && now - Number(item.at || 0) >= KEEP_MS) return false;
    return Number(item.at) > since;
  }).length;
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function readTheme() {
  try {
    const next = localStorage.getItem(THEME_KEY);
    if (next === "day" || next === "night") return next;
  } catch {
    /* ignore */
  }
  return "night";
}

function applyTheme(theme) {
  const next = theme === "day" ? "day" : "night";
  const root = document.documentElement;
  root.classList.toggle("theme-day", next === "day");
  root.classList.toggle("theme-night", next === "night");
  document.body.classList.toggle("theme-day", next === "day");
  document.body.classList.toggle("theme-night", next === "night");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === "day" ? "#eef2f8" : "#070b16";
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: next === "day" ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: next === "day" ? "#eef2f8" : "#070b16" }).catch(() => {});
  }
}

function setTheme(theme) {
  const next = theme === "day" ? "day" : "night";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  applyTheme(next);
  applyWhereMapStyle();
}

applyTheme(readTheme());

async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    applyTheme(readTheme());
    await SplashScreen.hide();
  } catch {
    /* web and some emulators skip this */
  }
}

const QUESTIONS = [
  "What made you smile about us this week?",
  "If we had a free Saturday, where would you take me?",
  "What is a tiny habit of mine you secretly love?",
  "Which song should be ours right now?",
  "What is something you want us to try once?",
  "When did you feel closest to me lately?",
  "What should our next comfort dinner be?",
  "If we wrote a postcard from today, what would it say?",
  "What is a dream you want me to take more seriously?",
  "How do you want to be cared for when you are tired?",
  "What memory should we replay out loud tonight?",
  "If we had one hour with no phones, what would we do?",
];

const KEPT_DATES = [
  { id: "kept-approach", date: "2020-10-12", text: "Approach" },
  { id: "kept-ba-bday", date: "2000-01-30", text: "Ba's B'day", noYear: true },
  { id: "kept-ma-bday", date: "2000-03-15", text: "Ma's B'day", noYear: true },
  { id: "kept-proposal", date: "2021-03-19", text: "Proposal" },
  { id: "kept-bike", date: "2024-07-22", text: "Bike riding" },
  { id: "kept-chakulia", date: "2025-05-25", text: "Chakulia" },
  { id: "kept-kgp", date: "2025-07-17", text: "Kgp" },
  { id: "kept-bagdah", date: "2025-12-25", text: "Bagdah" },
  { id: "kept-dimna", date: "2026-06-27", text: "Dimna Lake" },
  { id: "kept-sung", date: "2026-07-07", text: "Sung Inn" },
];

function mergeKeptDates(list) {
  const next = Array.isArray(list) ? [...list] : [];
  const have = new Set(next.map((item) => item.id));
  for (const row of KEPT_DATES) {
    if (have.has(row.id)) continue;
    next.push({ ...row, at: Date.parse(`${row.date}T12:00:00`) || Date.now() });
  }
  return next;
}

function statusNote(value) {
  if (value && typeof value === "object") {
    return { text: String(value.text || ""), who: String(value.who || ""), at: Number(value.at || 0) };
  }
  return { text: String(value || ""), who: "", at: 0 };
}

const defaultState = () => ({
  you: "Ba",
  them: "Ma",
  startedOn: "",
  nextDate: "",
  notes: [],
  dates: [],
  moods: [],
  water: { text: "", who: "", at: 0 },
  mood: { text: "", who: "", at: 0 },
  memories: [],
  answers: [],
  pokes: [],
  thanks: [],
  songs: [],
  sealed: [],
  promises: [],
  family: [],
  familyTree: null,
  todos: [],
  checkins: [],
});

function contentState(value) {
  const source = value || defaultState();
  return {
    you: source.you || "Ba",
    them: source.them || "Ma",
    startedOn: source.startedOn || "",
    nextDate: source.nextDate || "",
    notes: source.notes || [],
    dates: mergeKeptDates(source.dates),
    moods: source.moods || [],
    water: statusNote(source.water),
    mood: statusNote(source.mood),
    memories: source.memories || [],
    answers: source.answers || [],
    pokes: source.pokes || [],
    thanks: source.thanks || [],
    songs: source.songs || [],
    sealed: source.sealed || [],
    promises: source.promises || [],
    family: source.family || [],
    familyTree: source.familyTree || null,
    todos: source.todos || [],
    checkins: source.checkins || [],
  };
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.token && parsed?.username) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function saveSession(next) {
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
}

function currentName() {
  return session?.who === "them" ? state.them : state.you;
}

function uid() {
  return crypto.randomUUID();
}

function fmt(date) {
  if (!date) return "";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysTogether(startedOn) {
  if (!startedOn) return 0;
  const start = new Date(`${startedOn}T12:00:00`);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((now - start) / 86400000));
}

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dayKey(value) {
  const stamp = typeof value === "number" ? new Date(value) : new Date(`${value}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  return `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
}

function checkedInToday() {
  const me = currentName();
  const today = isoToday();
  return (state.checkins || []).some((item) => item.who === me && dayKey(item.at) === today);
}

function checkinStreak() {
  const days = new Set((state.checkins || []).map((item) => dayKey(item.at)));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

const MONTHS = [
  ["01", "January"],
  ["02", "February"],
  ["03", "March"],
  ["04", "April"],
  ["05", "May"],
  ["06", "June"],
  ["07", "July"],
  ["08", "August"],
  ["09", "September"],
  ["10", "October"],
  ["11", "November"],
  ["12", "December"],
];

function datePickerHtml(name, iso = "", { required = false, future = false, minYear = 1980, maxYear: maxYearOpt } = {}) {
  const now = new Date().getFullYear();
  const maxYear = Number(maxYearOpt) || (future ? now + 8 : now);
  const [year = "", month = "", day = ""] = iso ? iso.split("-") : [];
  const years = [];
  const top = Math.max(maxYear, Number(year) || 0, now);
  for (let y = top; y >= minYear; y -= 1) years.push(y);
  return `
    <div class="date-picker" data-date-name="${name}">
      <select data-part="y" aria-label="Year"${required ? " required" : ""}>
        <option value="">Year</option>
        ${years.map((y) => `<option value="${y}" ${String(y) === year ? "selected" : ""}>${y}</option>`).join("")}
      </select>
      <select data-part="m" aria-label="Month"${required ? " required" : ""}>
        <option value="">Month</option>
        ${MONTHS.map(([value, label]) => `<option value="${value}" ${value === month ? "selected" : ""}>${label.slice(0, 3)}</option>`).join("")}
      </select>
      <select data-part="d" aria-label="Day"${required ? " required" : ""}>
        <option value="">Day</option>
        ${Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"))
          .map((d) => `<option value="${d}" ${d === day ? "selected" : ""}>${Number(d)}</option>`)
          .join("")}
      </select>
    </div>
  `;
}

function readDatePicker(root, name) {
  const box = root.querySelector(`[data-date-name="${name}"]`);
  const y = box.querySelector('[data-part="y"]').value;
  const m = box.querySelector('[data-part="m"]').value;
  const d = box.querySelector('[data-part="d"]').value;
  if (!y || !m || !d) return "";
  const stamp = new Date(`${y}-${m}-${d}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  return `${y}-${m}-${String(stamp.getDate()).padStart(2, "0")}`;
}

function todayQuestion() {
  const day = Math.floor(Date.now() / 86400000);
  return QUESTIONS[day % QUESTIONS.length];
}

function el(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function partnerUsername() {
  return partnerId();
}

function otherStamp(map) {
  const me = selfId();
  let max = 0;
  for (const [name, value] of Object.entries(map || {})) {
    if (coupleId(name) !== me) max = Math.max(max, Number(value) || 0);
  }
  return max;
}

function receiptOf(item, mine) {
  if (item.pending) return "sent";
  const readAt = mine ? otherStamp(chatReadAt) : Number(chatReadAt[selfId()] || 0);
  const deliveredAt = mine ? otherStamp(chatDeliveredAt) : Number(chatDeliveredAt[selfId()] || 0);
  if (readAt >= item.at) return "seen";
  if (deliveredAt >= item.at) return "delivered";
  return "sent";
}

const RECEIPT_BG = {
  sent: "#8b95a1",
  delivered: "#f97316",
  seen: "#4ade80",
};

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtAgo(ms) {
  const t = Number(ms || 0);
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))} h ago`;
  return new Date(t).toLocaleString();
}

function chatDayLabel(ms) {
  const day = dayKey(ms);
  const today = isoToday();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === today) return "Today";
  if (day === dayKey(y.getTime())) return "Yesterday";
  return fmt(day);
}

function stopChatLoop() {
  window.clearInterval(chatTimer);
  chatTimer = 0;
}

function chatPollMs() {
  if (document.hidden) return 8000;
  if (tab === "chat" || callState) return 1800;
  if (tab === "where") return 2500;
  return 4000;
}

function startChatLoop() {
  stopChatLoop();
  if (!session?.token || !session.roomId) return;
  syncChat().catch(() => {});
  syncCloud().catch(() => {});
  syncPlaces().catch(() => {});
  pingPresence(session.token);
  pullSignals().catch(() => {});
  const tick = () => {
    chatTimer = window.setTimeout(() => {
      syncChat().catch(() => {});
      syncCloud().catch(() => {});
      syncPlaces().catch(() => {});
      pingPresence(session.token);
      pullSignals().catch(() => {});
      tick();
    }, chatPollMs());
  };
  tick();
}

document.addEventListener("visibilitychange", () => {
  if (!session?.token) return;
  startChatLoop();
});

function setHomeBadges() {
  document.querySelectorAll("[data-go]").forEach((button) => {
    const id = button.dataset.go === "dates" ? "memories" : button.dataset.go;
    const on = id === "chat" ? chatUnread > 0 : Boolean(sectionUnread[id]);
    button.classList.toggle("has-unread", on);
  });
  document.querySelector("[data-poke]")?.classList.toggle("has-unread", Boolean(sectionUnread.poke));
}

function setChatBadge() {
  setHomeBadges();
}

const decryptCache = new Map();

function cacheGet(key) {
  const hit = decryptCache.get(key);
  if (hit) {
    decryptCache.delete(key);
    decryptCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key, value) {
  decryptCache.set(key, value);
  while (decryptCache.size > 240) decryptCache.delete(decryptCache.keys().next().value);
}

async function decodeChatRows(rows) {
  const out = [];
  for (const row of rows || []) {
    const key = `${row.id}:${row.iv}:${String(row.blob || "").length}:${String(row.blob || "").slice(-24)}`;
    const cached = cacheGet(key);
    if (cached) {
      if (!cached.deleted) out.push(cached);
      continue;
    }
    let opened = {};
    try {
      opened = (await decryptPayload(spaceKey, row.iv, row.blob)) || {};
    } catch {
      opened = {};
    }
    const image = typeof opened.image === "string" && /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(opened.image)
      ? opened.image
      : "";
    const audio = typeof opened.audio === "string" && opened.audio.startsWith("data:audio/") ? opened.audio : "";
    const item = {
      id: row.id,
      from: coupleId(row.from) || coupleId(opened.from) || row.from,
      at: row.at,
      text: String(opened.text || ""),
      type: opened.type || (image ? "image" : audio ? "voice" : "text"),
      image,
      audio,
      duration: Number(opened.duration || 0),
      lat: opened.lat,
      lng: opened.lng,
      poll: opened.poll || null,
      viewOnce: Boolean(opened.viewOnce),
      viewed: Boolean(opened.viewed),
      edited: Boolean(opened.edited),
      pinned: Boolean(opened.pinned),
      replyId: String(opened.replyId || ""),
      replyText: String(opened.replyText || ""),
      replyFrom: String(opened.replyFrom || ""),
      reactions: opened.reactions && typeof opened.reactions === "object" ? opened.reactions : {},
      deleted: Boolean(opened.deleted),
      kept: Boolean(opened.kept || opened.pinned),
    };
    cacheSet(key, item);
    if (!item.deleted) out.push(item);
  }
  return out;
}

function chatPayload(item) {
  return {
    text: item.text || "",
    type: item.type || "text",
    image: item.image || "",
    audio: item.audio || "",
    duration: item.duration || 0,
    lat: item.lat,
    lng: item.lng,
    poll: item.poll || null,
    viewOnce: Boolean(item.viewOnce),
    viewed: Boolean(item.viewed),
    edited: Boolean(item.edited),
    pinned: Boolean(item.pinned),
    kept: Boolean(item.kept),
    replyId: item.replyId || "",
    replyText: item.replyText || "",
    replyFrom: item.replyFrom || "",
    reactions: item.reactions || {},
    deleted: Boolean(item.deleted),
  };
}

function previewChat(item) {
  if (!item) return "";
  if (item.deleted) return "";
  if (item.type === "voice") return "Voice message";
  if (item.type === "location") return "Location";
  if (item.type === "poll") return item.poll?.question || "Poll";
  if (item.image && !item.text) return item.viewOnce ? "View once photo" : "Photo";
  return item.text || "";
}

function visibleChatLog() {
  let rows = chatLog.filter((item) => !item.deleted);
  rows = rows.filter((item) => item.kept || Date.now() - item.at < KEEP_MS);
  if (chatQuery) {
    const q = chatQuery.toLowerCase();
    rows = rows.filter((item) => (item.text || "").toLowerCase().includes(q));
  }
  return rows;
}

async function persistChatItem(item) {
  const sealed = await encryptPayload(spaceKey, chatPayload(item));
  await updateChat(session.token, item.id, sealed);
}

async function syncChat() {
  if (!session?.token || !session.roomId || !spaceKey || chatDragging) return;
  const payload = await loadChat(session.token);
  const next = await decodeChatRows(payload.messages);
  const before = chatLog.map((item) => item.id).join(",");
  const after = next.map((item) => item.id).join(",");
  const newFromThem = next.filter((item) => coupleId(item.from) === partnerId() && !chatLog.some((old) => old.id === item.id));
  const keptIds = new Set(chatLog.filter((item) => item.kept).map((item) => item.id));
  chatLog = next.map((item) => (keptIds.has(item.id) ? { ...item, kept: true } : item));
  chatReadAt = payload.readAt || {};
  chatDeliveredAt = payload.deliveredAt || {};
  chatTyping = Boolean(payload.typing);
  chatPartnerOnline = Boolean(payload.online);
  chatPartnerSeen = Number(payload.lastSeen || 0);
  chatDisappearMs = Number(payload.disappearMs || 0);
  if (payload.incomingCall?.data && !callState) {
    pendingOffer = payload.incomingCall.data;
    callVideo = Boolean(payload.incomingCall.video);
    callState = "in";
    renderCallUi();
  }
  const serverRead = Number(chatReadAt[selfId()] || 0);
  if (tab === "chat") {
    markChatSeen(Date.now());
    chatUnread = 0;
    if (unreadFromMessages(next, serverRead)) readChat(session.token).catch(() => {});
    const thread = document.querySelector("[data-chat-thread]");
    if (thread) paintChatThread(thread, after !== before && newFromThem.length > 0);
    refreshChatChrome();
    fitChatViewport();
  } else {
    chatUnread = unreadFromMessages(next, Math.max(serverRead, chatSeenAt));
    setChatBadge();
  }
}

function threadSig() {
  return visibleChatLog()
    .map((item) => `${item.id}:${receiptOf(item, isMine(item.from))}:${item.edited}:${item.deleted}:${item.kept ? 1 : 0}:${chatSelected.has(item.id) ? 1 : 0}:${Object.values(item.reactions || {}).join("")}`)
    .join("|");
}

function threadAtEnd(thread) {
  return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 28;
}

function paintChatThread(thread, stickToBottom) {
  if (stickToBottom) chatStickBottom = true;
  const keepEnd = Boolean(stickToBottom || chatStickBottom);
  const prevTop = thread.scrollTop;
  const sig = `${threadSig()}|${chatQuery}|${chatDisappearMs}`;
  if (thread.dataset.sig === sig) {
    if (stickToBottom) thread.scrollTop = thread.scrollHeight;
    return;
  }
  thread.dataset.sig = sig;
  const parts = [];
  let lastDay = "";
  visibleChatLog().forEach((item) => {
    const day = chatDayLabel(item.at);
    if (day !== lastDay) {
      lastDay = day;
      if (day && day !== "Today") parts.push(`<div class="chat-day">${escapeHtml(day)}</div>`);
    }
    const mine = isMine(item.from);
    const receipt = receiptOf(item, mine);
    const fill = RECEIPT_BG[receipt] || RECEIPT_BG.sent;
    const selected = chatSelected.has(item.id);
    const reactHtml = "";
    let body = "";
    if (!item.deleted) {
      const quote = item.replyId
        ? `<button class="chat-quote" type="button" data-jump="${escapeHtml(item.replyId)}"><span>${escapeHtml((item.replyText || "Photo").slice(0, 80))}</span></button>`
        : "";
      let photo = "";
      if (item.image && item.viewOnce && item.viewed && !mine) photo = `<div class="bubble-deleted">Viewed once</div>`;
      else if (item.image && item.viewOnce && !item.viewed && !mine) photo = `<button class="view-once" type="button" data-viewonce="${escapeHtml(item.id)}">Photo · view once</button>`;
      else if (item.image) photo = `<img class="chat-photo" alt="" src="${item.image}">`;
      const loc = item.type === "location" && item.lat
        ? `<button class="chat-map" type="button" data-open-where>Location</button>`
        : "";
      const poll = item.poll
        ? `<div class="chat-poll" data-poll="${escapeHtml(item.id)}"><strong>${escapeHtml(item.poll.question)}</strong>${(item.poll.options || [])
            .map(
              (opt, idx) =>
                `<button type="button" data-vote="${idx}">${escapeHtml(opt.text)} · ${Object.keys(opt.votes || {}).length}</button>`
            )
            .join("")}</div>`
        : "";
      const text = item.text ? `<div class="bubble-text">${escapeHtml(item.text).replaceAll("\n", "<br>")}${item.edited ? ' <span class="edited">edited</span>' : ""}</div>` : "";
      body = `${quote}${photo}${loc}${poll}${text}`;
    } else {
      return;
    }
    parts.push(`
      <div class="bubble-row ${mine ? "mine" : "theirs"} is-${receipt} ${selected ? "selected" : ""}" data-mid="${escapeHtml(item.id)}">
        <div class="swipe-hint" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M5.2 3.4 2.4 6.2 5.2 9M2.6 6.2h7.2a3.6 3.6 0 0 1 0 7.2H8"/></svg>
        </div>
        <div class="bubble" style="background:${fill}">
          ${body}
          ${reactHtml}
        </div>
        <span class="bubble-time">${fmtClock(item.at)}</span>
      </div>
    `);
  });
  thread.innerHTML = parts.length ? parts.join("") : `<div class="chat-empty"></div>`;
  if (keepEnd) thread.scrollTop = thread.scrollHeight;
  else thread.scrollTop = prevTop;
  bindChatGestures(thread);
}

function bindChatGestures(thread) {
  if (thread.dataset.bound === "1") return;
  thread.dataset.bound = "1";
  let startX = 0;
  let startY = 0;
  let row = null;
  let bubble = null;
  let swiping = false;
  let swipeShift = 0;
  let longTimer = 0;
  let skipClick = false;
  let captured = 0;
  let peeking = false;
  const clearDrag = () => {
    window.clearTimeout(longTimer);
    chatDragging = false;
    swiping = false;
    peeking = false;
    swipeShift = 0;
    captured = 0;
    if (bubble) bubble.style.transform = "";
    if (row) row.classList.remove("is-swiping", "is-time");
    row = null;
    bubble = null;
  };
  thread.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      row = event.target.closest("[data-mid]");
      if (!row) return;
      bubble = row.querySelector(".bubble");
      startX = event.clientX;
      startY = event.clientY;
      swipeShift = 0;
      swiping = false;
      longTimer = window.setTimeout(() => {
        if (!row || swiping) return;
        skipClick = true;
        openChatMenu(row.dataset.mid);
        navigator.vibrate?.(12);
      }, 500);
    },
    { passive: true }
  );
  thread.addEventListener(
    "pointermove",
    (event) => {
      if (!row || !bubble) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 8) window.clearTimeout(longTimer);
      if (chatSelectMode) {
        const under = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-mid]");
        if (under) {
          chatSelected.add(under.dataset.mid);
          under.classList.add("selected");
          refreshChatChrome();
        }
        return;
      }
      if (!swiping && Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        window.clearTimeout(longTimer);
        row = null;
        bubble = null;
        return;
      }
      if (!swiping && Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        swiping = true;
        chatDragging = true;
        captured = event.pointerId;
        try {
          thread.setPointerCapture(event.pointerId);
        } catch {
          /* some browsers ignore capture during scroll */
        }
        row.classList.add("is-swiping");
      }
      if (swiping) {
        if (dx < 0) {
          peeking = true;
          row.classList.add("is-time");
          row.classList.remove("is-swiping");
          swipeShift = Math.max(-72, dx);
          bubble.style.transform = `translateX(${swipeShift}px)`;
        } else {
          peeking = false;
          row.classList.remove("is-time");
          row.classList.add("is-swiping");
          swipeShift = Math.max(0, Math.min(72, dx));
          bubble.style.transform = `translateX(${swipeShift}px)`;
        }
      }
    },
    { passive: true }
  );
  thread.addEventListener("pointerup", (event) => {
    const id = row?.dataset.mid;
    const didSwipe = swiping && !peeking && swipeShift > 48;
    if (captured) {
      try {
        thread.releasePointerCapture(captured);
      } catch {
        /* already released */
      }
    }
    clearDrag();
    if (didSwipe && id) startReply(id);
  });
  thread.addEventListener("pointercancel", clearDrag);
  thread.addEventListener("click", (event) => {
    if (skipClick) {
      skipClick = false;
      event.preventDefault();
      return;
    }
    const jump = event.target.closest("[data-jump]");
    if (jump) {
      const target = thread.querySelector(`[data-mid="${jump.dataset.jump}"]`);
      target?.scrollIntoView({ block: "center" });
      target?.classList.add("flash");
      window.setTimeout(() => target?.classList.remove("flash"), 800);
      return;
    }
    const viewOnce = event.target.closest("[data-viewonce]");
    if (viewOnce) {
      const item = chatLog.find((row) => row.id === viewOnce.dataset.viewonce);
      if (item?.image) {
        const img = document.createElement("img");
        img.src = item.image;
        img.className = "once-full";
        document.body.append(img);
        window.setTimeout(() => img.remove(), 4000);
        item.viewed = true;
        persistChatItem(item).catch(() => {});
        paintChatThread(thread, false);
      }
      return;
    }
    const vote = event.target.closest("[data-vote]");
    if (event.target.closest("[data-open-where]")) {
      tab = "where";
      render();
      startChatLoop();
      return;
    }
    if (vote) {
      const pollBox = vote.closest("[data-poll]");
      const item = chatLog.find((row) => row.id === pollBox?.dataset.poll);
      if (item?.poll) {
        const idx = Number(vote.dataset.vote);
        item.poll.options.forEach((opt) => {
          if (opt.votes) delete opt.votes[selfId()];
        });
        item.poll.options[idx].votes = { ...(item.poll.options[idx].votes || {}), [selfId()]: true };
        persistChatItem(item).then(() => paintChatThread(thread, false));
      }
      return;
    }
    const rowClick = event.target.closest("[data-mid]");
    if (chatSelectMode && rowClick) {
      const id = rowClick.dataset.mid;
      if (chatSelected.has(id)) chatSelected.delete(id);
      else chatSelected.add(id);
      if (!chatSelected.size) chatSelectMode = false;
      paintChatThread(thread, false);
      refreshChatChrome();
    }
  });
}

function startReply(id) {
  const item = chatLog.find((row) => row.id === id);
  if (!item || item.deleted) return;
  chatReply = item;
  chatSelectMode = false;
  chatSelected.clear();
  refreshChatChrome();
  document.querySelector("[data-chat-input]")?.focus();
}

function openChatMenu(id) {
  chatMenuId = id;
  const menu = document.querySelector("[data-chat-menu]");
  const dim = document.querySelector("[data-chat-dim]");
  const app = document.querySelector(".wa-app");
  const row = document.querySelector(`[data-mid="${CSS.escape(id)}"]`);
  if (!menu || !app) return;
  const item = chatLog.find((row) => row.id === id);
  const mine = isMine(item?.from);
  const editBtn = menu.querySelector("[data-act='edit']");
  const deleteBtn = menu.querySelector("[data-act='delete']");
  if (editBtn) editBtn.hidden = !mine;
  if (deleteBtn) deleteBtn.hidden = !mine;
  menu.hidden = false;
  if (dim) dim.hidden = false;
  menu.style.top = "72px";
  menu.style.left = "50%";
  menu.style.right = "auto";
  menu.style.transform = "translateX(-50%)";
  requestAnimationFrame(() => {
    const appBox = app.getBoundingClientRect();
    const rowBox = row?.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    if (!rowBox) return;
    let top = rowBox.top - appBox.top - menuBox.height - 10;
    if (top < 8) top = rowBox.bottom - appBox.top + 10;
    const maxTop = appBox.height - menuBox.height - 24;
    menu.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
    if (mine) {
      menu.style.left = `${Math.min(appBox.width - 16, rowBox.right - appBox.left)}px`;
      menu.style.transform = "translateX(-100%)";
    } else {
      menu.style.left = `${Math.max(16, rowBox.left - appBox.left)}px`;
      menu.style.transform = "none";
    }
  });
  refreshChatChrome();
}

function closeChatMenu() {
  chatMenuId = "";
  const menu = document.querySelector("[data-chat-menu]");
  const dim = document.querySelector("[data-chat-dim]");
  if (menu) menu.hidden = true;
  if (dim) dim.hidden = true;
}

function refreshChatChrome() {
  const bar = document.querySelector("[data-reply-bar]");
  if (bar) {
    bar.hidden = !chatReply;
    if (chatReply) {
      bar.querySelector("[data-reply-text]").textContent = previewChat(chatReply).slice(0, 80);
    }
  }
  const jump = document.querySelector("[data-jump-end]");
  const thread = document.querySelector("[data-chat-thread]");
  if (jump && thread) {
    jump.hidden = thread.scrollHeight - thread.scrollTop < thread.clientHeight + 120;
  }
}

async function sendChatContent(extra = {}) {
  const thread = document.querySelector("[data-chat-thread]");
  const trimmed = String(extra.text || "").trim();
  const image = extra.image || "";
  if ((!trimmed && !image && extra.type !== "location" && extra.type !== "poll") || !spaceKey) return;
  if (chatEditId) {
    const item = chatLog.find((row) => row.id === chatEditId);
    if (item && isMine(item.from)) {
      item.text = trimmed;
      item.edited = true;
      chatEditId = "";
      chatReply = null;
      await persistChatItem(item);
      if (thread) paintChatThread(thread, false);
      refreshChatChrome();
      return;
    }
  }
  const id = uid();
  const at = Date.now();
  const item = {
    id,
    from: selfId(),
    at,
    text: trimmed,
    type: extra.type || (image ? "image" : "text"),
    image,
    audio: "",
    duration: 0,
    lat: extra.lat,
    lng: extra.lng,
    poll: extra.poll || null,
    viewOnce: Boolean(extra.viewOnce),
    viewed: false,
    edited: false,
    pinned: false,
    kept: false,
    replyId: chatReply?.id || "",
    replyText: chatReply ? previewChat(chatReply) : "",
    replyFrom: chatReply?.from || "",
    reactions: {},
    deleted: false,
    pending: true,
  };
  chatReply = null;
  chatLog = [...chatLog, item];
  if (thread) paintChatThread(thread, true);
  refreshChatChrome();
  try {
    const sealed = await encryptPayload(spaceKey, chatPayload(item));
    await sendChat(session.token, { id, at, ...sealed });
    typingChat(session.token, false);
    await syncChat();
  } catch (error) {
    chatLog = chatLog.filter((row) => row.id !== id);
    if (thread) paintChatThread(thread, true);
    alert(error.message);
  }
}

let state = defaultState();
let session = loadSession();
let spaceKey = null;
let saveTimer = 0;
let tab = "home";
let todayDraftId = null;
let openNoteId = null;
let openMemoryId = null;
let routineWho = "";
let gate = "home";
let createdInvite = "";
let inbox = { incoming: [], outgoing: [] };
let chatLog = [];
let chatReadAt = {};
let chatDeliveredAt = {};
let chatTyping = false;
let chatUnread = 0;
let chatSeenAt = 0;
let sectionUnread = {};
let lastCloudAt = 0;
let lastBlobSig = "";
let persisting = false;
let chatTimer = 0;
let typingTimer = 0;
let chatReply = null;
let chatSelected = new Set();
let chatSelectMode = false;
let chatDragging = false;
let chatStickBottom = true;
let chatQuery = "";
let chatMenuId = "";
let chatPartnerOnline = false;
let chatPartnerSeen = 0;
let chatDisappearMs = 0;
let chatEditId = "";
let callState = "";
let callVideo = false;
let callPc = null;
let callStream = null;
let pendingOffer = null;
let livePlaces = [];
let geoWatch = 0;
let geoNote = "";
let locReady = false;
let locAsking = false;
let geoTick = 0;
let todoFilter = "open";
let todoDraftWho = "us";
let todoDraftPri = "normal";
const root = document.getElementById("app");

async function persist() {
  if (!session?.token || !session.roomId || !spaceKey) return;
  persisting = true;
  try {
    const sealed = await encryptPayload(spaceKey, contentState(state));
    const saved = await saveCloud(session.token, sealed);
    lastCloudAt = Number(saved?.updatedAt || Date.now());
    lastBlobSig = `${sealed.iv}:${String(sealed.blob || "").length}:${String(sealed.blob || "").slice(-24)}`;
  } finally {
    persisting = false;
  }
}

function schedulePersist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    persist().catch((error) => console.error(error));
  }, 250);
}

function setState(patch, silent = false) {
  state = { ...state, ...patch };
  rememberOwnSections(patchSections(patch));
  if (!silent) render();
  schedulePersist();
}

function cloudSig(payload) {
  return `${String(payload?.iv || "")}:${String(payload?.blob || "").length}:${String(payload?.blob || "").slice(-24)}`;
}

function currentSectionId() {
  if (tab === "dates") return "memories";
  return tab;
}

function typingInApp() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

async function syncCloud() {
  if (!session?.token || !session.roomId || !spaceKey) return;
  if (saveTimer || persisting || typingInApp()) return;
  const payload = await loadCloud(session.token);
  const stamp = Number(payload.updatedAt || 0);
  const sig = cloudSig(payload);
  if (sig && sig === lastBlobSig) return;
  if (stamp && stamp === lastCloudAt) return;
  let opened = null;
  try {
    opened = await decryptPayload(spaceKey, payload.iv, payload.blob);
  } catch {
    opened = null;
  }
  if (!opened) {
    lastCloudAt = stamp || lastCloudAt;
    return;
  }
  const next = contentState(opened);
  const prevSig = sectionSigs(state);
  const nextSig = sectionSigs(next);
  const seen = loadSectionSeen();
  const here = currentSectionId();
  let changed = false;
  CONTENT_SECTIONS.forEach((id) => {
    if (nextSig[id] === prevSig[id]) return;
    changed = true;
    if (nextSig[id] !== seen[id]) sectionUnread[id] = true;
  });
  lastCloudAt = stamp || Date.now();
  lastBlobSig = sig;
  if (!changed) {
    setHomeBadges();
    return;
  }
  state = {
    ...state,
    ...next,
    startedOn: next.startedOn || payload.startedOn || state.startedOn,
  };
  if (CONTENT_SECTIONS.includes(here) && nextSig[here] !== prevSig[here]) {
    markSectionSeen(here);
    render();
    return;
  }
  if (tab === "home") render();
  else setHomeBadges();
}

async function openSession(payload) {
  const roomId = payload.roomId;
  spaceKey = await deriveSpaceKey(roomId, payload.kdfSalt);
  let opened = null;
  try {
    opened = await decryptPayload(spaceKey, payload.iv, payload.blob);
  } catch {
    opened = null;
  }
  state = {
    ...defaultState(),
    startedOn: payload.startedOn,
    ...contentState(opened),
  };
  session = {
    token: payload.token,
    username: coupleId(payload.username) || readSavedWho(),
    who: coupleId(payload.username) === "ma" ? "them" : "you",
    you: "ba",
    them: "ma",
    roomId,
    kdfSalt: payload.kdfSalt,
  };
  saveSession(session);
  saveWho(session.username);
  decryptCache.clear();
  createdInvite = roomId;
  chatSeenAt = loadChatSeen();
  lastCloudAt = Number(payload.updatedAt || 0);
  lastBlobSig = cloudSig(payload);
  seedSectionSeen();
  gate = "home";
  locAsking = false;
  if (sharingLoc()) locReady = true;
  await hydrateLocConsent();
  render();
  startChatLoop();
  startGeoShare();
  const had = new Set((opened?.dates || []).map((item) => item.id));
  if (KEPT_DATES.some((row) => !had.has(row.id))) persist().catch(() => {});
}

function logout() {
  stopChatLoop();
  stopGeoShare();
  locAsking = false;
  locReady = sharingLoc();
  if (session?.token) logoutCloud(session.token);
  session = null;
  spaceKey = null;
  createdInvite = "";
  chatLog = [];
  decryptCache.clear();
  chatReadAt = {};
  chatDeliveredAt = {};
  chatTyping = false;
  chatUnread = 0;
  chatSeenAt = 0;
  sectionUnread = {};
  lastCloudAt = 0;
  lastBlobSig = "";
  chatReply = null;
  chatSelected = new Set();
  chatSelectMode = false;
  chatDragging = false;
  chatQuery = "";
  chatMenuId = "";
  chatEditId = "";
  chatDisappearMs = 0;
  endCall(false);
  state = defaultState();
  saveSession(null);
  tab = "home";
  gate = "home";
  render();
}

function gateView() {
  const setup = localStorage.getItem(SETUP_KEY) !== "1";
  const savedWho = readSavedWho();
  let pickedWho = savedWho;
  const card = el(`
    <div class="setup">
      <form class="setup-card">
        <p class="kicker">Welcome</p>
        <h1 class="wordmark">Ba</h1>
        ${setup ? `
        <div class="field">
          <label for="su">su _ _ toka</label>
          <input id="su" name="su" maxlength="2" autocomplete="off" autocapitalize="off" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="rin">rin _ _ toki</label>
          <input id="rin" name="rin" maxlength="2" autocomplete="off" autocapitalize="off" spellcheck="false" required />
        </div>
        ` : ""}
        ${savedWho ? "" : `
        <div class="field">
          <label>Who are you?</label>
          <div class="who-pick" role="group" aria-label="Who are you?">
            <button class="who-option" type="button" data-who="ba"><span>Ba</span></button>
            <button class="who-option" type="button" data-who="ma"><span>Ma</span></button>
          </div>
        </div>
        `}
        <div class="field">
          <label for="code">Code</label>
          <input id="code" name="code" inputmode="numeric" autocomplete="off" required maxlength="12" />
        </div>
        <p class="err" data-err></p>
        <button class="btn rose" type="submit">Open</button>
      </form>
    </div>
  `);
  card.querySelectorAll("[data-who]").forEach((button) => {
    button.addEventListener("click", () => {
      pickedWho = button.dataset.who === "ma" ? "ma" : "ba";
      card.querySelectorAll("[data-who]").forEach((item) => item.classList.toggle("picked", item === button));
    });
  });
  card.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = card.querySelector("[data-err]");
    err.textContent = "";
    const code = card.querySelector("#code").value.replace(/\D/g, "");
    if (!code) {
      err.textContent = "Enter the code.";
      return;
    }
    try {
      const who = coupleId(pickedWho) || readSavedWho();
      if (!savedWho && who !== "ba" && who !== "ma") {
        err.textContent = "Pick Ba or Ma.";
        return;
      }
      const locating = requestLocation();
      const body = { code, deviceId: deviceId() };
      if (who === "ba" || who === "ma") body.who = who;
      if (setup) {
        body.su = card.querySelector("#su").value;
        body.rin = card.querySelector("#rin").value;
      }
      const entered = await enterRoom(body);
      localStorage.setItem(SETUP_KEY, "1");
      saveWho(coupleId(entered.username) || who);
      await openSession(entered);
      await locating;
      render();
    } catch (error) {
      err.textContent = error.message;
      if (error.needSetup && localStorage.getItem(SETUP_KEY) === "1") {
        try {
          localStorage.removeItem(SETUP_KEY);
        } catch {
          /* ignore */
        }
        render();
      }
    }
  });
  return card;
}

function locGateView() {
  const card = el(`
    <div class="setup">
      <form class="setup-card">
        <p class="kicker">Where</p>
        <h1 class="wordmark">Ba</h1>
        <p class="lede">Allow location so Ba can stay on the map.</p>
        <p class="err" data-err>${escapeHtml(geoNote)}</p>
        <button class="btn rose" type="submit">Allow location</button>
      </form>
    </div>
  `);
  card.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = card.querySelector("[data-err]");
    const btn = card.querySelector("button");
    err.textContent = "Finding you…";
    btn.disabled = true;
    const ok = await requestLocation();
    btn.disabled = false;
    if (ok) render();
    else err.textContent = geoNote || "Location must be allowed.";
  });
  return card;
}

function goTab(id) {
  if (id === "chat") {
    enterChat();
    return;
  }
  if (id === "home") {
    goHome();
    return;
  }
  if (id === "where") {
    whereFollow = false;
    whereCenter = { ...INDIA_CENTER };
    followPinId = "";
    mapZoom = 5;
    whereSig = "";
  } else {
    whereFull = false;
    document.body.classList.remove("map-full");
  }
  openMemoryId = null;
  openNoteId = null;
  if (id !== "today") todayDraftId = null;
  if (id === "routine") routineWho = partnerId();
  tab = id;
  markSectionSeen(id);
  persist().catch(() => {});
  render();
  startChatLoop();
}

async function confirmClearChat() {
  try {
    await clearChat(session.token);
  } catch {
    /* ignore */
  }
  chatLog = [];
  chatUnread = 0;
  decryptCache.clear();
  setChatBadge();
  render();
}

function homeView() {
  const days = daysTogether(state.startedOn);
  const lastPoke = state.pokes[0];
  const sections = [
    ["chat", "Chat"],
    ["routine", "Routine"],
    ["where", "Where"],
    ["today", "Today"],
    ["memories", "Memories"],
    ["us", "Us"],
    ["todo", "To Do"],
    ["family", "Family"],
  ];
  const page = el(`
    <div class="home">
      ${state.startedOn ? `<section class="home-hero"><p class="days">${days}<span>days</span></p></section>` : ""}
      <div class="home-actions">
        <button class="home-tile home-poke${sectionUnread.poke ? " has-unread" : ""}" type="button" data-poke>
          <span>${lastPoke ? escapeHtml(new Date(lastPoke.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })) : "—"}</span>
        </button>
      </div>
      <div class="home-links">
        ${sections.map(([id, label]) => `<button class="home-tile${id === "chat" ? (chatUnread > 0 ? " has-unread" : "") : (sectionUnread[id] ? " has-unread" : "")}" type="button" data-go="${id}"><span>${label}</span></button>`).join("")}
      </div>
      <div class="home-settings">
        <button class="back-ico" type="button" data-settings aria-label="Settings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <g fill="currentColor" transform="translate(12 12)">
              <path fill-rule="evenodd" d="M0-6.35a6.35 6.35 0 1 1 0 12.7 6.35 6.35 0 0 1 0-12.7zm0 3.2a3.15 3.15 0 1 0 0 6.3 3.15 3.15 0 0 0 0-6.3z"/>
              <rect x="-1.15" y="-10.15" width="2.3" height="4.05" rx="0.7"/>
              <rect x="-1.15" y="-10.15" width="2.3" height="4.05" rx="0.7" transform="rotate(60)"/>
              <rect x="-1.15" y="-10.15" width="2.3" height="4.05" rx="0.7" transform="rotate(120)"/>
              <rect x="-1.15" y="-10.15" width="2.3" height="4.05" rx="0.7" transform="rotate(180)"/>
              <rect x="-1.15" y="-10.15" width="2.3" height="4.05" rx="0.7" transform="rotate(240)"/>
              <rect x="-1.15" y="-10.15" width="2.3" height="4.05" rx="0.7" transform="rotate(300)"/>
            </g>
          </svg>
        </button>
      </div>
    </div>
  `);
  page.querySelector("[data-poke]").addEventListener("click", () => {
    setState({
      pokes: [{ id: uid(), from: currentName(), at: Date.now() }, ...state.pokes].slice(0, 20),
    });
  });
  const menu = el(`<div class="chat-action nav-clear" data-clear-chat hidden><button type="button">Clear chat</button></div>`);
  page.append(menu);
  let hold = 0;
  let skipClick = false;
  const chatBtn = page.querySelector('[data-go="chat"]');
  const closeClear = () => {
    menu.hidden = true;
  };
  const openClear = () => {
    const box = chatBtn.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${Math.min(window.innerWidth - 16, box.left + box.width / 2)}px`;
    menu.style.top = `${box.bottom + 8}px`;
    menu.style.transform = "translateX(-50%)";
  };
  page.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (button.dataset.go === "chat" && skipClick) {
        event.preventDefault();
        skipClick = false;
        return;
      }
      closeClear();
      goTab(button.dataset.go);
    });
  });
  chatBtn.addEventListener("pointerdown", () => {
    skipClick = false;
    hold = window.setTimeout(() => {
      skipClick = true;
      openClear();
      navigator.vibrate?.(10);
    }, 480);
  });
  const cancelHold = () => window.clearTimeout(hold);
  chatBtn.addEventListener("pointerup", cancelHold);
  chatBtn.addEventListener("pointercancel", cancelHold);
  chatBtn.addEventListener("contextmenu", (event) => event.preventDefault());
  menu.addEventListener("click", async (event) => {
    event.stopPropagation();
    closeClear();
    await confirmClearChat();
  });
  page.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !event.target.closest("[data-clear-chat]") && event.target !== chatBtn) closeClear();
  });
  setChatBadge();
  page.querySelector("[data-settings]").addEventListener("click", () => goTab("settings"));
  return page;
}

async function pullSignals() {
  if (!session?.token || !session.roomId) return;
  const payload = await loadSignals(session.token);
  for (const sig of payload.signals || []) {
    if (sig.kind === "offer" && callState !== "live") {
      pendingOffer = sig.data;
      callVideo = Boolean(sig.video);
      callState = "in";
      renderCallUi();
    } else if (sig.kind === "answer" && callPc) {
      await callPc.setRemoteDescription(sig.data);
      callState = "live";
      renderCallUi();
    } else if (sig.kind === "ice" && callPc && sig.data) {
      try {
        await callPc.addIceCandidate(sig.data);
      } catch {
        /* ignore */
      }
    } else if (sig.kind === "hangup") {
      endCall(false);
    }
  }
}

async function setupCall() {
  callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callVideo });
  callPc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  callStream.getTracks().forEach((track) => callPc.addTrack(track, callStream));
  callPc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(session.token, { kind: "ice", data: event.candidate }).catch(() => {});
  };
  callPc.ontrack = (event) => {
    const remote = document.querySelector("[data-remote-video]");
    if (remote) remote.srcObject = event.streams[0];
  };
  const local = document.querySelector("[data-local-video]");
  if (local) local.srcObject = callStream;
}

async function startCall(video) {
  callVideo = video;
  callState = "out";
  renderCallUi();
  await setupCall();
  const offer = await callPc.createOffer();
  await callPc.setLocalDescription(offer);
  await sendSignal(session.token, { kind: "offer", video, data: offer });
}

async function acceptCall() {
  await setupCall();
  if (pendingOffer) await callPc.setRemoteDescription(pendingOffer);
  const answer = await callPc.createAnswer();
  await callPc.setLocalDescription(answer);
  await sendSignal(session.token, { kind: "answer", data: answer });
  callState = "live";
  renderCallUi();
}

function endCall(notify = true) {
  callPc?.close();
  callStream?.getTracks().forEach((track) => track.stop());
  callPc = null;
  callStream = null;
  pendingOffer = null;
  if (notify && callState) sendSignal(session.token, { kind: "hangup" }).catch(() => {});
  callState = "";
  renderCallUi();
}

function renderCallUi() {
  let box = document.querySelector("[data-call-ui]");
  if (!callState) {
    box?.remove();
    return;
  }
  if (!box) {
    box = el(`
      <div class="call-ui" data-call-ui>
        <p data-call-label></p>
        <video data-remote-video autoplay playsinline></video>
        <video data-local-video autoplay muted playsinline></video>
        <div class="call-actions">
          <button type="button" class="btn rose" data-accept-call>Accept</button>
          <button type="button" class="btn danger" data-end-call>End</button>
        </div>
      </div>
    `);
    document.body.append(box);
    box.querySelector("[data-accept-call]").addEventListener("click", () => acceptCall().catch((error) => alert(error.message)));
    box.querySelector("[data-end-call]").addEventListener("click", () => endCall());
  }
  box.querySelector("[data-call-label]").textContent =
    callState === "in" ? "Incoming call" : callState === "out" ? "Calling…" : "On call";
  box.querySelector("[data-accept-call]").hidden = callState !== "in";
  box.classList.toggle("is-video", callVideo);
}

function fitChatViewport() {
  const app = document.querySelector(".wa-app");
  if (!app) return;
  const vv = window.visualViewport;
  if (!vv) {
    app.style.height = "";
    app.style.top = "";
    return;
  }
  app.style.height = `${Math.round(vv.height)}px`;
  app.style.top = `${Math.round(vv.offsetTop)}px`;
}

let chatViewportBound = false;
function ensureChatViewport() {
  if (chatViewportBound || !window.visualViewport) return;
  chatViewportBound = true;
  window.visualViewport.addEventListener("resize", fitChatViewport, { passive: true });
  window.visualViewport.addEventListener("scroll", fitChatViewport, { passive: true });
}

function enterChat() {
  markChatSeen(Date.now());
  chatUnread = 0;
  tab = "chat";
  if (history.state?.ba !== "chat") history.pushState({ ba: "chat" }, "");
  render();
  startChatLoop();
}

function leaveChat() {
  if (tab !== "chat") return;
  markChatSeen(Date.now());
  chatUnread = 0;
  if (session?.token) readChat(session.token).catch(() => {});
  tab = "home";
  render();
  startChatLoop();
}

function goHome() {
  if (tab === "chat") {
    requestLeaveChat();
    return;
  }
  if ((tab === "memories" || tab === "dates") && openMemoryId) {
    openMemoryId = null;
    render();
    return;
  }
  if (tab === "today" && openNoteId) {
    openNoteId = null;
    render();
    return;
  }
  if (tab === "home") return;
  todayDraftId = null;
  whereFull = false;
  document.body.classList.remove("map-full");
  tab = "home";
  persist().catch(() => {});
  render();
  startChatLoop();
}

function requestLeaveChat() {
  if (history.state?.ba === "chat") history.back();
  else leaveChat();
}

window.addEventListener("popstate", () => {
  leaveChat();
});

function chatView() {
  const wrap = el(`
    <section class="wa-app">
      <button class="back-ghost" type="button" data-back aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.5 5.5 8 12l7.5 6.5 1.4-1.6L11.2 12l5.7-5.9z"/></svg>
      </button>
      <div class="wa-thread" data-chat-thread></div>
      <button class="jump-end" type="button" data-jump-end hidden>↓</button>
      <div class="wa-dock">
        <div class="chat-reply" data-reply-bar ${chatReply ? "" : "hidden"}>
          <div>
            <p data-reply-text>${chatReply ? escapeHtml(previewChat(chatReply).slice(0, 80)) : ""}</p>
          </div>
          <button class="reply-close" type="button" data-clear-reply aria-label="Cancel reply">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>
        <form class="wa-compose">
          <textarea data-chat-input rows="1" placeholder="Message" maxlength="2000"></textarea>
          <button class="wa-send" type="submit" data-send aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.4 20.6 21 12 3.4 3.4 3.5 10l11 2-11 2z"/></svg>
          </button>
        </form>
      </div>
      <div class="wa-dim" data-chat-dim hidden></div>
      <div class="chat-action" data-chat-menu hidden>
        <button type="button" data-act="copy">Copy</button>
        <button type="button" data-act="edit">Edit</button>
        <button type="button" data-act="delete">Delete</button>
      </div>
    </section>
  `);
  const thread = wrap.querySelector("[data-chat-thread]");
  const input = wrap.querySelector("[data-chat-input]");
  wrap.querySelector("[data-back]").addEventListener("click", () => requestLeaveChat());
  paintChatThread(thread, true);
  ensureChatViewport();
  requestAnimationFrame(fitChatViewport);
  readChat(session.token).catch(() => {});
  wrap.querySelector("[data-clear-reply]").addEventListener("click", () => {
    chatReply = null;
    refreshChatChrome();
  });
  wrap.querySelector("[data-jump-end]").addEventListener("click", () => {
    chatStickBottom = true;
    thread.scrollTop = thread.scrollHeight;
    refreshChatChrome();
  });
  thread.addEventListener("scroll", () => {
    chatStickBottom = threadAtEnd(thread);
    refreshChatChrome();
  }, { passive: true });
  wrap.querySelector("[data-chat-dim]").addEventListener("click", () => {
    closeChatMenu();
  });
  wrap.querySelector("[data-chat-menu]").addEventListener("click", async (event) => {
    event.stopPropagation();
    const act = event.target.closest("[data-act]")?.dataset.act;
    const id = chatMenuId;
    if (act && id) await runChatAction(act, [id]);
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    window.clearTimeout(typingTimer);
    typingChat(session.token, true);
    typingTimer = window.setTimeout(() => typingChat(session.token, false), 2000);
  });
  wrap.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    input.value = "";
    input.style.height = "auto";
    await sendChatContent({ text });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      wrap.querySelector("form").requestSubmit();
    }
  });
  refreshChatChrome();
  return wrap;
}

async function runChatAction(act, ids, extra) {
  const thread = document.querySelector("[data-chat-thread]");
  const items = chatLog.filter((item) => ids.includes(item.id));
  if (act === "copy") {
    const text = items.map((item) => previewChat(item)).filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    closeChatMenu();
    return;
  }
  if (act === "edit" && isMine(items[0]?.from) && !items[0].deleted) {
    chatEditId = items[0].id;
    const box = document.querySelector("[data-chat-input]");
    if (box) {
      box.value = items[0].text || "";
      box.focus();
    }
    closeChatMenu();
    return;
  }
  if (act === "delete") {
    for (const item of items) {
      if (!isMine(item.from)) continue;
      try {
        await removeChat(session.token, item.id);
      } catch {
        /* ignore */
      }
      chatLog = chatLog.filter((row) => row.id !== item.id);
    }
  }
  chatSelectMode = false;
  chatSelected.clear();
  closeChatMenu();
  if (thread) paintChatThread(thread, false);
  refreshChatChrome();
}

function fmtStamp(ms) {
  const at = new Date(ms);
  return {
    day: at.toLocaleDateString(undefined, { weekday: "long" }),
    date: at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    time: at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    key: dayKey(ms),
  };
}

function todayNoteCard(note) {
  const stamp = fmtStamp(note.at);
  return el(`
    <article class="today-note is-open" data-note="${escapeHtml(note.id)}" role="button" tabindex="0">
      <p class="today-time">${escapeHtml(stamp.time)}</p>
      <p class="today-body">${escapeHtml(note.text)}</p>
    </article>
  `);
}

function bindOpenCard(card, open) {
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
}

function storyDeleteMenu(page) {
  const menu = el(`<div class="chat-action nav-clear" data-story-del hidden><button type="button" data-act="delete">Delete</button></div>`);
  page.append(menu);
  let pending = null;
  let ignoreOpen = false;
  const close = () => {
    if (!menu.hidden) ignoreOpen = true;
    menu.hidden = true;
    pending = null;
  };
  const open = (card, onDelete) => {
    pending = onDelete;
    ignoreOpen = false;
    const box = card.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${Math.min(window.innerWidth - 16, Math.max(16, box.left + box.width / 2))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 16, box.bottom + 8)}px`;
    menu.style.transform = "translateX(-50%)";
  };
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const run = pending;
    menu.hidden = true;
    pending = null;
    ignoreOpen = true;
    run?.();
  });
  page.addEventListener("pointerdown", (event) => {
    if (menu.hidden) return;
    if (event.target.closest("[data-story-del]")) return;
    close();
  });
  return { open, close, consume() {
    if (!ignoreOpen) return false;
    ignoreOpen = false;
    return true;
  } };
}

function bindHoldOpen(card, { menu, onOpen, onDelete }) {
  let hold = 0;
  let skipClick = false;
  bindOpenCard(card, () => {
    if (skipClick || menu.consume()) {
      skipClick = false;
      return;
    }
    onOpen();
  });
  card.addEventListener("pointerdown", () => {
    skipClick = false;
    hold = window.setTimeout(() => {
      skipClick = true;
      navigator.vibrate?.(10);
      menu.open(card, onDelete);
    }, 480);
  });
  const cancelHold = () => window.clearTimeout(hold);
  card.addEventListener("pointerup", cancelHold);
  card.addEventListener("pointercancel", cancelHold);
  card.addEventListener("contextmenu", (event) => event.preventDefault());
}

function todayEditorView(item) {
  const wrap = el(`
    <div class="today today-page">
      <form class="today-write memory-edit">
        <textarea id="today-story" rows="10">${escapeHtml(item.text || "")}</textarea>
      </form>
    </div>
  `);
  let wait = 0;
  const save = () => {
    const text = wrap.querySelector("#today-story").value;
    setState({
      notes: state.notes.map((note) => (note.id === item.id ? { ...note, text } : note)),
    }, true);
  };
  wrap.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  wrap.querySelector("form").addEventListener("input", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(save, 400);
  });
  return wrap;
}

function todayView() {
  if (openNoteId) {
    const item = state.notes.find((note) => note.id === openNoteId);
    if (item) return todayEditorView(item);
    openNoteId = null;
  }
  const wrap = el(`
    <div class="today today-page">
      <form class="today-write">
        <textarea id="letter" rows="4"></textarea>
      </form>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  const box = wrap.querySelector("#letter");
  const menu = storyDeleteMenu(wrap);
  const pruneDays = () => {
    list.querySelectorAll(".today-day").forEach((day) => {
      const next = day.nextElementSibling;
      if (!next || next.classList.contains("today-day")) day.remove();
    });
  };
  const bindNote = (card) => {
    const id = card.dataset.note;
    if (!id) return;
    bindHoldOpen(card, {
      menu,
      onOpen: () => {
        openNoteId = id;
        render();
      },
      onDelete: () => {
        setState({ notes: state.notes.filter((note) => note.id !== id) }, true);
        card.remove();
        pruneDays();
        if (todayDraftId === id) {
          todayDraftId = null;
          box.value = "";
        }
      },
    });
  };
  const notes = [...state.notes].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  if (notes.length) {
    let lastKey = "";
    notes.forEach((note) => {
      const stamp = fmtStamp(note.at);
      if (stamp.key !== lastKey) {
        list.append(el(`<p class="today-day">${escapeHtml(stamp.day)} · ${escapeHtml(stamp.date)}</p>`));
        lastKey = stamp.key;
      }
      const card = todayNoteCard(note);
      list.append(card);
      bindNote(card);
    });
  }
  const draft = todayDraftId && state.notes.find((note) => note.id === todayDraftId);
  if (draft) box.value = draft.text;
  let wait = 0;
  const saveDraft = () => {
    const text = box.value.trim();
    if (!text) {
      if (todayDraftId) {
        setState({ notes: state.notes.filter((note) => note.id !== todayDraftId) }, true);
        wrap.querySelector(`[data-note="${todayDraftId}"]`)?.remove();
        pruneDays();
        todayDraftId = null;
      }
      return;
    }
    const stamp = fmtStamp(Date.now());
    if (todayDraftId && state.notes.some((note) => note.id === todayDraftId)) {
      setState({
        notes: state.notes.map((note) =>
          note.id === todayDraftId ? { ...note, text, at: Date.now() } : note
        ),
      }, true);
      const card = wrap.querySelector(`[data-note="${todayDraftId}"]`);
      if (card) {
        card.querySelector(".today-time").textContent = stamp.time;
        const body = card.querySelector(".today-body");
        if (body) body.textContent = text;
      }
      return;
    }
    todayDraftId = uid();
    const note = { id: todayDraftId, from: currentName(), text, at: Date.now() };
    setState({ notes: [note, ...state.notes] }, true);
    const firstDay = list.querySelector(".today-day");
    if (!firstDay || firstDay.textContent !== `${stamp.day} · ${stamp.date}`) {
      list.prepend(el(`<p class="today-day">${escapeHtml(stamp.day)} · ${escapeHtml(stamp.date)}</p>`));
    }
    const after = list.querySelector(".today-day");
    const card = todayNoteCard(note);
    after?.after(card);
    bindNote(card);
  };
  box.addEventListener("input", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(saveDraft, 500);
  });
  wrap.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  return wrap;
}

function memoryDay(item) {
  const iso = item.date || (item.at ? isoTodayFrom(item.at) : "");
  const when = iso ? new Date(`${iso}T12:00:00`) : item.at ? new Date(item.at) : null;
  if (!when || Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString(
    undefined,
    item.noYear
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "long", day: "numeric", month: "short", year: "numeric" }
  );
}

function datesView() {
  if (openMemoryId) {
    const item = state.dates.find((row) => row.id === openMemoryId);
    if (item) return memoryEditorView(item);
    openMemoryId = null;
  }
  const wrap = el(`
    <div class="today today-page memories-page">
      <form class="today-write">
        ${datePickerHtml("idate", "", { required: true, future: true, maxYear: 2200 })}
        <textarea id="idate-text" rows="2" maxlength="180"></textarea>
      </form>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  const menu = storyDeleteMenu(wrap);
  const rows = [...state.dates].sort((a, b) => {
    const da = String(a.date || a.at || "");
    const db = String(b.date || b.at || "");
    return db.localeCompare(da);
  });
  const addCard = (item) => {
    const text = item.text || item.title || "";
    const story = String(item.story || "").trim();
    const row = el(`
      <article class="today-note is-open" data-memory="${escapeHtml(item.id)}" role="button" tabindex="0">
        <p class="today-time">${escapeHtml(memoryDay(item))}</p>
        <p class="today-body">${escapeHtml(text)}</p>
        ${story ? `<p class="today-story">${escapeHtml(story.length > 140 ? `${story.slice(0, 140)}…` : story)}</p>` : ""}
      </article>
    `);
    bindHoldOpen(row, {
      menu,
      onOpen: () => {
        openMemoryId = item.id;
        render();
      },
      onDelete: () => {
        setState({ dates: state.dates.filter((row) => row.id !== item.id) }, true);
        row.remove();
      },
    });
    return row;
  };
  if (rows.length) rows.forEach((item) => list.append(addCard(item)));
  else list.append(el(`<p class="empty">No memories yet.</p>`));
  let wait = 0;
  const saveNew = () => {
    const date = readDatePicker(wrap, "idate");
    const text = wrap.querySelector("#idate-text").value.trim();
    if (!date || !text) return;
    const item = { id: uid(), date, text, story: "", at: Date.now() };
    setState({ dates: [item, ...state.dates] }, true);
    wrap.querySelector("#idate-text").value = "";
    list.querySelector(".empty")?.remove();
    list.prepend(addCard(item));
  };
  wrap.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  wrap.querySelector("form").addEventListener("input", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(saveNew, 600);
  });
  wrap.querySelector("form").addEventListener("change", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(saveNew, 200);
  });
  return wrap;
}

function memoryEditorView(item) {
  const wrap = el(`
    <div class="today today-page memories-page">
      <form class="today-write memory-edit">
        ${datePickerHtml("mdate", item.date || "", { required: true, future: true, maxYear: 2200 })}
        <input id="memory-title" maxlength="180" value="${escapeHtml(item.text || item.title || "")}" />
        <textarea id="memory-story" rows="10" placeholder="Story">${escapeHtml(item.story || "")}</textarea>
      </form>
    </div>
  `);
  let wait = 0;
  const save = () => {
    const date = readDatePicker(wrap, "mdate");
    const text = wrap.querySelector("#memory-title").value.trim();
    const story = wrap.querySelector("#memory-story").value;
    if (!date || !text) return;
    setState({
      dates: state.dates.map((row) =>
        row.id === item.id
          ? { ...row, date, text, story: story.trim(), noYear: row.noYear && date === row.date, at: Date.now() }
          : row
      ),
    }, true);
  };
  wrap.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  wrap.querySelector("form").addEventListener("input", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(save, 400);
  });
  wrap.querySelector("form").addEventListener("change", save);
  return wrap;
}

function isoTodayFrom(ms) {
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

function askView() {
  const q = todayQuestion();
  const wrap = el(`
    <div>
      <article class="card">
        <p class="question">${q}</p>
        <form>
          <div class="field">
            <label for="answer">Answer</label>
            <textarea id="answer" required></textarea>
          </div>
          <button class="btn rose" type="submit">Save</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.answers.length) {
    list.append(el(`<div class="empty card">No answers yet.</div>`));
  } else {
    state.answers.forEach((item) => {
      list.append(
        el(`
          <article class="note">
            <div class="meta"><span>${escapeHtml(item.who)}</span><span>${new Date(item.at).toLocaleString()}</span></div>
            <p class="muted">${escapeHtml(item.question)}</p>
            <div>${escapeHtml(item.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const who = currentName();
    const text = wrap.querySelector("#answer").value.trim();
    if (!text) return;
    setState({
      answers: [{ id: uid(), who, question: q, text, at: Date.now() }, ...state.answers],
    });
  });
  return wrap;
}

function usView() {
  const wrap = el(`
    <div class="us-page">
      <article class="card">
        <h3>Start</h3>
        <div class="field">
          <label>Start date</label>
          ${datePickerHtml("startedOn", state.startedOn || "")}
        </div>
      </article>
    </div>
  `);
  wrap.querySelector('[data-date-name="startedOn"]').addEventListener("change", () => {
    const date = readDatePicker(wrap, "startedOn");
    if (!date || date === state.startedOn) return;
    setState({ startedOn: date });
  });
  return wrap;
}

function familyView() {
  const raw = state.familyTree;
  if (!raw?.mandi && !raw?.tudu && !raw?.union) {
    state.familyTree = ensureFamilyTree(null);
    schedulePersist();
  } else if (missingLockFlags(raw.mandi) || missingLockFlags(raw.tudu) || missingLockFlags(raw.union)) {
    state.familyTree = ensureFamilyTree(raw);
    schedulePersist();
  }
  const tree = state.familyTree;
  const wrap = el(familyTreeHtml(escapeHtml, tree));
  const saveCard = (card) => {
    const id = card.dataset.treeId;
    if (!id) return;
    const next = {
      mandi: mapPerson(state.familyTree.mandi, id, {
        name: card.querySelector('[data-field="name"]').value,
        nick: card.querySelector('[data-field="nick"]').value.trim(),
        born: card.querySelector('[data-field="born"]').value.trim(),
      }),
      tudu: mapPerson(state.familyTree.tudu, id, {
        name: card.querySelector('[data-field="name"]').value,
        nick: card.querySelector('[data-field="nick"]').value.trim(),
        born: card.querySelector('[data-field="born"]').value.trim(),
      }),
      union: mapPerson(state.familyTree.union, id, {
        name: card.querySelector('[data-field="name"]').value,
        nick: card.querySelector('[data-field="nick"]').value.trim(),
        born: card.querySelector('[data-field="born"]').value.trim(),
      }),
    };
    setState({ familyTree: next }, true);
  };
  wrap.querySelectorAll("[data-tree-id]").forEach((card) => {
    let wait = 0;
    card.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        window.clearTimeout(wait);
        wait = window.setTimeout(() => saveCard(card), 350);
      });
    });
    card.querySelector("[data-del]")?.addEventListener("click", (event) => {
      event.preventDefault();
      const id = card.dataset.treeId;
      if (card.dataset.locked === "1") return;
      setState({
        familyTree: {
          mandi: removePerson(state.familyTree.mandi, id),
          tudu: removePerson(state.familyTree.tudu, id),
          union: removePerson(state.familyTree.union, id),
        },
      });
    });
  });
  const paint = () => drawFamilyLines(wrap);
  requestAnimationFrame(() => requestAnimationFrame(paint));
  const chart = wrap.querySelector("[data-chart]");
  if (chart && typeof ResizeObserver !== "undefined") {
    const watch = new ResizeObserver(paint);
    watch.observe(chart);
  }
  wrap.querySelector(".chart-scroll")?.addEventListener("scroll", paint, { passive: true });
  return wrap;
}

function todoWhoOf(item) {
  const who = String(item?.who || "").toLowerCase();
  return who === "ba" || who === "ma" || who === "us" ? who : "us";
}

function todoPriOf(item) {
  return item?.pri === "high" || item?.pri === 1 ? "high" : "normal";
}

function todoDueLabel(due) {
  const day = String(due || "");
  if (!day) return "";
  const today = isoToday();
  if (day === today) return "Today";
  const stamp = new Date(`${day}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  return stamp.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sortTodos(list) {
  return [...list].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    const pa = todoPriOf(a) === "high" ? 0 : 1;
    const pb = todoPriOf(b) === "high" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const da = a.due || "9999";
    const db = b.due || "9999";
    if (da !== db) return da.localeCompare(db);
    return Number(b.at || 0) - Number(a.at || 0);
  });
}

function todoView() {
  const all = Array.isArray(state.todos) ? state.todos : [];
  const openN = all.filter((item) => !item.done).length;
  const doneN = all.length - openN;
  const shown = sortTodos(all).filter((item) => {
    if (todoFilter === "open") return !item.done;
    if (todoFilter === "done") return item.done;
    return true;
  });
  const wrap = el(`
    <div class="todo-page">
      <form class="todo-compose">
        <input data-new maxlength="200" placeholder="Add a task" autocomplete="off" />
        <div class="todo-tools">
          <div class="todo-who" role="group" aria-label="For">
            <button type="button" data-who="us" class="${todoDraftWho === "us" ? "is-on" : ""}">Us</button>
            <button type="button" data-who="ba" class="${todoDraftWho === "ba" ? "is-on" : ""}">Ba</button>
            <button type="button" data-who="ma" class="${todoDraftWho === "ma" ? "is-on" : ""}">Ma</button>
          </div>
          <input data-due type="date" aria-label="Due" />
          <button type="button" data-pri class="${todoDraftPri === "high" ? "is-on" : ""}">High</button>
          <button class="todo-add" type="submit">Add</button>
        </div>
      </form>
      <div class="todo-bar">
        <p class="todo-count">${openN} open · ${doneN} done</p>
        <div class="todo-filters">
          <button type="button" data-filter="open" class="${todoFilter === "open" ? "is-on" : ""}">Open</button>
          <button type="button" data-filter="done" class="${todoFilter === "done" ? "is-on" : ""}">Done</button>
          <button type="button" data-filter="all" class="${todoFilter === "all" ? "is-on" : ""}">All</button>
        </div>
        <button class="todo-clear" type="button" data-clear ${doneN ? "" : "hidden"}>Clear done</button>
      </div>
      <div class="todo-list" data-list></div>
      ${shown.length ? "" : `<p class="todo-empty">${all.length ? "Nothing in this list." : "No tasks yet."}</p>`}
    </div>
  `);
  const list = wrap.querySelector("[data-list]");
  const composer = wrap.querySelector("[data-new]");
  const dueInput = wrap.querySelector("[data-due]");
  const addRow = (item) => {
    const who = todoWhoOf(item);
    const pri = todoPriOf(item);
    const due = String(item.due || "");
    const overdue = Boolean(due && !item.done && due < isoToday());
    const whoLabel = who === "ba" ? "Ba" : who === "ma" ? "Ma" : "Us";
    const row = el(`
      <article class="todo-item ${item.done ? "is-done" : ""} ${pri === "high" ? "is-high" : ""} ${overdue ? "is-late" : ""}" data-id="${escapeHtml(item.id)}">
        <button type="button" data-done aria-label="${item.done ? "Not done" : "Done"}"></button>
        <div class="todo-body">
          <input data-text value="${escapeHtml(item.text || "")}" />
          <p class="todo-meta">
            <span>${whoLabel}</span>
            ${due ? `<span class="${overdue ? "is-late" : ""}">${overdue ? "Overdue · " : ""}${escapeHtml(todoDueLabel(due))}</span>` : ""}
            ${pri === "high" ? "<span>High</span>" : ""}
          </p>
        </div>
        <button type="button" data-del aria-label="Delete">×</button>
      </article>
    `);
    let wait = 0;
    row.querySelector("[data-done]").addEventListener("click", () => {
      const cur = (state.todos || []).find((todo) => todo.id === item.id);
      const next = !cur?.done;
      setState({
        todos: (state.todos || []).map((todo) =>
          todo.id === item.id ? { ...todo, done: next, doneAt: next ? Date.now() : 0 } : todo
        ),
      });
    });
    row.querySelector("[data-text]").addEventListener("input", (event) => {
      window.clearTimeout(wait);
      wait = window.setTimeout(() => {
        const text = event.target.value.trim();
        if (!text) {
          setState({ todos: (state.todos || []).filter((todo) => todo.id !== item.id) });
          return;
        }
        setState({
          todos: (state.todos || []).map((todo) => (todo.id === item.id ? { ...todo, text } : todo)),
        }, true);
      }, 350);
    });
    row.querySelector("[data-del]").addEventListener("click", () => {
      setState({ todos: (state.todos || []).filter((todo) => todo.id !== item.id) });
    });
    return row;
  };
  shown.forEach((item) => list.append(addRow(item)));
  wrap.querySelectorAll("[data-who]").forEach((button) => {
    button.addEventListener("click", () => {
      todoDraftWho = button.dataset.who === "ba" || button.dataset.who === "ma" ? button.dataset.who : "us";
      wrap.querySelectorAll("[data-who]").forEach((item) => item.classList.toggle("is-on", item === button));
    });
  });
  wrap.querySelector("[data-pri]").addEventListener("click", (event) => {
    todoDraftPri = todoDraftPri === "high" ? "normal" : "high";
    event.currentTarget.classList.toggle("is-on", todoDraftPri === "high");
  });
  wrap.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      todoFilter = button.dataset.filter;
      render();
    });
  });
  wrap.querySelector("[data-clear]").addEventListener("click", () => {
    setState({ todos: (state.todos || []).filter((todo) => !todo.done) });
  });
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = composer.value.trim();
    if (!text) return;
    const item = {
      id: uid(),
      text,
      done: false,
      from: currentName(),
      at: Date.now(),
      who: todoDraftWho,
      pri: todoDraftPri,
      due: dueInput.value || "",
    };
    composer.value = "";
    dueInput.value = "";
    todoDraftPri = "normal";
    setState({ todos: [item, ...(state.todos || [])] });
  });
  return wrap;
}

function settingsView() {
  const theme = readTheme();
  const wrap = el(`
    <div class="settings-page">
      <div class="theme-pick">
        <button type="button" data-theme="day" aria-label="Day" aria-pressed="${theme === "day"}" class="${theme === "day" ? "is-on" : ""}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.6" fill="currentColor"/>
            <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M12 3.4v2.1M12 18.5v2.1M3.4 12h2.1M18.5 12h2.1M6.2 6.2l1.5 1.5M16.3 16.3l1.5 1.5M6.2 17.8l1.5-1.5M16.3 7.7l1.5-1.5"/>
            </g>
          </svg>
        </button>
        <button type="button" data-theme="night" aria-label="Night" aria-pressed="${theme === "night"}" class="${theme === "night" ? "is-on" : ""}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M14.8 3.6a8.1 8.1 0 1 0 5.5 13.7 7.1 7.1 0 0 1-5.5-13.7z"/>
          </svg>
        </button>
      </div>
      <button class="settings-out" type="button" data-out>Log out</button>
    </div>
  `);
  wrap.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(button.dataset.theme);
      render();
    });
  });
  wrap.querySelector("[data-out]").addEventListener("click", () => logout());
  return wrap;
}

function routineView() {
  const first = partnerId();
  const second = selfId() || (first === "ma" ? "ba" : "ma");
  if (routineWho !== "ba" && routineWho !== "ma") routineWho = first;
  const wrap = el(`
    <div>
      <article class="card routine-pick">
        <div class="routine-switch">
          <button type="button" data-who="${first}" ${routineWho === first ? 'class="active"' : ""}>${first === "ma" ? "Ma" : "Ba"}</button>
          <button type="button" data-who="${second}" ${routineWho === second ? 'class="active"' : ""}>${second === "ma" ? "Ma" : "Ba"}</button>
        </div>
      </article>
      ${routineHtml(escapeHtml, routineWho)}
    </div>
  `);
  wrap.querySelectorAll("[data-who]").forEach((button) => {
    button.addEventListener("click", () => {
      routineWho = button.dataset.who;
      render();
    });
  });
  return wrap;
}

function applyPlaces(payload) {
  if (Array.isArray(payload?.pins) && payload.pins.length) {
    livePlaces = payload.pins.filter((pin) => pin && Number.isFinite(Number(pin.lat)));
    return;
  }
  livePlaces = ["ba", "ma"]
    .map((who) => (payload?.[who] ? { ...payload[who], id: who, who } : null))
    .filter(Boolean);
}

async function syncPlaces() {
  if (!session?.token || !session.roomId) return;
  const next = await loadPlaces(session.token);
  applyPlaces(next);
  const place = otherPlaceSig();
  const seen = loadSectionSeen();
  if (seen.where == null) {
    seen.where = place;
    saveSectionSeen(seen);
  } else if (place && seen.where !== place) {
    sectionUnread.where = true;
  }
  if (tab === "where") markSectionSeen("where");
  else setHomeBadges();
  drawWhereMap();
}

function rememberLocConsent() {
  try {
    localStorage.setItem(SHARE_LOC_KEY, "1");
  } catch {
    /* ignore */
  }
}

function forgetLocConsent() {
  try {
    localStorage.removeItem(SHARE_LOC_KEY);
  } catch {
    /* ignore */
  }
}

function sharingLoc() {
  try {
    return localStorage.getItem(SHARE_LOC_KEY) === "1";
  } catch {
    return false;
  }
}

async function locPermissionState() {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return sharingLoc() ? "granted" : "prompt";
  }
}

async function hydrateLocConsent() {
  if (sharingLoc()) {
    locReady = true;
    return true;
  }
  const state = await locPermissionState();
  if (state === "granted") {
    rememberLocConsent();
    locReady = true;
    return true;
  }
  return false;
}

function bindGeoResume() {
  if (window.__baGeoResume) return;
  window.__baGeoResume = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session?.token && sharingLoc()) startGeoShare();
  });
  window.addEventListener("focus", () => {
    if (session?.token && sharingLoc()) startGeoShare();
  });
}

const MAP_Z_MIN = 2;
const MAP_Z_MAX = 20;
const MAP_PIN_ZOOM = 18;
const INDIA_CENTER = { lat: 22.8, lng: 79.2 };
const OFM_STYLE = {
  night: "https://tiles.openfreemap.org/styles/dark",
  day: "https://tiles.openfreemap.org/styles/liberty",
};
let mapZoom = 5;
let whereFollow = false;
let whereSig = "";
let whereFull = false;
let whereCenter = { ...INDIA_CENTER };
let followPinId = "";
let whereMap = null;
let whereMapReady = false;
let whereMapMoving = false;
let whereMapBooting = false;
let whereMapGen = 0;
let whereStyleUrl = "";
let mapLibre = null;
const whereMarkers = new Map();

async function ensureMapLibre() {
  if (mapLibre) return mapLibre;
  const [mod] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
  mapLibre = mod;
  return mapLibre;
}

function clampZoom(z) {
  return Math.max(MAP_Z_MIN, Math.min(MAP_Z_MAX, z));
}

function mapStyleUrl() {
  return readTheme() === "day" ? OFM_STYLE.day : OFM_STYLE.night;
}

function rasterFallbackStyle() {
  return {
    version: 8,
    sources: {
      baRaster: {
        type: "raster",
        tiles: [`${API_BASE}/api/map/{z}/{x}/{y}?v=4`],
        tileSize: 256,
        attribution: "© OpenStreetMap",
        maxzoom: 19,
      },
    },
    layers: [{ id: "ba-raster", type: "raster", source: "baRaster" }],
  };
}

function setMapZoom(next, keepFollow = false) {
  const target = clampZoom(next);
  mapZoom = target;
  if (keepFollow) whereFollow = true;
  if (!whereMap) return;
  whereMap.easeTo({ zoom: target, duration: 280, essential: true });
}

function readLastPin() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_PIN_KEY) || "null");
    if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function writeLastPin(lat, lng, extra = {}) {
  const acc = Number(extra.acc);
  const heading = Number(extra.heading);
  localStorage.setItem(
    LAST_PIN_KEY,
    JSON.stringify({
      lat,
      lng,
      acc: Number.isFinite(acc) ? acc : undefined,
      heading: Number.isFinite(heading) && heading >= 0 ? heading : undefined,
      at: Date.now(),
    })
  );
}

function wherePins() {
  const rows = (Array.isArray(livePlaces) ? livePlaces : [])
    .filter((pin) => pin && Number.isFinite(Number(pin.lat)) && Number.isFinite(Number(pin.lng)))
    .map((pin) => ({ ...pin, id: pin.id || pin.who, who: coupleId(pin.who) || pin.who }));
  if (rows.length) return rows;
  const last = readLastPin();
  if (last && selfId()) return [{ ...last, id: deviceId(), who: selfId() }];
  return [];
}

function pinMark(pin, pins) {
  const letter = coupleId(pin.who) === "ma" ? "M" : "B";
  const same = pins.filter((row) => coupleId(row.who) === coupleId(pin.who));
  if (same.length < 2) return letter;
  return `${letter}${same.findIndex((row) => row.id === pin.id) + 1}`;
}

function followedPin(pins = wherePins()) {
  if (!whereFollow) return null;
  return pins.find((pin) => pin.id === followPinId) || pins.find((pin) => pin.id === deviceId()) || pins[0] || null;
}

function paintLocateButtons(pins = wherePins()) {
  const box = document.querySelector("[data-locates]");
  if (!box) return;
  const here = deviceId();
  const html = pins
    .map((pin) => {
      const mark = pinMark(pin, pins);
      const mine = coupleId(pin.who) === selfId();
      const self = pin.id === here;
      const on = whereFollow && followPinId === pin.id;
      const label = self ? "This phone" : coupleId(pin.who) === "ma" ? "Ma" : "Ba";
      return `<button type="button" class="map-locate ${mine ? "mine" : "theirs"}${self ? " here" : ""}${on ? " is-on" : ""}" data-go-pin="${escapeHtml(String(pin.id))}" aria-label="Go to ${escapeHtml(label)}">${escapeHtml(mark)}</button>`;
    })
    .join("");
  if (box.innerHTML === html) return;
  box.innerHTML = html;
}

function goToDevice(id) {
  const pins = wherePins();
  const pin = pins.find((row) => String(row.id) === String(id));
  if (!pin) return;
  followPinId = pin.id;
  whereFollow = true;
  whereCenter = { lat: Number(pin.lat), lng: Number(pin.lng) };
  mapZoom = Math.max(mapZoom, MAP_PIN_ZOOM);
  paintLocateButtons(pins);
  if (whereMapReady) flyToPin(pin, MAP_PIN_ZOOM);
  else drawWhereMap(true);
}

function pinSigOf(pins) {
  return pins
    .map(
      (pin) =>
        `${pin.id}:${pin.who}:${Number(pin.lat).toFixed(6)}:${Number(pin.lng).toFixed(6)}:${Math.round(Number(pin.acc) || 0)}:${Math.round(Number(pin.heading) ?? -1)}`
    )
    .join("|");
}

function circlePolygon(lng, lat, meters, steps = 64) {
  const coords = [];
  const latR = (meters / 6378137) * (180 / Math.PI);
  const lngR = latR / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

function accuracyGeoJSON(pins) {
  return {
    type: "FeatureCollection",
    features: pins
      .filter((pin) => Number(pin.acc) > 6)
      .map((pin) => ({
        type: "Feature",
        properties: {
          mine: coupleId(pin.who) === selfId() ? 1 : 0,
          here: pin.id === deviceId() ? 1 : 0,
        },
        geometry: circlePolygon(Number(pin.lng), Number(pin.lat), Number(pin.acc)),
      })),
  };
}

function addAccuracyLayers() {
  if (!whereMap || !whereMapReady) return;
  if (!whereMap.getSource("ba-acc")) {
    whereMap.addSource("ba-acc", { type: "geojson", data: accuracyGeoJSON(wherePins()) });
  }
  if (!whereMap.getLayer("ba-acc-fill")) {
    whereMap.addLayer({
      id: "ba-acc-fill",
      type: "fill",
      source: "ba-acc",
      paint: {
        "fill-color": ["case", ["==", ["get", "mine"], 1], "#6ea8ff", "#4ade80"],
        "fill-opacity": 0.16,
      },
    });
  }
  if (!whereMap.getLayer("ba-acc-line")) {
    whereMap.addLayer({
      id: "ba-acc-line",
      type: "line",
      source: "ba-acc",
      paint: {
        "line-color": ["case", ["==", ["get", "mine"], 1], "#6ea8ff", "#4ade80"],
        "line-opacity": 0.45,
        "line-width": 1.2,
      },
    });
  }
}

function syncAccuracyLayer(pins) {
  if (!whereMapReady) return;
  addAccuracyLayers();
  const src = whereMap.getSource("ba-acc");
  if (src) src.setData(accuracyGeoJSON(pins));
}

function pinHeading(pin) {
  const heading = Number(pin.heading);
  return Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : null;
}

function paintPinEl(el, pin, pins) {
  const mine = coupleId(pin.who) === selfId();
  const self = pin.id === deviceId();
  const heading = pinHeading(pin);
  const bearing = whereMap ? whereMap.getBearing() : 0;
  el.className = `inmap-dot ${mine ? "mine" : "theirs"}${self ? " here" : ""}${heading != null ? " has-head" : ""}`;
  el.dataset.goPin = String(pin.id);
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", self ? "This phone" : coupleId(pin.who) === "ma" ? "Ma" : "Ba");
  if (heading != null) el.style.setProperty("--heading", `${heading - bearing}deg`);
  else el.style.removeProperty("--heading");
  const mark = pinMark(pin, pins);
  if (el.dataset.mark !== mark || !el.querySelector("[data-mark]")) {
    el.dataset.mark = mark;
    el.innerHTML = `${heading != null ? '<i class="inmap-head" aria-hidden="true"></i>' : ""}<span data-mark>${escapeHtml(mark)}</span>`;
  } else if (heading != null && !el.querySelector(".inmap-head")) {
    el.insertAdjacentHTML("afterbegin", '<i class="inmap-head" aria-hidden="true"></i>');
  } else if (heading == null) {
    el.querySelector(".inmap-head")?.remove();
  }
}

function syncWhereMarkers(pins = wherePins()) {
  if (!whereMapReady) return;
  const ids = new Set(pins.map((pin) => String(pin.id)));
  for (const [id, rec] of whereMarkers) {
    if (ids.has(id)) continue;
    rec.marker.remove();
    whereMarkers.delete(id);
  }
  for (const pin of pins) {
    const id = String(pin.id);
    const lngLat = [Number(pin.lng), Number(pin.lat)];
    let rec = whereMarkers.get(id);
    if (!rec) {
      const el = document.createElement("button");
      el.type = "button";
      paintPinEl(el, pin, pins);
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        goToDevice(id);
      });
      rec = {
        marker: new mapLibre.Marker({ element: el, anchor: "center", pitchAlignment: "viewport", rotationAlignment: "viewport" })
          .setLngLat(lngLat)
          .addTo(whereMap),
        el,
      };
      whereMarkers.set(id, rec);
    } else {
      paintPinEl(rec.el, pin, pins);
      rec.marker.setLngLat(lngLat);
    }
  }
  syncAccuracyLayer(pins);
  paintLocateButtons(pins);
}

function rememberMapView() {
  if (!whereMap) return;
  const c = whereMap.getCenter();
  whereCenter = { lat: c.lat, lng: c.lng };
  mapZoom = whereMap.getZoom();
}

function flyToPin(pin, zoom = MAP_PIN_ZOOM) {
  if (!whereMap || !pin) return;
  whereMapMoving = true;
  const nextZoom = clampZoom(Math.max(whereMap.getZoom(), zoom));
  mapZoom = nextZoom;
  whereMap.flyTo({
    center: [Number(pin.lng), Number(pin.lat)],
    zoom: nextZoom,
    speed: 1.35,
    curve: 1.15,
    essential: true,
    padding: { top: 28, bottom: 88, left: 64, right: 64 },
  });
}

function followLivePin(pin) {
  if (!whereMapReady || !whereFollow || whereMapMoving || !pin) return;
  const c = whereMap.getCenter();
  if (Math.abs(c.lat - Number(pin.lat)) < 8e-7 && Math.abs(c.lng - Number(pin.lng)) < 8e-7) return;
  whereMap.easeTo({
    center: [Number(pin.lng), Number(pin.lat)],
    duration: 640,
    essential: true,
  });
}

function teardownWhereMap() {
  for (const rec of whereMarkers.values()) rec.marker.remove();
  whereMarkers.clear();
  whereMapReady = false;
  whereMapMoving = false;
  whereMapBooting = false;
  whereMapGen += 1;
  whereStyleUrl = "";
  if (whereMap) {
    whereMap.remove();
    whereMap = null;
  }
}

function applyWhereMapStyle() {
  if (!whereMap) return;
  const url = mapStyleUrl();
  if (url === whereStyleUrl) return;
  whereStyleUrl = url;
  whereMapReady = false;
  whereMap.setStyle(url, { diff: false });
}

function bindWhereMapEvents() {
  if (!whereMap) return;
  const onReady = () => {
    whereMapReady = true;
    addAccuracyLayers();
    syncWhereMarkers();
    const pin = followedPin();
    if (pin && whereFollow) flyToPin(pin, Math.max(mapZoom, MAP_PIN_ZOOM));
  };
  whereMap.on("style.load", onReady);
  if (whereMap.isStyleLoaded && whereMap.isStyleLoaded()) onReady();
  whereMap.on("dragstart", () => {
    whereFollow = false;
    paintLocateButtons();
  });
  whereMap.on("rotatestart", () => {
    whereFollow = false;
    paintLocateButtons();
  });
  whereMap.on("pitchstart", () => {
    whereFollow = false;
    paintLocateButtons();
  });
  whereMap.on("moveend", () => {
    whereMapMoving = false;
    rememberMapView();
    syncWhereMarkers();
  });
  whereMap.on("rotate", () => syncWhereMarkers());
  whereMap.on("error", (event) => {
    if (whereMapReady || whereStyleUrl === "raster") return;
    const err = event?.error;
    const msg = String(err?.message || err || "");
    if (!msg || !/style|fetch|network|ajax|load/i.test(msg)) return;
    whereStyleUrl = "raster";
    whereMap.setStyle(rasterFallbackStyle(), { diff: false });
  });
}

async function initWhereMap(stage) {
  if (whereMap || whereMapBooting) return;
  whereMapBooting = true;
  const gen = ++whereMapGen;
  try {
    await ensureMapLibre();
    if (gen !== whereMapGen || !stage.isConnected || whereMap) return;
    const pins = wherePins();
    const focus = followedPin(pins) || pins.find((pin) => pin.id === deviceId()) || pins[0] || whereCenter || INDIA_CENTER;
    const startZoom = clampZoom(pins.length ? Math.max(mapZoom, 16) : mapZoom);
    mapZoom = startZoom;
    whereStyleUrl = mapStyleUrl();
    whereMap = new mapLibre.Map({
      container: stage,
      style: whereStyleUrl,
      center: [Number(focus.lng), Number(focus.lat)],
      zoom: startZoom,
      minZoom: MAP_Z_MIN,
      maxZoom: MAP_Z_MAX,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      fadeDuration: 180,
      attributionControl: { compact: true },
      maplibreLogo: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2.5),
      canvasContextAttributes: { antialias: true, powerPreference: "high-performance" },
      refreshExpiredTiles: true,
      trackResize: true,
      renderWorldCopies: true,
      validateStyle: false,
      cooperativeGestures: false,
      maxTileCacheZoomLevels: 10,
    });
    whereMap.touchZoomRotate.enable();
    whereMap.touchZoomRotate.enableRotation();
    whereMap.scrollZoom.setWheelZoomRate(1 / 140);
    bindWhereMapEvents();
  } finally {
    if (gen === whereMapGen) whereMapBooting = false;
  }
}

function paintWhereChrome(pins) {
  const ago = document.querySelector("[data-place-ago]");
  const note = document.querySelector("[data-geo-note]");
  if (ago) {
    const newest = pins.reduce((max, pin) => Math.max(max, Number(pin.at) || 0), 0);
    ago.textContent = newest ? fmtAgo(newest) : "";
  }
  if (note && !note.textContent) note.textContent = geoNote || (pins.length ? "" : "Waiting for location.");
  paintLocateButtons(pins);
}

function drawWhereMap(force = false) {
  const stage = document.querySelector("[data-live-map]");
  if (!stage) {
    teardownWhereMap();
    return;
  }
  const pins = wherePins();
  paintWhereChrome(pins);
  if (whereMap && whereMap.getContainer() !== stage) teardownWhereMap();
  const sig = `${pinSigOf(pins)}:${whereFull}`;
  if (!whereMap) {
    whereSig = sig;
    initWhereMap(stage);
    return;
  }
  whereMap.resize();
  if (!force && sig === whereSig) {
    syncWhereMarkers(pins);
    return;
  }
  whereSig = sig;
  syncWhereMarkers(pins);
  if (force && whereFollow) {
    const pin = followedPin(pins);
    if (pin) flyToPin(pin, MAP_PIN_ZOOM);
  } else if (whereFollow) {
    followLivePin(followedPin(pins));
  }
}

function mapFullIcon(full) {
  return full
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3v2H5v4H3V3h6zm12 0v6h-2V5h-4V3h6zM3 15h2v4h4v2H3v-6zm18 0v6h-6v-2h4v-4h2z"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm16 0v5h-5v-2h3v-3h2z"/></svg>`;
}

function toggleMapFull() {
  whereFull = !whereFull;
  const stage = document.querySelector("[data-place-stage]");
  const btn = document.querySelector("[data-map-full]");
  document.body.classList.toggle("map-full", whereFull);
  if (stage) stage.classList.toggle("is-full", whereFull);
  if (btn) {
    btn.innerHTML = mapFullIcon(whereFull);
    btn.setAttribute("aria-label", whereFull ? "Exit full screen" : "Full screen");
  }
  whereSig = "";
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (whereMap) whereMap.resize();
      else drawWhereMap(true);
    })
  );
}

function pushPlace(pos) {
  geoNote = "";
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = pos.coords.accuracy;
  const heading = Number(pos.coords.heading);
  writeLastPin(lat, lng, { acc, heading });
  const note = document.querySelector("[data-geo-note]");
  if (note) note.textContent = "";
  if (!session?.token) {
    drawWhereMap();
    return;
  }
  sendPlace(session.token, {
    share: true,
    lat,
    lng,
    acc,
    heading: Number.isFinite(heading) && heading >= 0 ? heading : undefined,
    deviceId: deviceId(),
  })
    .then((next) => {
      applyPlaces(next);
      if (document.querySelector("[data-live-map]")) drawWhereMap();
    })
    .catch((error) => {
      livePlaces = [
        ...wherePins().filter((pin) => pin.id !== deviceId()),
        {
          id: deviceId(),
          who: selfId(),
          lat,
          lng,
          acc,
          heading: Number.isFinite(heading) && heading >= 0 ? heading : null,
          at: Date.now(),
        },
      ];
      geoNote = error.message || "Could not send location.";
      const box = document.querySelector("[data-geo-note]");
      if (box) box.textContent = geoNote;
      drawWhereMap();
    });
}

function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      locReady = false;
      forgetLocConsent();
      geoNote = "This phone cannot share location.";
      resolve(false);
      return;
    }
    if (!window.isSecureContext) {
      locReady = false;
      geoNote = "Location needs a secure connection.";
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const pass = (pos) => {
      locReady = true;
      geoNote = "";
      rememberLocConsent();
      if (pos?.coords) pushPlace(pos);
      startGeoWatch();
      if (session?.token) render();
      done(true);
    };
    const fail = (error) => {
      if (error?.code === 1) {
        locReady = false;
        forgetLocConsent();
        geoNote = "Location must be allowed.";
        done(false);
        return;
      }
      locReady = true;
      geoNote = "";
      rememberLocConsent();
      startGeoWatch();
      if (session?.token) render();
      done(true);
    };
    const coarse = { enableHighAccuracy: false, maximumAge: 120000, timeout: 8000 };
    const fine = { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 };
    navigator.geolocation.getCurrentPosition(
      pass,
      (error) => {
        if (error?.code === 1) {
          fail(error);
          return;
        }
        navigator.geolocation.getCurrentPosition(pass, fail, fine);
      },
      coarse
    );
  });
}

function onGeoWatchError(error) {
  if (error?.code === 1) {
    locReady = false;
    forgetLocConsent();
    geoNote = "Location must be allowed.";
    stopGeoShare();
    if (session?.token) render();
  }
}

function startGeoWatch() {
  bindGeoResume();
  if (!navigator.geolocation) return;
  if (!geoWatch) {
    geoWatch = navigator.geolocation.watchPosition(pushPlace, onGeoWatchError, {
      enableHighAccuracy: true,
      maximumAge: 4000,
      timeout: 20000,
    });
  }
  if (!geoTick) {
    geoTick = window.setInterval(() => {
      if (!session?.token || !sharingLoc() || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(pushPlace, () => {}, {
        enableHighAccuracy: false,
        maximumAge: 30000,
        timeout: 15000,
      });
    }, 45000);
  }
}

function startGeoShare() {
  if (!session?.token) return;
  bindGeoResume();
  if (sharingLoc() || locReady) {
    locReady = true;
    startGeoWatch();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pushPlace, () => {}, {
        enableHighAccuracy: false,
        maximumAge: 60000,
        timeout: 12000,
      });
    }
    return;
  }
  requestLocation().then((ok) => {
    if (!ok && session?.token && !sharingLoc()) render();
  });
}

function stopGeoShare() {
  if (geoWatch) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = 0;
  window.clearInterval(geoTick);
  geoTick = 0;
}

function locationView() {
  whereSig = "";
  const pins = wherePins();
  if (pins.length) {
    const self = pins.find((pin) => pin.id === deviceId()) || pins[0];
    if (!followPinId) followPinId = self.id;
    const pin = pins.find((row) => row.id === followPinId) || self;
    whereFollow = true;
    whereCenter = { lat: Number(pin.lat), lng: Number(pin.lng) };
    if (mapZoom < 14) mapZoom = 16;
  }
  const wrap = el(`
    <div class="where">
      <p class="muted tiny" data-geo-note>${escapeHtml(geoNote)}</p>
      <div class="place-stage ${whereFull ? "is-full" : ""}" data-place-stage>
        <div class="place-map" data-live-map></div>
        <div class="map-locates" data-locates></div>
        <div class="map-tools">
          <button type="button" data-zoom-in aria-label="Zoom in">+</button>
          <button type="button" data-zoom-out aria-label="Zoom out">−</button>
          <button type="button" data-map-full aria-label="${whereFull ? "Exit full screen" : "Full screen"}">${mapFullIcon(whereFull)}</button>
        </div>
      </div>
      <p class="muted tiny" data-place-ago></p>
    </div>
  `);
  wrap.querySelector("[data-zoom-in]").addEventListener("click", () => setMapZoom(mapZoom + 1, whereFollow));
  wrap.querySelector("[data-zoom-out]").addEventListener("click", () => setMapZoom(mapZoom - 1, whereFollow));
  wrap.querySelector("[data-map-full]").addEventListener("click", toggleMapFull);
  wrap.querySelector("[data-locates]").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-go-pin]");
    if (!btn) return;
    goToDevice(btn.dataset.goPin);
  });
  startGeoShare();
  syncPlaces().catch(() => {});
  requestAnimationFrame(() => requestAnimationFrame(() => drawWhereMap(true)));
  return wrap;
}

function pageTitle() {
  if (tab === "home") return "Ba";
  if (tab === "memories" || tab === "dates") return "Memories";
  const names = {
    routine: "Routine",
    where: "Where",
    today: "Today",
    us: "Us",
    family: "Family",
    todo: "To Do",
    settings: "Settings",
  };
  return names[tab] || "Ba";
}

function appView() {
  if (tab === "chat") return chatView();
  const shell = el(`
    <div class="shell">
      <header class="topbar">
        ${tab === "home" ? "" : `<button class="back-ghost" type="button" data-back aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.5 5.5 8 12l7.5 6.5 1.4-1.6L11.2 12l5.7-5.9z"/></svg>
        </button>`}
        <h1 class="wordmark">${escapeHtml(pageTitle())}</h1>
      </header>
    </div>
  `);
  const back = shell.querySelector("[data-back]");
  if (back) back.addEventListener("click", goHome);
  const views = {
    home: homeView,
    routine: routineView,
    where: locationView,
    today: todayView,
    dates: datesView,
    us: usView,
    todo: todoView,
    family: familyView,
    memories: datesView,
    settings: settingsView,
  };
  shell.append((views[tab] || homeView)());
  return shell;
}

function render() {
  document.body.classList.toggle("wa-open", Boolean(session?.token && session.roomId && tab === "chat"));
  document.body.classList.toggle("map-full", Boolean(whereFull && tab === "where"));
  document.body.classList.toggle("on-family", Boolean(session?.token && tab === "family"));
  if (!session?.token || !session.roomId) {
    teardownWhereMap();
    root.replaceChildren(gateView());
    return;
  }
  if (!sharingLoc() && !locReady) {
    teardownWhereMap();
    root.replaceChildren(locGateView());
    return;
  }
  locReady = true;
  startGeoShare();
  if (tab === "chat" && document.querySelector(".wa-app")) return;
  teardownWhereMap();
  root.replaceChildren(appView());
}

async function boot() {
  await initNative();
  await hydrateLocConsent();
  if (!session?.token) {
    render();
    return;
  }
  try {
    const me = await loadMe(session.token);
    const payload = await loadCloud(session.token);
    await openSession({
      ...payload,
      token: session.token,
      username: coupleId(me.username) || coupleId(session.username) || readSavedWho(),
    });
  } catch {
    session = null;
    saveSession(null);
    render();
  }
}

boot();
