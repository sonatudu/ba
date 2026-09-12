import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { acceptRequest, declineRequest, deleteAccount, listRequests, loadChat, loadCloud, loadMe, loadSignals, loginUser, logoutCloud, pingPresence, readChat, registerUser, saveCloud, sendChat, sendRequest, sendSignal, sendStatus, setDisappear, typingChat, updateChat } from "./api.js";
import { decryptPayload, deriveSpaceKey, encryptPayload } from "./crypto.js";
import { routineHtml } from "./routine.js";

const SESSION_KEY = "ba-session-v1";

async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#070b16" });
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

const MOODS = ["soft", "giddy", "tired", "brave", "tender", "spicy", "home"];

const defaultState = () => ({
  you: "",
  them: "",
  startedOn: "",
  nextDate: "",
  notes: [],
  dates: [],
  moods: [],
  memories: [],
  answers: [],
  pokes: [],
  thanks: [],
  songs: [],
  sealed: [],
  promises: [],
  checkins: [],
});

function contentState(value) {
  const source = value || defaultState();
  return {
    startedOn: source.startedOn || "",
    nextDate: source.nextDate || "",
    notes: source.notes || [],
    dates: source.dates || [],
    moods: source.moods || [],
    memories: source.memories || [],
    answers: source.answers || [],
    pokes: source.pokes || [],
    thanks: source.thanks || [],
    songs: source.songs || [],
    sealed: source.sealed || [],
    promises: source.promises || [],
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
  return Math.max(0, Math.floor((now - start) / 86400000));
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

function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(`${iso}T12:00:00`);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((target - now) / 86400000);
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

function sealedIsLocked(item) {
  if (item.openedAt) return false;
  if (!item.unlockOn) return false;
  return daysUntil(item.unlockOn) > 0;
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

function datePickerHtml(name, iso = "", { required = false, future = false } = {}) {
  const now = new Date().getFullYear();
  const minYear = 1980;
  const maxYear = future ? now + 8 : now;
  const [year = "", month = "", day = ""] = iso ? iso.split("-") : [];
  const years = [];
  for (let y = maxYear; y >= minYear; y -= 1) years.push(y);
  return `
    <div class="date-picker" data-date-name="${name}">
      <select data-part="y" aria-label="Year"${required ? " required" : ""}>
        <option value="">Year</option>
        ${years.map((y) => `<option value="${y}" ${String(y) === year ? "selected" : ""}>${y}</option>`).join("")}
      </select>
      <select data-part="m" aria-label="Month"${required ? " required" : ""}>
        <option value="">Month</option>
        ${MONTHS.map(([value, label]) => `<option value="${value}" ${value === month ? "selected" : ""}>${label}</option>`).join("")}
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
  const me = session?.username;
  if (!me) return state.them;
  const fromChat = chatLog.find((item) => item.from && item.from !== me)?.from;
  if (fromChat) return fromChat;
  if (session.you && session.you !== me) return session.you;
  if (session.them && session.them !== me) return session.them;
  if (state.you === me) return state.them;
  if (state.them === me) return state.you;
  return state.them || "";
}

function otherStamp(map) {
  const me = session?.username;
  let max = 0;
  for (const [name, value] of Object.entries(map || {})) {
    if (name !== me) max = Math.max(max, Number(value) || 0);
  }
  return max;
}

function receiptOf(item, mine) {
  if (item.pending) return "sent";
  const readAt = mine ? otherStamp(chatReadAt) : Number(chatReadAt[session.username] || 0);
  const deliveredAt = mine ? otherStamp(chatDeliveredAt) : Number(chatDeliveredAt[session.username] || 0);
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

function startChatLoop() {
  stopChatLoop();
  if (!session?.token || !session.roomId) return;
  syncChat().catch(() => {});
  pingPresence(session.token);
  pullSignals().catch(() => {});
  chatTimer = window.setInterval(() => {
    syncChat().catch(() => {});
    pingPresence(session.token);
    pullSignals().catch(() => {});
  }, tab === "chat" || callState ? 900 : 3500);
}

function setChatBadge() {
  const button = document.querySelector('[data-tab="chat"]');
  if (!button) return;
  button.innerHTML = chatUnread ? `Chat <span class="nav-badge">${chatUnread}</span>` : "Chat";
}

async function decodeChatRows(rows) {
  const out = [];
  for (const row of rows || []) {
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
    out.push({
      id: row.id,
      from: row.from,
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
    });
  }
  return out;
}

async function decodeStatusRows(rows) {
  const out = [];
  const cutoff = Date.now() - 86400000;
  for (const row of rows || []) {
    if (Number(row.at) < cutoff) continue;
    let opened = {};
    try {
      opened = (await decryptPayload(spaceKey, row.iv, row.blob)) || {};
    } catch {
      opened = {};
    }
    const image = typeof opened.image === "string" && /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(opened.image)
      ? opened.image
      : "";
    out.push({
      id: row.id,
      from: row.from,
      at: row.at,
      text: String(opened.text || ""),
      image,
    });
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
  if (chatDisappearMs) rows = rows.filter((item) => Date.now() - item.at < chatDisappearMs);
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
  const partner = partnerUsername();
  const newFromThem = next.filter((item) => item.from === partner && !chatLog.some((old) => old.id === item.id));
  chatLog = next;
  chatReadAt = payload.readAt || {};
  chatDeliveredAt = payload.deliveredAt || {};
  chatTyping = Boolean(payload.typing);
  chatPartnerOnline = Boolean(payload.online);
  chatPartnerSeen = Number(payload.lastSeen || 0);
  chatDisappearMs = Number(payload.disappearMs || 0);
  chatStatuses = await decodeStatusRows(payload.statuses);
  if (payload.incomingCall?.data && !callState) {
    pendingOffer = payload.incomingCall.data;
    callVideo = Boolean(payload.incomingCall.video);
    callState = "in";
    renderCallUi();
  }
  if (tab === "chat") {
    chatUnread = 0;
    if (newFromThem.length) readChat(session.token).catch(() => {});
    const thread = document.querySelector("[data-chat-thread]");
    if (thread) paintChatThread(thread, after !== before && newFromThem.length > 0);
    const status = document.querySelector("[data-chat-status]");
    if (status) status.textContent = chatTyping ? "typing…" : chatPartnerOnline ? "online" : chatPartnerSeen ? `last seen ${fmtClock(chatPartnerSeen)}` : "tap here for info";
    refreshChatChrome();
  } else if (newFromThem.length) {
    chatUnread += newFromThem.length;
    setChatBadge();
  }
}

function paintChatThread(thread, stickToBottom) {
  const nearBottom = stickToBottom || thread.scrollHeight - thread.scrollTop < thread.clientHeight + 90;
  const prevTop = thread.scrollTop;
  const me = session.username;
  const parts = [];
  const pinned = visibleChatLog().filter((item) => item.pinned && !item.deleted);
  if (pinned.length) {
    parts.push(
      `<div class="pin-bar">${pinned
        .slice(-3)
        .map((item) => `<button type="button" data-jump="${escapeHtml(item.id)}">📌 ${escapeHtml(previewChat(item).slice(0, 48))}</button>`)
        .join("")}</div>`
    );
  }
  let lastDay = "";
  visibleChatLog().forEach((item) => {
    const day = chatDayLabel(item.at);
    if (day !== lastDay) {
      parts.push(`<div class="chat-day">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    const mine = item.from === me;
    const receipt = receiptOf(item, mine);
    const fill = RECEIPT_BG[receipt] || RECEIPT_BG.sent;
    const selected = chatSelected.has(item.id);
    const reacts = Object.values(item.reactions || {}).filter(Boolean);
    const reactHtml = reacts.length
      ? `<div class="chat-reacts">${reacts.map((mark) => `<span>${escapeHtml(mark)}</span>`).join("")}</div>`
      : "";
    let body = "";
    if (!item.deleted) {
      const quote = item.replyId
        ? `<button class="chat-quote" type="button" data-jump="${escapeHtml(item.replyId)}"><strong>${escapeHtml(item.replyFrom || "them")}</strong><span>${escapeHtml((item.replyText || "Photo").slice(0, 80))}</span></button>`
        : "";
      let photo = "";
      if (item.image && item.viewOnce && item.viewed && item.from !== me) photo = `<div class="bubble-deleted">Viewed once</div>`;
      else if (item.image && item.viewOnce && !item.viewed && item.from !== me) photo = `<button class="view-once" type="button" data-viewonce="${escapeHtml(item.id)}">Photo · view once</button>`;
      else if (item.image) photo = `<img class="chat-photo" alt="" src="${item.image}">`;
      const voice = item.audio
        ? `<div class="voice-row"><button type="button" data-play="${escapeHtml(item.id)}">▶</button><span>${Math.max(1, Math.round(item.duration || 1))}″</span><audio data-audio="${escapeHtml(item.id)}" src="${item.audio}" preload="metadata"></audio></div>`
        : "";
      const loc = item.type === "location" && item.lat
        ? `<a class="chat-map" href="https://maps.google.com/?q=${item.lat},${item.lng}" target="_blank" rel="noreferrer">📍 Location</a>`
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
      body = `${quote}${photo}${voice}${loc}${poll}${text}`;
    }
    parts.push(`
      <div class="bubble-row ${mine ? "mine" : "theirs"} is-${receipt} ${selected ? "selected" : ""}" data-mid="${escapeHtml(item.id)}">
        <div class="swipe-hint">Reply</div>
        <div class="bubble" style="background:${fill}">
          ${body}
          ${reactHtml}
          <div class="bubble-meta">
            <span>${fmtClock(item.at)}</span>
          </div>
        </div>
      </div>
    `);
  });
  thread.innerHTML = parts.length ? parts.join("") : `<div class="chat-empty">Say hi. Swipe a message to reply.</div>`;
  if (nearBottom) thread.scrollTop = thread.scrollHeight;
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
  const clearDrag = () => {
    window.clearTimeout(longTimer);
    chatDragging = false;
    swiping = false;
    swipeShift = 0;
    if (bubble) bubble.style.transform = "";
    if (row) row.classList.remove("is-swiping");
    row = null;
    bubble = null;
  };
  thread.addEventListener("pointerdown", (event) => {
    row = event.target.closest("[data-mid]");
    if (!row) return;
    bubble = row.querySelector(".bubble");
    startX = event.clientX;
    startY = event.clientY;
    swipeShift = 0;
    chatDragging = true;
    thread.setPointerCapture?.(event.pointerId);
    longTimer = window.setTimeout(() => {
      swiping = false;
      swipeShift = 0;
      if (bubble) bubble.style.transform = "";
      skipClick = true;
      chatSelectMode = true;
      chatSelected.add(row.dataset.mid);
      row.classList.add("selected");
      openChatMenu(row.dataset.mid);
      navigator.vibrate?.(12);
    }, 420);
  });
  thread.addEventListener("pointermove", (event) => {
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
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swiping = true;
      row.classList.add("is-swiping");
      swipeShift = Math.max(0, Math.min(72, dx));
      bubble.style.transform = `translateX(${swipeShift}px)`;
    }
  });
  thread.addEventListener("pointerup", () => {
    const id = row?.dataset.mid;
    const didSwipe = swiping && swipeShift > 48;
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
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    const play = event.target.closest("[data-play]");
    if (play) {
      const audio = thread.querySelector(`[data-audio="${play.dataset.play}"]`);
      if (audio) {
        if (audio.paused) audio.play();
        else audio.pause();
      }
      return;
    }
    const vote = event.target.closest("[data-vote]");
    if (vote) {
      const pollBox = vote.closest("[data-poll]");
      const item = chatLog.find((row) => row.id === pollBox?.dataset.poll);
      if (item?.poll) {
        const idx = Number(vote.dataset.vote);
        item.poll.options.forEach((opt) => {
          if (opt.votes) delete opt.votes[session.username];
        });
        item.poll.options[idx].votes = { ...(item.poll.options[idx].votes || {}), [session.username]: true };
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
  if (menu) menu.hidden = false;
  if (dim) dim.hidden = false;
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
      bar.querySelector("[data-reply-who]").textContent = chatReply.from === session.username ? "You" : chatReply.from;
      bar.querySelector("[data-reply-text]").textContent = previewChat(chatReply).slice(0, 80);
    }
  }
  const select = document.querySelector("[data-select-bar]");
  const head = document.querySelector("[data-chat-head]");
  if (select) {
    select.hidden = !chatSelectMode;
    const count = select.querySelector("[data-select-count]");
    if (count) count.textContent = `${chatSelected.size} selected`;
  }
  if (head) head.hidden = chatSelectMode;
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
  const audio = extra.audio || "";
  if ((!trimmed && !image && !audio && extra.type !== "location" && extra.type !== "poll") || !spaceKey) return;
  if (chatEditId) {
    const item = chatLog.find((row) => row.id === chatEditId);
    if (item && item.from === session.username) {
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
    from: session.username,
    at,
    text: trimmed,
    type: extra.type || (audio ? "voice" : image ? "image" : "text"),
    image,
    audio,
    duration: extra.duration || 0,
    lat: extra.lat,
    lng: extra.lng,
    poll: extra.poll || null,
    viewOnce: Boolean(extra.viewOnce),
    viewed: false,
    edited: false,
    pinned: false,
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

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 720;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.62));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo."));
    };
    img.src = url;
  });
}

let state = defaultState();
let session = loadSession();
let spaceKey = null;
let saveTimer = 0;
let tab = "home";
let routineWho = "ba";
let gate = "home";
let createdInvite = "";
let inbox = { incoming: [], outgoing: [] };
let chatLog = [];
let chatReadAt = {};
let chatDeliveredAt = {};
let chatTyping = false;
let chatUnread = 0;
let chatTimer = 0;
let typingTimer = 0;
let chatReply = null;
let chatSelected = new Set();
let chatSelectMode = false;
let chatDragging = false;
let chatQuery = "";
let chatMenuId = "";
let chatPartnerOnline = false;
let chatPartnerSeen = 0;
let chatDisappearMs = 0;
let chatEditId = "";
let chatStatuses = [];
let callState = "";
let callVideo = false;
let callPc = null;
let callStream = null;
let pendingOffer = null;
let voiceRec = null;
const root = document.getElementById("app");

async function persist() {
  if (!session?.token || !session.roomId || !spaceKey) return;
  const sealed = await encryptPayload(spaceKey, contentState(state));
  await saveCloud(session.token, sealed);
}

function setState(patch) {
  state = { ...state, ...patch };
  render();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    persist().catch((error) => console.error(error));
  }, 400);
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
    you: payload.you,
    them: payload.them,
    startedOn: payload.startedOn,
    ...contentState(opened),
  };
  session = {
    token: payload.token,
    username: payload.username,
    who: payload.who,
    you: payload.you,
    them: payload.them,
    roomId,
    kdfSalt: payload.kdfSalt,
  };
  saveSession(session);
  createdInvite = roomId;
  gate = "home";
  render();
  startChatLoop();
}

function gateView() {
  const card = el(`
    <div class="setup">
      <div class="setup-card">
        <p class="kicker">private rooms</p>
        <h1>Ba</h1>
        <p class="lede">Each couple gets one unique room. Once that room id is taken, nobody else can claim it.</p>
        <div class="btn-row">
          <button class="btn rose" type="button" data-login>Already a user</button>
          <button class="btn ghost" type="button" data-register>New user</button>
        </div>
      </div>
    </div>
  `);
  card.querySelector("[data-login]").addEventListener("click", () => {
    gate = "login";
    render();
  });
  card.querySelector("[data-register]").addEventListener("click", () => {
    gate = "register";
    render();
  });
  return card;
}

function registerView() {
  const card = el(`
    <div class="setup">
      <form class="setup-card">
        <p class="kicker">new user</p>
        <h1>Ba</h1>
        <p class="lede">Create your own username and password. After login you can send a room request. Your partner must accept it.</p>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" required minlength="3" maxlength="24" placeholder="your_name" autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" required minlength="4" autocomplete="new-password" />
        </div>
        <p class="err" data-err></p>
        <div class="btn-row">
          <button class="btn rose" type="submit">Create user</button>
          <button class="btn ghost" type="button" data-back>Back</button>
        </div>
      </form>
    </div>
  `);
  card.querySelector("[data-back]").addEventListener("click", () => {
    gate = "home";
    render();
  });
  card.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = card.querySelector("[data-err]");
    try {
      const made = await registerUser({
        username: card.querySelector("#username").value,
        password: card.querySelector("#password").value,
      });
      session = { token: made.token, username: made.username, roomId: null };
      saveSession(session);
      await refreshInbox();
      render();
    } catch (error) {
      err.textContent = error.message;
    }
  });
  return card;
}

async function refreshInbox() {
  if (!session?.token || session.roomId) return;
  try {
    inbox = await listRequests(session.token);
  } catch {
    inbox = { incoming: [], outgoing: [] };
  }
}

function waitingView() {
  const incoming = inbox.incoming || [];
  const outgoing = inbox.outgoing || [];
  const page = el(`
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="kicker">home</p>
          <h1 class="wordmark">Ba</h1>
          <p class="who">Signed in as ${escapeHtml(session.username)}</p>
        </div>
        <button class="btn ghost" type="button" data-logout>Log out</button>
      </header>
      <article class="card" style="margin-bottom:16px">
        <h3>Incoming requests</h3>
        <p class="muted">If someone wants to add you to their room, accept or decline here.</p>
        <div class="list" data-incoming></div>
      </article>
      <article class="card" style="margin-bottom:16px">
        <h3>Sent requests</h3>
        <div class="list" data-outgoing></div>
      </article>
      <article class="card">
        <h3>Ask someone to join a room</h3>
        <form>
          <div class="field">
            <label for="partner">Partner username</label>
            <input id="partner" required minlength="3" maxlength="24" placeholder="their_username" />
          </div>
          <div class="field">
            <label for="customRoom">Room id (optional)</label>
            <input id="customRoom" maxlength="24" placeholder="Leave blank to get a unique id" />
          </div>
          <div class="field">
            <label for="message">Message</label>
            <textarea id="message" placeholder="Want to share a room with me?"></textarea>
          </div>
          <p class="err" data-err></p>
          <button class="btn rose" type="submit">Send request</button>
        </form>
      </article>
    </div>
  `);
  page.append(accountDeleteCard(false));
  const incomingBox = page.querySelector("[data-incoming]");
  if (!incoming.length) {
    incomingBox.append(el(`<div class="empty">No requests right now.</div>`));
  } else {
    incoming.forEach((item) => {
      const row = el(`
        <article class="note">
          <div class="meta"><span>${escapeHtml(item.from)} wants a room</span><span>${item.roomId ? escapeHtml(item.roomId) : ""}</span></div>
          <div>${item.message ? escapeHtml(item.message) : "No message"}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn rose" type="button" data-accept>Accept</button>
            <button class="btn ghost" type="button" data-decline>Decline</button>
          </div>
        </article>
      `);
      row.querySelector("[data-accept]").addEventListener("click", async () => {
        try {
          const joined = await acceptRequest(session.token, item.id);
          await openSession(joined);
        } catch (error) {
          alert(error.message);
        }
      });
      row.querySelector("[data-decline]").addEventListener("click", async () => {
        try {
          await declineRequest(session.token, item.id);
          await refreshInbox();
          render();
        } catch (error) {
          alert(error.message);
        }
      });
      incomingBox.append(row);
    });
  }
  const outgoingBox = page.querySelector("[data-outgoing]");
  if (!outgoing.length) {
    outgoingBox.append(el(`<div class="empty">You have not sent a request yet.</div>`));
  } else {
    outgoing.forEach((item) => {
      const row = el(`
        <article class="note">
          <div class="meta"><span>Waiting on ${escapeHtml(item.to)}</span><span>${escapeHtml(item.roomId || "")}</span></div>
          <div>${item.message ? escapeHtml(item.message) : "No message"}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ghost" type="button" data-cancel>Cancel</button>
          </div>
        </article>
      `);
      row.querySelector("[data-cancel]").addEventListener("click", async () => {
        try {
          await declineRequest(session.token, item.id);
          await refreshInbox();
          render();
        } catch (error) {
          alert(error.message);
        }
      });
      outgoingBox.append(row);
    });
  }
  page.querySelector("[data-logout]").addEventListener("click", logout);
  bindAccountDelete(page);
  page.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = page.querySelector("[data-err]");
    err.textContent = "";
    try {
      await sendRequest(session.token, {
        partner: page.querySelector("#partner").value,
        roomId: page.querySelector("#customRoom").value,
        message: page.querySelector("#message").value,
      });
      await refreshInbox();
      render();
    } catch (error) {
      err.textContent = error.message;
    }
  });
  return page;
}

function loginView() {
  const card = el(`
    <div class="setup">
      <form class="setup-card">
        <p class="kicker">already a user</p>
        <h1>Ba</h1>
        <p class="lede">Log in with your username and password. After that you can create a room with your partner.</p>
        <div class="field">
          <label for="username">Username</label>
          <input id="username" required minlength="3" maxlength="24" autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" required autocomplete="current-password" />
        </div>
        <p class="err" data-err></p>
        <div class="btn-row">
          <button class="btn rose" type="submit">Log in</button>
          <button class="btn ghost" type="button" data-back>Back</button>
        </div>
      </form>
    </div>
  `);
  card.querySelector("[data-back]").addEventListener("click", () => {
    gate = "home";
    render();
  });
  card.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = card.querySelector("[data-err]");
    try {
      const logged = await loginUser({
        username: card.querySelector("#username").value,
        password: card.querySelector("#password").value,
      });
      if (!logged.roomId) {
        session = { token: logged.token, username: logged.username, roomId: null };
        saveSession(session);
        await refreshInbox();
        render();
        return;
      }
      await openSession(logged);
    } catch (error) {
      err.textContent = error.message;
    }
  });
  return card;
}

function logout() {
  stopChatLoop();
  if (session?.token) logoutCloud(session.token);
  session = null;
  spaceKey = null;
  createdInvite = "";
  inbox = { incoming: [], outgoing: [] };
  chatLog = [];
  chatReadAt = {};
  chatDeliveredAt = {};
  chatTyping = false;
  chatUnread = 0;
  chatReply = null;
  chatSelected = new Set();
  chatSelectMode = false;
  chatDragging = false;
  chatQuery = "";
  chatMenuId = "";
  chatEditId = "";
  chatStatuses = [];
  chatDisappearMs = 0;
  endCall(false);
  state = defaultState();
  saveSession(null);
  tab = "home";
  gate = "home";
  render();
}

function accountDeleteCard(inRoom) {
  const copy = inRoom
    ? "This removes your username. The shared room closes. Your partner keeps their account."
    : "This removes your username and any requests you sent or received.";
  return el(`
    <article class="card" style="margin-top:16px">
      <h3>Delete account</h3>
      <p class="muted">${copy}</p>
      <form data-delete-form>
        <div class="field">
          <label for="deletePass">Password</label>
          <input id="deletePass" type="password" required autocomplete="current-password" />
        </div>
        <p class="err" data-delete-err></p>
        <button class="btn danger" type="submit">Delete my account</button>
      </form>
    </article>
  `);
}

function bindAccountDelete(page) {
  const form = page.querySelector("[data-delete-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = page.querySelector("[data-delete-err]");
    err.textContent = "";
    if (!confirm("Delete this account forever? This cannot be undone.")) return;
    try {
      await deleteAccount(session.token, page.querySelector("#deletePass").value);
      session = null;
      logout();
    } catch (error) {
      err.textContent = error.message;
    }
  });
}

function nav() {
  const items = [
    ["home", "Home"],
    ["routine", "Routine"],
    ["chat", "Chat"],
    ["letters", "Letters"],
    ["dates", "Dates"],
    ["ask", "Ask"],
    ["us", "Us"],
    ["memories", "Memories"],
    ["settings", "Settings"],
  ];
  const bar = el(`<nav class="nav">${items.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join("")}</nav>`);
  bar.querySelectorAll("button").forEach((button) => {
    if (button.dataset.tab === tab) button.classList.add("active");
    button.addEventListener("click", () => {
      tab = button.dataset.tab;
      if (tab === "chat") chatUnread = 0;
      render();
      startChatLoop();
    });
  });
  setChatBadge();
  return bar;
}

function homeView() {
  const days = daysTogether(state.startedOn);
  const lastPoke = state.pokes[0];
  const latestMood = state.moods[0];
  const untilDate = daysUntil(state.nextDate);
  const streak = checkinStreak();
  const latestThanks = (state.thanks || [])[0];
  let dateLine = "Set a night that is already yours.";
  if (state.nextDate && untilDate === 0) dateLine = `Tonight — ${fmt(state.nextDate)}`;
  else if (state.nextDate && untilDate > 0) dateLine = `${untilDate} day${untilDate === 1 ? "" : "s"} until ${fmt(state.nextDate)}`;
  else if (state.nextDate && untilDate < 0) dateLine = `Last set night was ${fmt(state.nextDate)}`;
  const wrap = el(`
    <div>
      <section class="hero-card">
        <div>
          <p class="kicker">${escapeHtml(state.you)} + ${escapeHtml(state.them)}</p>
          <p class="days">${days}<span>${state.startedOn ? "days in this story" : "set your start date in Us"}</span></p>
          <p class="muted tiny">${streak ? `Together check-in streak: ${streak} day${streak === 1 ? "" : "s"}` : "Say good morning to start a streak."}</p>
        </div>
        <div class="poke">
          <div>
            <strong>Thinking of you</strong>
            <p class="muted tiny">${lastPoke ? `Last poke: ${new Date(lastPoke.at).toLocaleString()} from ${escapeHtml(lastPoke.from)}` : "Send a little pulse across the day."}</p>
          </div>
          <button class="btn rose" data-poke>Poke</button>
        </div>
        <div class="poke">
          <div>
            <strong>Today with you</strong>
            <p class="muted tiny">${checkedInToday() ? "You already checked in today." : "A tiny I’m-here for the other person."}</p>
          </div>
          <button class="btn ghost" data-checkin ${checkedInToday() ? "disabled" : ""}>${checkedInToday() ? "Checked in" : "I’m here"}</button>
        </div>
      </section>
      <article class="card" style="margin-top:16px" data-open-chat>
        <h3>Chat</h3>
        <p class="muted">${chatLog.length ? escapeHtml(previewChat(chatLog[chatLog.length - 1])).slice(0, 140) : "Swipe to reply, hold for more, send photos."}</p>
        <p class="muted tiny">${chatLog.length ? fmtClock(chatLog[chatLog.length - 1].at) : "Open the thread"}</p>
      </article>
      <div class="grid">
        <article class="card">
          <h3>How is the air today?</h3>
          <p class="muted">Leave a mood for the other person to find later.</p>
          <div class="moods"></div>
        </article>
        <article class="card">
          <h3>Next date</h3>
          <p class="muted">${dateLine}</p>
          <div class="field">
            <label>When</label>
            ${datePickerHtml("nextDate", state.nextDate || "", { future: true })}
          </div>
        </article>
        <article class="card">
          <h3>Today’s question</h3>
          <p class="question">${todayQuestion()}</p>
          <p class="muted tiny">Answer it in Ask. Keep a trail of how you two talk.</p>
        </article>
      </div>
      ${latestMood ? `<article class="card" style="margin-top:16px"><h3>Latest mood</h3><p>${escapeHtml(latestMood.who)} feels ${escapeHtml(latestMood.mood)}</p><p class="muted tiny">${new Date(latestMood.at).toLocaleString()}</p></article>` : ""}
      ${latestThanks ? `<article class="card" style="margin-top:16px"><h3>Latest thank you</h3><p>${escapeHtml(latestThanks.text)}</p><p class="muted tiny">${escapeHtml(latestThanks.from)} · ${new Date(latestThanks.at).toLocaleString()}</p></article>` : ""}
    </div>
  `);
  const moods = wrap.querySelector(".moods");
  MOODS.forEach((mood) => {
    const chip = el(`<button class="mood" type="button">${mood}</button>`);
    chip.addEventListener("click", () => {
      setState({
        moods: [{ id: uid(), who: currentName(), mood, at: Date.now() }, ...state.moods].slice(0, 40),
      });
    });
    moods.append(chip);
  });
  wrap.querySelector("[data-poke]").addEventListener("click", () => {
    setState({
      pokes: [{ id: uid(), from: currentName(), at: Date.now() }, ...state.pokes].slice(0, 20),
    });
  });
  wrap.querySelector("[data-checkin]").addEventListener("click", () => {
    if (checkedInToday()) return;
    setState({
      checkins: [{ id: uid(), who: currentName(), at: Date.now() }, ...state.checkins].slice(0, 400),
    });
  });
  wrap.querySelector("[data-open-chat]").addEventListener("click", () => {
    tab = "chat";
    chatUnread = 0;
    render();
    startChatLoop();
  });
  wrap.querySelector('[data-date-name="nextDate"]').addEventListener("change", () => {
    setState({ nextDate: readDatePicker(wrap, "nextDate") });
  });
  return wrap;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(blob);
  });
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

function showStatusViewer(from) {
  const rows = chatStatuses.filter((item) => item.from === from);
  if (!rows.length) {
    alert("No status yet. Add one from ⋮");
    return;
  }
  document.querySelector("[data-status-ui]")?.remove();
  let i = 0;
  const box = el(`
    <div class="status-ui" data-status-ui>
      <p data-status-meta></p>
      <img data-status-img alt="" />
      <p data-status-text></p>
    </div>
  `);
  const paint = () => {
    const row = rows[i];
    if (!row) {
      box.remove();
      return;
    }
    box.querySelector("[data-status-meta]").textContent = `${row.from} · ${fmtClock(row.at)}`;
    box.querySelector("[data-status-img]").src = row.image || "";
    box.querySelector("[data-status-img]").hidden = !row.image;
    box.querySelector("[data-status-text]").textContent = row.text || "";
  };
  box.addEventListener("click", () => {
    i += 1;
    paint();
  });
  document.body.append(box);
  paint();
  window.setTimeout(() => {
    if (document.body.contains(box)) {
      i += 1;
      paint();
    }
  }, 5000);
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

function chatView() {
  const partner = partnerUsername() || "them";
  const initial = escapeHtml((partner[0] || "B").toUpperCase());
  const wrap = el(`
    <section class="wa-app">
      <header class="wa-head" data-chat-head>
        <button class="wa-icon" type="button" data-back aria-label="Back">‹</button>
        <div class="chat-avatar ${chatStatuses.some((item) => item.from === partner) ? "has-status" : ""}" data-open-status>${initial}</div>
        <div class="chat-head-copy">
          <strong>${escapeHtml(partner)}</strong>
          <p class="muted tiny" data-chat-status>${chatTyping ? "typing…" : chatPartnerOnline ? "online" : chatPartnerSeen ? `last seen ${fmtClock(chatPartnerSeen)}` : "tap here for info"}</p>
        </div>
        <button class="wa-icon" type="button" data-call-voice aria-label="Voice call">📞</button>
        <button class="wa-icon" type="button" data-call-video aria-label="Video call">🎥</button>
        <button class="wa-icon" type="button" data-toggle-search aria-label="Search">⌕</button>
        <button class="wa-icon" type="button" data-more aria-label="More">⋮</button>
      </header>
      <div class="chat-select" data-select-bar hidden>
        <button class="wa-icon" type="button" data-bulk="clear" aria-label="Cancel">‹</button>
        <span data-select-count>0 selected</span>
        <span class="wa-spacer"></span>
        <button type="button" data-bulk="copy">Copy</button>
        <button type="button" data-bulk="delete">Delete</button>
      </div>
      <input class="wa-search" data-chat-search type="search" placeholder="Search…" value="${escapeHtml(chatQuery)}" hidden />
      <div class="wa-thread" data-chat-thread></div>
      <button class="jump-end" type="button" data-jump-end hidden>↓</button>
      <div class="wa-dock">
        <div class="chat-reply" data-reply-bar ${chatReply ? "" : "hidden"}>
          <div>
            <strong data-reply-who>${chatReply ? escapeHtml(chatReply.from === session.username ? "You" : chatReply.from) : ""}</strong>
            <p data-reply-text>${chatReply ? escapeHtml(previewChat(chatReply).slice(0, 80)) : ""}</p>
          </div>
          <button type="button" data-clear-reply aria-label="Cancel reply">✕</button>
        </div>
        <div class="chat-emojis" data-emoji-tray hidden>
          ${["😀", "❤️", "😘", "😂", "🥺", "🔥", "👍", "🌙"].map((mark) => `<button type="button" data-emoji="${mark}">${mark}</button>`).join("")}
        </div>
        <form class="wa-compose">
          <button class="wa-round" type="button" data-emoji-toggle aria-label="Emoji">☺</button>
          <button class="wa-round" type="button" data-attach aria-label="Attach">📎</button>
          <input data-photo-file type="file" accept="image/*" hidden />
          <input data-camera-file type="file" accept="image/*" capture="environment" hidden />
          <input data-status-file type="file" accept="image/*" hidden />
          <textarea data-chat-input rows="1" placeholder="Message" maxlength="2000"></textarea>
          <button class="wa-send" type="submit" data-send aria-label="Send">➤</button>
          <button class="wa-send" type="button" data-mic aria-label="Voice message">🎙</button>
        </form>
      </div>
      <div class="wa-sheet" data-attach-sheet hidden>
        <button type="button" data-pick="gallery">Gallery</button>
        <button type="button" data-pick="camera">Camera</button>
        <button type="button" data-pick="once">View once photo</button>
        <button type="button" data-pick="location">Location</button>
        <button type="button" data-pick="poll">Poll</button>
      </div>
      <div class="wa-sheet" data-more-sheet hidden>
        <button type="button" data-add-status>Add status</button>
        <button type="button" data-disappear="0">Disappearing off</button>
        <button type="button" data-disappear="86400000">Disappear in 24 hours</button>
        <button type="button" data-disappear="604800000">Disappear in 7 days</button>
      </div>
      <div class="wa-dim" data-chat-dim hidden></div>
      <div class="wa-sheet" data-chat-menu hidden>
        <div class="chat-menu-react">
          ${["❤️", "😂", "😮", "😢", "🙏", "🔥"].map((mark) => `<button type="button" data-react="${mark}">${mark}</button>`).join("")}
        </div>
        <button type="button" data-act="reply">Reply</button>
        <button type="button" data-act="copy">Copy</button>
        <button type="button" data-act="pin">Pin</button>
        <button type="button" data-act="edit">Edit</button>
        <button type="button" data-act="info">Info</button>
        <button type="button" data-act="delete">Delete</button>
      </div>
    </section>
  `);
  const thread = wrap.querySelector("[data-chat-thread]");
  const input = wrap.querySelector("[data-chat-input]");
  paintChatThread(thread, true);
  readChat(session.token).catch(() => {});
  wrap.querySelector("[data-back]").addEventListener("click", () => {
    tab = "home";
    render();
    startChatLoop();
  });
  wrap.querySelector("[data-call-voice]").addEventListener("click", () => startCall(false).catch((error) => alert(error.message)));
  wrap.querySelector("[data-call-video]").addEventListener("click", () => startCall(true).catch((error) => alert(error.message)));
  wrap.querySelector("[data-more]").addEventListener("click", () => {
    wrap.querySelector("[data-more-sheet]").hidden = false;
    wrap.querySelector("[data-chat-dim]").hidden = false;
  });
  wrap.querySelector("[data-open-status]").addEventListener("click", () => showStatusViewer(partner));
  wrap.querySelector("[data-add-status]").addEventListener("click", () => {
    wrap.querySelector("[data-more-sheet]").hidden = true;
    wrap.querySelector("[data-chat-dim]").hidden = true;
    wrap.querySelector("[data-status-file]").click();
  });
  wrap.querySelector("[data-status-file]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const image = await compressImage(file);
      const caption = prompt("Status caption (optional)") || "";
      const sealed = await encryptPayload(spaceKey, { text: caption, image });
      await sendStatus(session.token, { id: uid(), at: Date.now(), ...sealed });
      await syncChat();
    } catch (error) {
      alert(error.message);
    }
  });
  wrap.querySelector("[data-toggle-search]").addEventListener("click", () => {
    const search = wrap.querySelector("[data-chat-search]");
    search.hidden = !search.hidden;
    if (!search.hidden) search.focus();
  });
  wrap.querySelector("[data-emoji-toggle]").addEventListener("click", () => {
    const tray = wrap.querySelector("[data-emoji-tray]");
    tray.hidden = !tray.hidden;
  });
  wrap.querySelector("[data-more-sheet]").addEventListener("click", async (event) => {
    const ms = event.target.closest("[data-disappear]")?.dataset.disappear;
    if (ms == null) return;
    await setDisappear(session.token, Number(ms));
    chatDisappearMs = Number(ms);
    wrap.querySelector("[data-more-sheet]").hidden = true;
    wrap.querySelector("[data-chat-dim]").hidden = true;
    const threadNow = wrap.querySelector("[data-chat-thread]");
    if (threadNow) paintChatThread(threadNow, false);
  });
  wrap.querySelector("[data-chat-search]").addEventListener("input", (event) => {
    chatQuery = event.target.value.trim();
    paintChatThread(thread, false);
  });
  wrap.querySelector("[data-clear-reply]").addEventListener("click", () => {
    chatReply = null;
    refreshChatChrome();
  });
  wrap.querySelector("[data-jump-end]").addEventListener("click", () => {
    thread.scrollTop = thread.scrollHeight;
    refreshChatChrome();
  });
  thread.addEventListener("scroll", () => refreshChatChrome());
  wrap.querySelector("[data-attach]").addEventListener("click", () => {
    wrap.querySelector("[data-attach-sheet]").hidden = false;
    wrap.querySelector("[data-chat-dim]").hidden = false;
  });
  wrap.querySelector("[data-photo-file]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const image = await compressImage(file);
      await sendChatContent({ image, text: input.value.trim(), viewOnce: wrap.dataset.once === "1" });
      wrap.dataset.once = "";
      input.value = "";
    } catch (error) {
      alert(error.message);
    }
  });
  wrap.querySelector("[data-camera-file]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const image = await compressImage(file);
      await sendChatContent({ image, text: input.value.trim(), viewOnce: wrap.dataset.once === "1" });
      wrap.dataset.once = "";
      input.value = "";
    } catch (error) {
      alert(error.message);
    }
  });
  wrap.querySelector("[data-attach-sheet]").addEventListener("click", async (event) => {
    const pick = event.target.closest("[data-pick]")?.dataset.pick;
    if (!pick) return;
    wrap.querySelector("[data-attach-sheet]").hidden = true;
    wrap.querySelector("[data-chat-dim]").hidden = true;
    if (pick === "gallery") wrap.querySelector("[data-photo-file]").click();
    if (pick === "camera") wrap.querySelector("[data-camera-file]").click();
    if (pick === "once") {
      wrap.dataset.once = "1";
      wrap.querySelector("[data-photo-file]").click();
    }
    if (pick === "location") {
      navigator.geolocation.getCurrentPosition(
        (pos) => sendChatContent({ type: "location", lat: pos.coords.latitude, lng: pos.coords.longitude, text: "Location" }),
        () => alert("Location is off.")
      );
    }
    if (pick === "poll") {
      const question = prompt("Poll question");
      if (!question) return;
      const a = prompt("Option 1") || "Yes";
      const b = prompt("Option 2") || "No";
      await sendChatContent({
        type: "poll",
        poll: { question, options: [{ text: a, votes: {} }, { text: b, votes: {} }] },
      });
    }
  });
  const syncSendMic = () => {
    const has = Boolean(input.value.trim() || chatEditId);
    wrap.querySelector("[data-send]").hidden = !has;
    wrap.querySelector("[data-mic]").hidden = has;
  };
  wrap.querySelector("[data-mic]").addEventListener("click", async () => {
    if (voiceRec) {
      const rec = voiceRec;
      voiceRec = null;
      rec.stop();
      wrap.querySelector("[data-mic]").textContent = "🎙";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const started = Date.now();
      const rec = new MediaRecorder(stream);
      voiceRec = rec;
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const audio = await blobToDataUrl(blob);
        await sendChatContent({ type: "voice", audio, duration: (Date.now() - started) / 1000 });
      };
      rec.start();
      wrap.querySelector("[data-mic]").textContent = "■";
    } catch (error) {
      alert(error.message);
    }
  });
  wrap.querySelectorAll("[data-emoji]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = `${input.value}${button.dataset.emoji}`;
      input.focus();
    });
  });
  wrap.querySelector("[data-select-bar]").addEventListener("click", async (event) => {
    const act = event.target.closest("[data-bulk]")?.dataset.bulk;
    if (!act) return;
    if (act === "clear") {
      chatSelectMode = false;
      chatSelected.clear();
      closeChatMenu();
      paintChatThread(thread, false);
      refreshChatChrome();
      return;
    }
    await runChatAction(act, [...chatSelected]);
  });
  wrap.querySelector("[data-chat-dim]").addEventListener("click", () => {
    closeChatMenu();
    wrap.querySelector("[data-attach-sheet]").hidden = true;
    wrap.querySelector("[data-more-sheet]").hidden = true;
  });
  wrap.querySelector("[data-chat-menu]").addEventListener("click", async (event) => {
    event.stopPropagation();
    const react = event.target.closest("[data-react]")?.dataset.react;
    const act = event.target.closest("[data-act]")?.dataset.act;
    const id = chatMenuId;
    if (react && id) {
      await runChatAction("react", [id], react);
      return;
    }
    if (act && id) await runChatAction(act, [id]);
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    window.clearTimeout(typingTimer);
    typingChat(session.token, true);
    typingTimer = window.setTimeout(() => typingChat(session.token, false), 2000);
    syncSendMic();
  });
  wrap.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    input.value = "";
    input.style.height = "auto";
    await sendChatContent({ text });
    syncSendMic();
  });
  syncSendMic();
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
  if (act === "reply" && items[0]) {
    startReply(items[0].id);
    closeChatMenu();
    return;
  }
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
  if (act === "edit" && items[0]?.from === session.username && !items[0].deleted) {
    chatEditId = items[0].id;
    const box = document.querySelector("[data-chat-input]");
    if (box) {
      box.value = items[0].text || "";
      box.focus();
    }
    closeChatMenu();
    return;
  }
  if (act === "pin" && items[0]) {
    items[0].pinned = !items[0].pinned;
    await persistChatItem(items[0]);
    closeChatMenu();
    if (thread) paintChatThread(thread, false);
    return;
  }
  if (act === "info" && items[0]) {
    alert(new Date(items[0].at).toLocaleString());
    closeChatMenu();
    return;
  }
  for (const item of items) {
    if (act === "delete" && item.from === session.username && !item.deleted) {
      item.deleted = true;
      item.text = "";
      item.image = "";
      item.audio = "";
      await persistChatItem(item);
    }
    if (act === "react") {
      const next = { ...item.reactions };
      if (next[session.username] === extra) delete next[session.username];
      else next[session.username] = extra;
      item.reactions = next;
      await persistChatItem(item);
    }
  }
  chatSelectMode = false;
  chatSelected.clear();
  closeChatMenu();
  if (thread) paintChatThread(thread, false);
  refreshChatChrome();
}

function lettersView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Leave a letter</h3>
        <form>
          <p class="muted tiny">From ${escapeHtml(currentName())}</p>
          <div class="field">
            <label for="letter">Note</label>
            <textarea id="letter" required placeholder="Something true, even if it is small."></textarea>
          </div>
          <button class="btn" type="submit">Tuck it in</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.notes.length) {
    list.append(el(`<div class="empty card">No letters yet. Write the first one.</div>`));
  } else {
    state.notes.forEach((note) => {
      list.append(
        el(`
          <article class="note">
            <div class="meta"><span>from ${escapeHtml(note.from)}</span><span>${new Date(note.at).toLocaleString()}</span></div>
            <div>${escapeHtml(note.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const from = currentName();
    const text = wrap.querySelector("#letter").value.trim();
    if (!text) return;
    setState({ notes: [{ id: uid(), from, text, at: Date.now() }, ...state.notes] });
  });
  return wrap;
}

function datesView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Date ideas</h3>
        <form>
          <div class="field">
            <label for="idea">What should we do?</label>
            <input id="idea" required placeholder="Night market, long walk, terrible karaoke..." />
          </div>
          <div class="btn-row">
            <button class="btn" type="submit">Add to the list</button>
            <button class="btn ghost" type="button" data-pick>Pick one for us</button>
          </div>
        </form>
        <p class="muted tiny" data-pick-out></p>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.dates.length) {
    list.append(el(`<div class="empty card">Your shared list is empty. Put a wish on it.</div>`));
  } else {
    state.dates.forEach((item) => {
      const row = el(`
        <article class="item">
          <div class="meta">
            <span>${item.done ? "done" : "someday"}</span>
            <span></span>
          </div>
          <div class="${item.done ? "done" : ""}">${escapeHtml(item.title)}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ghost" data-toggle>Mark ${item.done ? "undone" : "done"}</button>
            <button class="btn ghost" data-remove>Remove</button>
          </div>
        </article>
      `);
      row.querySelector("[data-toggle]").addEventListener("click", () => {
        setState({
          dates: state.dates.map((d) => (d.id === item.id ? { ...d, done: !d.done } : d)),
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        setState({ dates: state.dates.filter((d) => d.id !== item.id) });
      });
      list.append(row);
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = wrap.querySelector("#idea").value.trim();
    if (!title) return;
    setState({ dates: [{ id: uid(), title, done: false, at: Date.now() }, ...state.dates] });
  });
  wrap.querySelector("[data-pick]").addEventListener("click", () => {
    const open = state.dates.filter((item) => !item.done);
    const out = wrap.querySelector("[data-pick-out]");
    if (!open.length) {
      out.textContent = "Add a wish first, then we can pick.";
      return;
    }
    const picked = open[Math.floor(Math.random() * open.length)];
    out.textContent = `Tonight’s pick: ${picked.title}`;
  });
  return wrap;
}

function askView() {
  const q = todayQuestion();
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <p class="kicker">today</p>
        <p class="question">${q}</p>
        <form>
          <p class="muted tiny">${escapeHtml(currentName())} is answering</p>
          <div class="field">
            <label for="answer">Your answer</label>
            <textarea id="answer" required></textarea>
          </div>
          <button class="btn rose" type="submit">Keep this</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  if (!state.answers.length) {
    list.append(el(`<div class="empty card">Answers will stack into a tiny archive of you two.</div>`));
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

function memoriesView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Pin a memory</h3>
        <form>
          <div class="field">
            <label>When</label>
            ${datePickerHtml("mdate", "", { required: true })}
          </div>
          <div class="field">
            <label for="mtitle">Title</label>
            <input id="mtitle" required placeholder="The night the rain would not stop" />
          </div>
          <div class="field">
            <label for="mtext">What we keep</label>
            <textarea id="mtext" required></textarea>
          </div>
          <button class="btn" type="submit">Save it</button>
        </form>
      </article>
      <div class="list"></div>
    </div>
  `);
  const list = wrap.querySelector(".list");
  const memories = [...state.memories].sort((a, b) => b.date.localeCompare(a.date));
  if (!memories.length) {
    list.append(el(`<div class="empty card">The scrapbook is waiting.</div>`));
  } else {
    memories.forEach((item) => {
      list.append(
        el(`
          <article class="note">
            <div class="meta"><span>${escapeHtml(item.title)}</span><span>${fmt(item.date)}</span></div>
            <div>${escapeHtml(item.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    setState({
      memories: [
        {
          id: uid(),
          date: readDatePicker(wrap, "mdate"),
          title: wrap.querySelector("#mtitle").value.trim(),
          text: wrap.querySelector("#mtext").value.trim(),
        },
        ...state.memories,
      ],
    });
  });
  return wrap;
}

function usView() {
  const wrap = el(`
    <div>
      <article class="card" style="margin-bottom:16px">
        <h3>Our start</h3>
        <p class="muted">The day this story began. Home counts the days from here.</p>
        <div class="field">
          <label>Start date</label>
          ${datePickerHtml("startedOn", state.startedOn || "")}
        </div>
      </article>
      <article class="card" style="margin-bottom:16px">
        <h3>Thank you jar</h3>
        <p class="muted">Drop a small thanks the other person can find later.</p>
        <form data-thanks>
          <div class="field">
            <label for="thankText">Today I want to thank you for</label>
            <textarea id="thankText" required placeholder="Making tea without being asked."></textarea>
          </div>
          <button class="btn rose" type="submit">Add a thank you</button>
        </form>
        <div class="list" data-thanks-list style="margin-top:12px"></div>
      </article>
      <article class="card" style="margin-bottom:16px">
        <h3>Our songs</h3>
        <form data-song>
          <div class="field">
            <label for="songTitle">Song</label>
            <input id="songTitle" required placeholder="The one we played in the kitchen" />
          </div>
          <div class="field">
            <label for="songArtist">Artist (optional)</label>
            <input id="songArtist" placeholder="Who sings it" />
          </div>
          <button class="btn" type="submit">Save to ours</button>
        </form>
        <div class="list" data-song-list style="margin-top:12px"></div>
      </article>
      <article class="card" style="margin-bottom:16px">
        <h3>Open when</h3>
        <p class="muted">A note that stays closed until a date, or until they choose to open it.</p>
        <form data-sealed>
          <div class="field">
            <label for="sealTitle">For when</label>
            <input id="sealTitle" required placeholder="You miss me / a hard day / our anniversary" />
          </div>
          <div class="field">
            <label>Unlock on (optional)</label>
            ${datePickerHtml("sealDate", "", { future: true })}
          </div>
          <div class="field">
            <label for="sealText">The note</label>
            <textarea id="sealText" required></textarea>
          </div>
          <button class="btn" type="submit">Seal it</button>
        </form>
        <div class="list" data-sealed-list style="margin-top:12px"></div>
      </article>
      <article class="card">
        <h3>Promises</h3>
        <form data-promise>
          <div class="field">
            <label for="promiseText">We will</label>
            <input id="promiseText" required placeholder="Cook together every Sunday" />
          </div>
          <button class="btn" type="submit">Keep this</button>
        </form>
        <div class="list" data-promise-list style="margin-top:12px"></div>
      </article>
    </div>
  `);
  wrap.querySelector('[data-date-name="startedOn"]').addEventListener("change", () => {
    setState({ startedOn: readDatePicker(wrap, "startedOn") });
  });
  wrap.querySelector("[data-thanks]").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = wrap.querySelector("#thankText").value.trim();
    if (!text) return;
    setState({
      thanks: [{ id: uid(), from: currentName(), text, at: Date.now() }, ...state.thanks].slice(0, 80),
    });
  });
  const thanksList = wrap.querySelector("[data-thanks-list]");
  if (!state.thanks.length) {
    thanksList.append(el(`<div class="empty">The jar is empty.</div>`));
  } else {
    state.thanks.slice(0, 8).forEach((item) => {
      thanksList.append(
        el(`
          <article class="note">
            <div class="meta"><span>${escapeHtml(item.from)}</span><span>${new Date(item.at).toLocaleString()}</span></div>
            <div>${escapeHtml(item.text)}</div>
          </article>
        `)
      );
    });
  }
  wrap.querySelector("[data-song]").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = wrap.querySelector("#songTitle").value.trim();
    const artist = wrap.querySelector("#songArtist").value.trim();
    if (!title) return;
    setState({
      songs: [{ id: uid(), title, artist, from: currentName(), at: Date.now() }, ...state.songs],
    });
  });
  const songList = wrap.querySelector("[data-song-list]");
  if (!state.songs.length) {
    songList.append(el(`<div class="empty">No songs yet.</div>`));
  } else {
    state.songs.forEach((item) => {
      const row = el(`
        <article class="item">
          <div class="meta"><span>${escapeHtml(item.from)}</span><span></span></div>
          <div>${escapeHtml(item.title)}${item.artist ? ` <span class="muted">· ${escapeHtml(item.artist)}</span>` : ""}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ghost" type="button" data-remove>Remove</button>
          </div>
        </article>
      `);
      row.querySelector("[data-remove]").addEventListener("click", () => {
        setState({ songs: state.songs.filter((song) => song.id !== item.id) });
      });
      songList.append(row);
    });
  }
  wrap.querySelector("[data-sealed]").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = wrap.querySelector("#sealTitle").value.trim();
    const text = wrap.querySelector("#sealText").value.trim();
    if (!title || !text) return;
    setState({
      sealed: [
        {
          id: uid(),
          from: currentName(),
          title,
          text,
          unlockOn: readDatePicker(wrap, "sealDate"),
          openedAt: 0,
          at: Date.now(),
        },
        ...state.sealed,
      ],
    });
  });
  const sealedList = wrap.querySelector("[data-sealed-list]");
  if (!state.sealed.length) {
    sealedList.append(el(`<div class="empty">No sealed notes yet.</div>`));
  } else {
    state.sealed.forEach((item) => {
      const locked = sealedIsLocked(item);
      const opened = Boolean(item.openedAt);
      const row = el(`
        <article class="note">
          <div class="meta">
            <span>${escapeHtml(item.title)}</span>
            <span>${item.unlockOn ? fmt(item.unlockOn) : "open anytime"}</span>
          </div>
          <p class="muted tiny">from ${escapeHtml(item.from)}</p>
          ${locked ? `<p>Still sealed. Opens ${fmt(item.unlockOn)}.</p>` : ""}
          ${!locked && opened ? `<div>${escapeHtml(item.text)}</div>` : ""}
          ${!locked && !opened ? `<div class="btn-row" style="margin-top:12px"><button class="btn rose" type="button" data-open>Open this</button></div>` : ""}
        </article>
      `);
      const openBtn = row.querySelector("[data-open]");
      if (openBtn) {
        openBtn.addEventListener("click", () => {
          setState({
            sealed: state.sealed.map((note) => (note.id === item.id ? { ...note, openedAt: Date.now() } : note)),
          });
        });
      }
      sealedList.append(row);
    });
  }
  wrap.querySelector("[data-promise]").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = wrap.querySelector("#promiseText").value.trim();
    if (!text) return;
    setState({
      promises: [{ id: uid(), text, from: currentName(), kept: false, at: Date.now() }, ...state.promises],
    });
  });
  const promiseList = wrap.querySelector("[data-promise-list]");
  if (!state.promises.length) {
    promiseList.append(el(`<div class="empty">No promises yet.</div>`));
  } else {
    state.promises.forEach((item) => {
      const row = el(`
        <article class="item">
          <div class="meta"><span>${escapeHtml(item.from)}</span><span>${item.kept ? "kept" : "open"}</span></div>
          <div class="${item.kept ? "done" : ""}">${escapeHtml(item.text)}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn ghost" type="button" data-keep>Mark ${item.kept ? "open" : "kept"}</button>
            <button class="btn ghost" type="button" data-remove>Remove</button>
          </div>
        </article>
      `);
      row.querySelector("[data-keep]").addEventListener("click", () => {
        setState({
          promises: state.promises.map((promise) => (promise.id === item.id ? { ...promise, kept: !promise.kept } : promise)),
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        setState({ promises: state.promises.filter((promise) => promise.id !== item.id) });
      });
      promiseList.append(row);
    });
  }
  return wrap;
}

function settingsView() {
  const invite = createdInvite || session?.roomId || "";
  const wrap = el(`
    <article class="card">
      <h3>This room</h3>
      <p class="muted">This room id is unique and already taken. Other couples cannot use it. Share it only with your partner.</p>
      <div class="field">
        <label>Room id</label>
        <input id="inviteShow" readonly value="${escapeHtml(invite)}" />
      </div>
      <div class="btn-row">
        <button class="btn ghost" type="button" data-copy>Copy room id</button>
        <button class="btn ghost" type="button" data-export>Export backup</button>
        <button class="btn ghost" type="button" data-import>Import backup</button>
        <button class="btn ghost" type="button" data-logout>Log out</button>
      </div>
      <input type="file" accept="application/json" hidden data-file />
      <p class="muted tiny" style="margin-top:16px">${escapeHtml(state.you)} & ${escapeHtml(state.them)}</p>
      <p class="muted tiny"><a href="${import.meta.env.BASE_URL}privacy.html">Privacy</a></p>
    </article>
  `);
  wrap.append(accountDeleteCard(true));
  wrap.querySelector("[data-copy]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(invite);
    } catch {
      wrap.querySelector("#inviteShow").select();
    }
  });
  wrap.querySelector("[data-logout]").addEventListener("click", logout);
  wrap.querySelector("[data-export]").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(contentState(state), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ba-ours.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  const file = wrap.querySelector("[data-file]");
  wrap.querySelector("[data-import]").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    const parsed = JSON.parse(await picked.text());
    setState(contentState(parsed));
  });
  bindAccountDelete(wrap);
  return wrap;
}

function routineView() {
  const wrap = el(`
    <div>
      <article class="card routine-pick">
        <div class="routine-switch">
          <button type="button" data-who="ba" ${routineWho === "ba" ? 'class="active"' : ""}>Ba</button>
          <button type="button" data-who="ma" ${routineWho === "ma" ? 'class="active"' : ""}>Ma</button>
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

function appView() {
  if (tab === "chat") return chatView();
  const shell = el(`
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="kicker">signed in</p>
          <h1 class="wordmark">Ba</h1>
          <p class="who">${escapeHtml(session.username || currentName())} · ${escapeHtml(state.you)} & ${escapeHtml(state.them)}</p>
        </div>
        <button class="btn ghost" type="button" data-logout>Log out</button>
      </header>
    </div>
  `);
  shell.querySelector("[data-logout]").addEventListener("click", logout);
  shell.append(nav());
  const views = {
    home: homeView,
    routine: routineView,
    letters: lettersView,
    dates: datesView,
    ask: askView,
    us: usView,
    memories: memoriesView,
    settings: settingsView,
  };
  shell.append((views[tab] || homeView)());
  return shell;
}

function render() {
  document.body.classList.toggle("wa-open", Boolean(session?.token && session.roomId && tab === "chat"));
  if (!session?.token) {
    if (gate === "register") root.replaceChildren(registerView());
    else if (gate === "login") root.replaceChildren(loginView());
    else root.replaceChildren(gateView());
    return;
  }
  if (!session.roomId) {
    root.replaceChildren(waitingView());
    return;
  }
  root.replaceChildren(appView());
}

async function boot() {
  await initNative();
  if (!session?.token) {
    render();
    return;
  }
  try {
    const me = await loadMe(session.token);
    if (!me.roomId) {
      session = { token: session.token, username: me.username, roomId: null };
      saveSession(session);
      await refreshInbox();
      render();
      return;
    }
    const payload = await loadCloud(session.token);
    await openSession({ ...payload, token: session.token, username: me.username || session.username });
  } catch {
    session = null;
    saveSession(null);
    render();
  }
}

boot();
