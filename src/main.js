import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { PushNotifications } from "@capacitor/push-notifications";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { API_BASE, enterRoom, loadChat, loadCloud, loadMe, loadPlaces, loadSignals, logoutCloud, pingPresence, readChat, registerPushToken, removeChat, clearChat, saveCloud, sendChat, sendPlace, sendSignal, typingChat, updateChat, deleteAccount } from "./api.js";
import { decryptPayload, deriveSpaceKey, encryptPayload } from "./crypto.js";
import { drawFamilyLines, ensureFamilyTree, familyTreeHtml, mapPerson, missingLockFlags, removePerson } from "./familyTree.js";
import { routineHtml } from "./routine.js";

const SESSION_KEY = "ba-session-v2";
const DEVICE_KEY = "ba-device-v1";
const SETUP_KEY = "ba-setup-v1";
const WHO_KEY = "ba-who-v1";
const THEME_KEY = "ba-theme-v1";
const SHARE_LOC_KEY = "ba-share-loc";
const PUSH_KEY = "ba-push-v1";
const LAST_PIN_KEY = "ba-last-pin";
const MAP_KIND_KEY = "ba-map-kind-v1";
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

function forgetLocalIdentity() {
  try {
    localStorage.removeItem(WHO_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(SETUP_KEY);
  } catch {
    /* ignore */
  }
  try {
    document.cookie = `${WHO_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
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

const CONTENT_SECTIONS = ["today", "memories", "todo"];
const HOME_ALERTS = new Set(["chat", "today", "memories", "todo"]);

function sectionSigs(source) {
  const s = source || state;
  return {
    today: JSON.stringify(s.notes || []),
    memories: JSON.stringify(s.dates || []),
    us: JSON.stringify({ startedOn: s.startedOn || "" }),
    todo: JSON.stringify(s.todos || []),
    family: JSON.stringify(s.familyTree || s.family || null),
    poke: JSON.stringify(s.pokes || []),
    cycle: JSON.stringify(s.cycle || null),
    daily: JSON.stringify(s.daily || null),
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
  if ("cycle" in patch) ids.push("cycle");
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
  if (key === "chat" || key === "routine" || key === "settings" || key === "home" || key === "daily") return;
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

function pushWanted() {
  try {
    return localStorage.getItem(PUSH_KEY) !== "0";
  } catch {
    return true;
  }
}

function setPushWanted(on) {
  try {
    localStorage.setItem(PUSH_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let pushReady = false;
let pushBound = false;

async function startPush() {
  if (!Capacitor.isNativePlatform() || !session?.token || !pushWanted()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== "granted") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    if (!pushBound) {
      pushBound = true;
      await PushNotifications.addListener("registration", async (event) => {
        try {
          await registerPushToken(session.token, { token: event.value, deviceId: deviceId() });
          pushReady = true;
        } catch {
          /* retry on next resume */
        }
      });
      await PushNotifications.addListener("registrationError", () => {});
      await PushNotifications.addListener("pushNotificationReceived", (event) => {
        if (event?.data?.kind === "poke") pokeVibrate(true);
      });
    }
    await PushNotifications.register();
  } catch {
    /* web / missing plugin */
  }
}

async function togglePush() {
  const next = !pushWanted();
  setPushWanted(next);
  if (next) {
    pushReady = false;
    await startPush();
  }
  render();
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
  const rootEl = document.documentElement;
  rootEl.classList.toggle("theme-day", next === "day");
  rootEl.classList.toggle("theme-night", next === "night");
  document.body?.classList.toggle("theme-day", next === "day");
  document.body?.classList.toggle("theme-night", next === "night");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === "day" ? "#f4f0ea" : "#090b16";
  if (!Capacitor.isNativePlatform()) return;
  try {
    StatusBar.setStyle({ style: next === "day" ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: next === "day" ? "#f4f0ea" : "#090b16" }).catch(() => {});
  } catch {
    /* plugin may be missing */
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
    await Promise.race([SplashScreen.hide(), new Promise((resolve) => window.setTimeout(resolve, 700))]);
  } catch {
    /* web and some emulators skip this */
  }
  try {
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) startPush();
    });
    App.addListener("backButton", ({ canGoBack }) => {
      if (session?.token && tab !== "home") {
        goHome();
        return;
      }
      if (session?.token && tab === "home") {
        // Nested closes happen inside goHome when tab !== home; on home, leave the app.
        App.exitApp();
        return;
      }
      if (canGoBack) history.back();
      else App.exitApp();
    });
  } catch {
    /* web */
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

const CYCLE_SYMPTOMS = [
  ["cramps", "Cramps"],
  ["headache", "Headache"],
  ["fatigue", "Fatigue"],
  ["bloating", "Bloating"],
  ["spotting", "Spotting"],
  ["backache", "Backache"],
  ["nausea", "Nausea"],
  ["angry", "Angry"],
  ["irritable", "Irritable"],
  ["anxious", "Anxious"],
  ["low_mood", "Low mood"],
  ["mood_swings", "Mood swings"],
  ["tearful", "Tearful"],
  ["restless", "Restless"],
  ["sensitive", "Sensitive"],
];

const CYCLE_FLOWS = [
  ["light", "Light"],
  ["medium", "Medium"],
  ["heavy", "Heavy"],
];

function clampCycleLen(value, fallback = 28) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 15 || n > 60) return fallback;
  return Math.round(n);
}

function clampPeriodLen(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 14) return fallback;
  return Math.round(n);
}

function cycleWhoOf() {
  return "ba";
}

function cycleFlowOf(value) {
  const flow = String(value || "").toLowerCase();
  return flow === "light" || flow === "medium" || flow === "heavy" ? flow : "";
}

function defaultSymptomList() {
  return CYCLE_SYMPTOMS.map(([id, label]) => ({ id, label }));
}

function symptomIdFromLabel(label) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `sym_${uid()}`;
}

function normalizeSymptomList(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    let id = "";
    let label = "";
    if (typeof item === "string") {
      label = item.trim().slice(0, 40);
      id = symptomIdFromLabel(label);
    } else if (Array.isArray(item)) {
      id = String(item[0] || "").trim().toLowerCase().slice(0, 48);
      label = String(item[1] || item[0] || "").trim().slice(0, 40);
    } else if (item && typeof item === "object") {
      label = String(item.label || item.name || "").trim().slice(0, 40);
      id = String(item.id || "").trim().toLowerCase().slice(0, 48) || symptomIdFromLabel(label);
    }
    if (!label) continue;
    if (!id) id = symptomIdFromLabel(label);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length >= 40) break;
  }
  return out;
}

function symptomLabelOf(id, list) {
  const key = String(id || "").trim().toLowerCase();
  if (!key) return "";
  const fromList = (Array.isArray(list) ? list : []).find((row) => row.id === key);
  if (fromList?.label) return fromList.label;
  return CYCLE_SYMPTOMS.find(([symId]) => symId === key)?.[1] || key.replace(/_/g, " ");
}

/** Checked symptoms for a period — any non-empty ids the user selected. */
function cycleSymptomsOf(list) {
  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(item || "").trim().toLowerCase().slice(0, 48))
        .filter(Boolean)
    ),
  ].slice(0, 40);
}

function normalizeCyclePeriod(item) {
  const start = String(item?.start || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const end = String(item?.end || "").slice(0, 10);
  const at = Number(item?.at) || 0;
  return {
    id: String(item?.id || `c-${start}-${at}`),
    start,
    end: /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start ? end : "",
    flow: cycleFlowOf(item?.flow),
    symptoms: cycleSymptomsOf(item?.symptoms),
    note: String(item?.note || "").slice(0, 400),
    at,
    who: cycleWhoOf(item?.who),
  };
}

const MEPRATE_NAME = "Meprate";

const DEFAULT_CYCLE_MEDS = [{ id: "meprate", name: MEPRATE_NAME, dose: "" }];

function defaultCycleMeds() {
  return DEFAULT_CYCLE_MEDS.map((row) => ({ ...row }));
}

function normalizeCycleMed(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const name = String(item.name || item.label || "").trim().slice(0, 40);
  if (!id || !name) return null;
  return {
    id,
    name,
    dose: String(item.dose || "").trim().slice(0, 40),
  };
}

const COURSE_STATUS_ON = "on";
const COURSE_STATUS_ENDED = "ended";
const COURSE_INTAKE_TAKEN = "taken";
const COURSE_INTAKE_NOT = "not";
const COURSE_TAKEN_NOTE = "Medicine taken successfully.";

function courseStatusOf(value, fallback = COURSE_STATUS_ON) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === COURSE_STATUS_ENDED || raw === "end" || raw === "0") return COURSE_STATUS_ENDED;
  if (raw === COURSE_STATUS_ON || raw === "still on" || raw === "ongoing" || raw === "1") return COURSE_STATUS_ON;
  return fallback;
}

function courseIntakeOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === COURSE_INTAKE_TAKEN || raw === "yes") return COURSE_INTAKE_TAKEN;
  if (raw === COURSE_INTAKE_NOT || raw === "skipped" || raw === "missed" || raw === "not taken") return COURSE_INTAKE_NOT;
  return "";
}

function normalizeCycleCourse(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const start = String(item.start || "").slice(0, 10);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const endRaw = String(item.end || "").slice(0, 10);
  const legacy = item.status == null && item.intake == null;
  const status = legacy
    ? /^\d{4}-\d{2}-\d{2}$/.test(endRaw)
      ? COURSE_STATUS_ENDED
      : COURSE_STATUS_ON
    : courseStatusOf(item.status);
  const intake = legacy ? COURSE_INTAKE_TAKEN : courseIntakeOf(item.intake);
  const end =
    status === COURSE_STATUS_ENDED
      ? /^\d{4}-\d{2}-\d{2}$/.test(endRaw) && endRaw >= start
        ? endRaw
        : start
      : "";
  const gapNum = Number(item.gapDays);
  const noteRaw = String(item.note || "").slice(0, 400);
  const note =
    intake === COURSE_INTAKE_TAKEN
      ? noteRaw || COURSE_TAKEN_NOTE
      : noteRaw;
  return {
    id,
    name: MEPRATE_NAME,
    start,
    end,
    status,
    intake,
    note,
    summary: String(item.summary || "").slice(0, 1200),
    gapDays: Number.isFinite(gapNum) ? Math.max(0, Math.min(400, Math.round(gapNum))) : null,
    at: Number(item.at) || 0,
  };
}

function coursesChrono(list) {
  return [...(list || [])].sort(
    (a, b) => a.start.localeCompare(b.start) || Number(a.at || 0) - Number(b.at || 0) || String(a.id).localeCompare(String(b.id))
  );
}

function normalizeCycleCourses(src) {
  const seen = new Set();
  const courses = [];
  const raw = Array.isArray(src?.courses)
    ? src.courses
    : Array.isArray(src?.meds)
      ? src.meds.filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.start || "").slice(0, 10)))
      : [];
  for (const item of raw) {
    const row = normalizeCycleCourse(item);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    courses.push(row);
  }
  courses.sort((a, b) => b.start.localeCompare(a.start) || Number(b.at || 0) - Number(a.at || 0));
  return courses;
}

function normalizeCycleTaken(value) {
  const src = value && typeof value === "object" ? value : {};
  const cutoff = isoAddDays(isoToday(), -90);
  const days = {};
  Object.keys(src).forEach((day) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (cutoff && day < cutoff)) return;
    const row = src[day];
    if (!row || typeof row !== "object") return;
    const ticks = {};
    Object.keys(row).forEach((medId) => {
      const id = String(medId || "").trim();
      const cell = row[medId];
      if (!id || !cell) return;
      if (cell === true) ticks[id] = { at: 0 };
      else if (typeof cell === "object") ticks[id] = { at: Number(cell.at) || 0 };
    });
    if (Object.keys(ticks).length) days[day] = ticks;
  });
  return days;
}

function normalizeCycle(value) {
  const src = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const periods = [];
  for (const item of Array.isArray(src.periods) ? src.periods : []) {
    const row = normalizeCyclePeriod(item);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    periods.push(row);
  }
  periods.sort((a, b) => b.start.localeCompare(a.start) || Number(b.at || 0) - Number(a.at || 0));
  const medSeen = new Set();
  const meds = [];
  if (Array.isArray(src.meds)) {
    for (const item of src.meds) {
      const row = normalizeCycleMed(item);
      if (!row || medSeen.has(row.id)) continue;
      medSeen.add(row.id);
      meds.push(row);
    }
  } else {
    defaultCycleMeds().forEach((row) => meds.push(row));
  }
  const courses = normalizeCycleCourses(src);
  const lastMedName = String(src.lastMedName || courses[0]?.name || "").trim().slice(0, 40);
  return {
    who: cycleWhoOf(src.who),
    cycleLen: clampCycleLen(src.cycleLen, 28),
    periodLen: clampPeriodLen(src.periodLen, 5),
    periods,
    meds,
    taken: normalizeCycleTaken(src.taken || src.medTaken),
    courses,
    lastMedName,
    symptomList: Array.isArray(src.symptomList) ? normalizeSymptomList(src.symptomList) : defaultSymptomList(),
  };
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
  daily: { habits: [], days: {} },
  cycle: { who: "ba", cycleLen: 28, periodLen: 5, periods: [], meds: defaultCycleMeds(), taken: {}, courses: [], lastMedName: "", symptomList: defaultSymptomList() },
});

function contentState(value) {
  const source = value || defaultState();
  return {
    you: source.you || "Ba",
    them: source.them || "Ma",
    startedOn: source.startedOn || "",
    nextDate: source.nextDate || "",
    notes: (source.notes || []).map((note) => ({
      ...note,
      tone: note?.tone === "bad" ? "bad" : "good",
    })),
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
    daily: normalizeDaily(source.daily),
    cycle: normalizeCycle(source.cycle),
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

function fmt(date, withYear = true) {
  if (!date) return "";
  const opts = { month: "short", day: "numeric" };
  if (withYear) opts.year = "numeric";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, opts);
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

const DAILY_KEEP_DAYS = 40;
const DAILY_SLOTS = [
  ["morning", "Morning"],
  ["mid", "Afternoon"],
  ["evening", "Evening"],
  ["night", "Night"],
];

const DAILY_HABIT_LIMIT = 36;
const DAILY_GRAPH_RANGES = [
  ["today", "Today"],
  ["week", "Week"],
  ["month", "Month"],
  ["year", "Year"],
  ["overall", "Overall"],
];

/** First day anyone checked a habit — graph & rollups begin here (not a fixed launch date). */
function dailyFirstInputDay(daily) {
  const days = daily?.days || {};
  const keys = Object.keys(days)
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort();
  for (const day of keys) {
    const ticks = days[day];
    if (!ticks || typeof ticks !== "object") continue;
    const has = Object.values(ticks).some((tick) => tick && typeof tick === "object" && (tick.ba || tick.ma));
    if (has) return day;
  }
  return "";
}
function defaultDailyHabits() {
  return [
    { id: "bathing", label: "Bathing", slot: "morning" },
    { id: "brush", label: "Brush", slot: "morning" },
    { id: "breakfast", label: "Breakfast", slot: "morning" },
    { id: "vitamins", label: "Vitamins", slot: "morning" },
    { id: "walk", label: "Walk", slot: "morning" },
    { id: "classes", label: "Classes", slot: "morning" },
    { id: "lunch", label: "Lunch", slot: "mid" },
    { id: "practical", label: "Lab / Practical", slot: "mid" },
    { id: "library", label: "Library", slot: "mid" },
    { id: "field", label: "Field work", slot: "mid" },
    { id: "snacks", label: "Snacks", slot: "mid" },
    { id: "water", label: "Water", slot: "mid" },
    { id: "dinner", label: "Dinner", slot: "evening" },
    { id: "mess", label: "Mess", slot: "evening" },
    { id: "gym", label: "Gym / Sports", slot: "evening" },
    { id: "study", label: "Study / Notes", slot: "evening" },
    { id: "coding", label: "Coding", slot: "evening" },
    { id: "assignment", label: "Assignment", slot: "evening" },
    { id: "call", label: "Call home", slot: "night" },
    { id: "pack", label: "Pack bag", slot: "night" },
    { id: "sleep", label: "Sleep", slot: "night" },
  ];
}

function habitKey(habit) {
  return `${String(habit?.id || "").trim().toLowerCase()}|${String(habit?.label || "").trim().toLowerCase()}`;
}

function hasHabitMatch(habits, id, labels = []) {
  const wantId = String(id || "").trim().toLowerCase();
  const wantLabels = new Set([wantId, ...labels.map((item) => String(item || "").trim().toLowerCase())].filter(Boolean));
  return (Array.isArray(habits) ? habits : []).some((habit) => {
    const habitId = String(habit?.id || "").trim().toLowerCase();
    const label = String(habit?.label || "").trim().toLowerCase();
    return wantLabels.has(habitId) || wantLabels.has(label);
  });
}

function hasSnacksHabit(habits) {
  return hasHabitMatch(habits, "snacks", ["snack", "snacks"]);
}

function hasSleepHabit(habits) {
  return hasHabitMatch(habits, "sleep", ["sleep"]);
}

function withSnacksHabit(habits) {
  if (hasSnacksHabit(habits)) return habits;
  const snacks = { id: "snacks", label: "Snacks", slot: "mid" };
  const lunchAt = habits.findIndex((habit) => {
    const id = String(habit.id || "").trim().toLowerCase();
    const label = String(habit.label || "").trim().toLowerCase();
    return id === "lunch" || label === "lunch";
  });
  if (lunchAt >= 0) return [...habits.slice(0, lunchAt + 1), snacks, ...habits.slice(lunchAt + 1)];
  let lastMid = -1;
  habits.forEach((habit, index) => {
    if (habit.slot === "mid") lastMid = index;
  });
  if (lastMid >= 0) return [...habits.slice(0, lastMid + 1), snacks, ...habits.slice(lastMid + 1)];
  return [...habits, snacks];
}

function withSleepHabit(habits) {
  if (hasSleepHabit(habits)) return habits;
  return [...habits, { id: "sleep", label: "Sleep", slot: "night" }];
}

/** Merge campus-life defaults that are missing (NITK + BAU Ranchi). */
function withCampusHabits(habits) {
  const list = Array.isArray(habits) ? [...habits] : [];
  const seen = new Set(list.map((habit) => habitKey(habit)));
  for (const row of defaultDailyHabits()) {
    if (hasHabitMatch(list, row.id, [row.label])) continue;
    const key = habitKey(row);
    if (seen.has(key)) continue;
    if (list.length >= DAILY_HABIT_LIMIT) break;
    list.push({ ...row });
    seen.add(key);
  }
  return list;
}

function dailySlotOf(value) {
  const slot = String(value || "").trim().toLowerCase();
  if (slot === "mid" || slot === "afternoon") return "mid";
  if (slot === "evening") return "evening";
  if (slot === "night") return "night";
  return "morning";
}

function dailySlotLabel(slot) {
  return DAILY_SLOTS.find(([id]) => id === dailySlotOf(slot))?.[1] || "Morning";
}

function reorderDailyHabitsInSlot(habits, slot, orderedIds) {
  const want = dailySlotOf(slot);
  const list = Array.isArray(habits) ? habits : [];
  const byId = new Map(
    list.filter((habit) => dailySlotOf(habit.slot) === want).map((habit) => [habit.id, habit])
  );
  const nextInSlot = [];
  (Array.isArray(orderedIds) ? orderedIds : []).forEach((id) => {
    const row = byId.get(id);
    if (!row || nextInSlot.includes(row)) return;
    nextInSlot.push(row);
  });
  byId.forEach((row) => {
    if (!nextInSlot.includes(row)) nextInSlot.push(row);
  });
  let i = 0;
  return list.map((habit) => (dailySlotOf(habit.slot) === want ? nextInSlot[i++] : habit));
}

function dailyTickOf(value) {
  const row = value && typeof value === "object" ? value : {};
  return { ba: Boolean(row.ba), ma: Boolean(row.ma) };
}

function dailyProgressRow(habits, ticks) {
  const total = Array.isArray(habits) ? habits.length : 0;
  return {
    ba: dailyCountFor(habits, ticks, "ba"),
    ma: dailyCountFor(habits, ticks, "ma"),
    total,
  };
}

function dailyProgressPct(row, who) {
  const total = Math.max(0, Number(row?.total) || 0);
  if (!total) return 0;
  const done = Math.max(0, Number(row?.[who]) || 0);
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function normalizeDailyProgress(raw, habits, days) {
  const progress = {};
  const source = raw && typeof raw === "object" ? raw : {};
  Object.keys(source).forEach((day) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const row = source[day];
    if (!row || typeof row !== "object") return;
    const total = Math.max(0, Math.round(Number(row.total) || 0));
    progress[day] = {
      ba: Math.max(0, Math.round(Number(row.ba) || 0)),
      ma: Math.max(0, Math.round(Number(row.ma) || 0)),
      total,
    };
  });
  Object.keys(days || {}).forEach((day) => {
    progress[day] = dailyProgressRow(habits, days[day]);
  });
  const today = isoToday();
  progress[today] = dailyProgressRow(habits, (days || {})[today] || {});
  return progress;
}

function shiftIsoDay(iso, delta) {
  const stamp = new Date(`${iso}T12:00:00`);
  stamp.setDate(stamp.getDate() + delta);
  return dayKey(stamp.getTime());
}

function isoDaySpan(fromIso, toIso) {
  const days = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso) || fromIso > toIso) {
    return days;
  }
  const cursor = new Date(`${fromIso}T12:00:00`);
  const end = new Date(`${toIso}T12:00:00`);
  while (cursor <= end) {
    days.push(dayKey(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function dailyGraphRangeOf(value) {
  const id = String(value || "").trim().toLowerCase();
  return DAILY_GRAPH_RANGES.some(([key]) => key === id) ? id : "week";
}

function clampDailyIso(iso, today = isoToday()) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : today;
  if (day > today) return today;
  return day;
}

function dailyGraphFloor(today = isoToday(), daily = null) {
  const first = dailyFirstInputDay(daily);
  if (!first) return today;
  return first > today ? today : first;
}

function dailyGraphPoints(daily, range, today = isoToday()) {
  const progress = daily?.progress || {};
  const want = dailyGraphRangeOf(range);
  const floor = dailyGraphFloor(today, daily);
  const end = today;
  const pointFor = (day, label) => {
    if (day < floor) {
      return { day, label, ba: null, ma: null, plot: false };
    }
    const row = progress[day] || dailyProgressRow(daily?.habits || [], (daily?.days || {})[day] || {});
    return {
      day,
      label,
      ba: dailyProgressPct(row, "ba"),
      ma: dailyProgressPct(row, "ma"),
      plot: true,
    };
  };

  if (!dailyFirstInputDay(daily) && want !== "today") {
    return [];
  }

  if (want === "today") {
    const stamp = new Date(`${end}T12:00:00`);
    return [pointFor(end, stamp.toLocaleDateString(undefined, { weekday: "short" }))];
  }

  // Axis starts at first input day when the chosen range would begin earlier.
  let from = end;
  if (want === "week") from = shiftIsoDay(end, -6);
  else if (want === "month") from = shiftIsoDay(end, -29);
  else if (want === "year") from = shiftIsoDay(end, -364);
  else {
    const earliest = Object.keys(progress)
      .filter((day) => Number(progress[day]?.total) > 0)
      .sort()[0];
    const dayKeys = Object.keys(daily?.days || {}).sort()[0];
    from = earliest || dayKeys || floor;
    if (from > end) from = end;
  }
  if (from < floor) from = floor;
  const days = isoDaySpan(from, end);
  if (!days.length) return [];

  if (want === "year" || (want === "overall" && days.length > 45)) {
    const buckets = new Map();
    days.forEach((day) => {
      const key = day.slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, { ba: 0, ma: 0, n: 0 });
      if (day < floor) return;
      const row = progress[day] || dailyProgressRow(daily?.habits || [], (daily?.days || {})[day] || {});
      const cur = buckets.get(key);
      cur.ba += dailyProgressPct(row, "ba");
      cur.ma += dailyProgressPct(row, "ma");
      cur.n += 1;
    });
    return [...buckets.keys()].sort().map((key) => {
      const cur = buckets.get(key);
      const stamp = new Date(`${key}-01T12:00:00`);
      const has = cur.n > 0;
      return {
        day: `${key}-01`,
        label: stamp.toLocaleDateString(undefined, { month: "short" }),
        ba: has ? Math.round(cur.ba / cur.n) : null,
        ma: has ? Math.round(cur.ma / cur.n) : null,
        plot: has,
      };
    });
  }

  return days.map((day) => {
    const stamp = new Date(`${day}T12:00:00`);
    const label =
      want === "week"
        ? stamp.toLocaleDateString(undefined, { weekday: "narrow" })
        : String(stamp.getDate());
    return pointFor(day, label);
  });
}

function dailyGraphAvg(points, who) {
  const rows = (Array.isArray(points) ? points : []).filter((row) => row && row.plot !== false && row[who] != null);
  if (!rows.length) return 0;
  return Math.round(rows.reduce((sum, row) => sum + Number(row[who] || 0), 0) / rows.length);
}

function dailyGraphSvg(points) {
  const rows = Array.isArray(points) ? points : [];
  if (!rows.length) {
    return `<p class="daily-graph-empty">No completion data yet.</p>`;
  }
  const plotted = rows.filter((row) => row && row.plot !== false && (row.ba != null || row.ma != null));
  if (!plotted.length) {
    return `<p class="daily-graph-empty">No completion data yet.</p>`;
  }
  if (rows.length === 1) {
    const row = plotted[0];
    return `<div class="daily-graph-bars" role="img" aria-label="Ba ${row.ba} percent, Ma ${row.ma} percent">
      <div class="daily-graph-bar is-ba">
        <div class="daily-graph-bar-track"><i style="height:${row.ba}%"></i></div>
        <span>Ba</span><strong>${row.ba}%</strong>
      </div>
      <div class="daily-graph-bar is-ma">
        <div class="daily-graph-bar-track"><i style="height:${row.ma}%"></i></div>
        <span>Ma</span><strong>${row.ma}%</strong>
      </div>
    </div>`;
  }

  const padL = 28;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const plotH = 118;
  const step = rows.length <= 8 ? 36 : rows.length <= 16 ? 28 : rows.length <= 32 ? 18 : 14;
  const plotW = Math.max(step * (rows.length - 1), 120);
  const width = padL + plotW + padR;
  const height = padT + plotH + padB;
  const xAt = (index) => padL + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW);
  const yAt = (pct) => padT + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;
  const line = (who) => {
    let path = "";
    let drawing = false;
    rows.forEach((row, index) => {
      if (row[who] == null || row.plot === false) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(row[who]).toFixed(1)} `;
      drawing = true;
    });
    return path.trim();
  };
  const labelEvery = rows.length > 16 ? Math.ceil(rows.length / 8) : rows.length > 10 ? 2 : 1;
  const grid = [0, 50, 100]
    .map((pct) => {
      const y = yAt(pct);
      return `<line class="daily-graph-grid" x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" />
      <text class="daily-graph-axis" x="${padL - 6}" y="${y + 3}" text-anchor="end">${pct}</text>`;
    })
    .join("");
  const labels = rows
    .map((row, index) => {
      if (index % labelEvery !== 0 && index !== rows.length - 1) return "";
      return `<text class="daily-graph-label" x="${xAt(index)}" y="${height - 8}" text-anchor="middle">${escapeHtml(row.label)}</text>`;
    })
    .join("");
  const dots = (who, cls) =>
    rows
      .map((row, index) =>
        row[who] == null || row.plot === false
          ? ""
          : `<circle class="${cls}" cx="${xAt(index)}" cy="${yAt(row[who])}" r="2.6" />`
      )
      .join("");

  return `<div class="daily-graph-plot">
    <svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Completion graph">
      ${grid}
      <path class="daily-graph-line is-ba" d="${line("ba")}" fill="none" />
      <path class="daily-graph-line is-ma" d="${line("ma")}" fill="none" />
      ${dots("ba", "daily-graph-dot is-ba")}
      ${dots("ma", "daily-graph-dot is-ma")}
      ${labels}
    </svg>
  </div>`;
}

function pruneDailyDays(days, keep = DAILY_KEEP_DAYS) {
  const cutoffStamp = new Date();
  cutoffStamp.setHours(12, 0, 0, 0);
  cutoffStamp.setDate(cutoffStamp.getDate() - keep);
  const cutoff = dayKey(cutoffStamp.getTime());
  const next = {};
  Object.keys(days || {})
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= cutoff)
    .sort()
    .forEach((day) => {
      next[day] = days[day];
    });
  return next;
}

function normalizeDaily(value) {
  const source = value && typeof value === "object" ? value : {};
  let habits = (Array.isArray(source.habits) ? source.habits : [])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const id = String(row.id || "").trim();
      const label = String(row.label || "").trim();
      if (!id || !label) return null;
      return { id, label, slot: dailySlotOf(row.slot) };
    })
    .filter(Boolean);
  const days = {};
  const rawDays = source.days && typeof source.days === "object" ? source.days : {};
  Object.keys(rawDays).forEach((day) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const row = rawDays[day];
    if (!row || typeof row !== "object") return;
    const ticks = {};
    Object.keys(row).forEach((habitId) => {
      ticks[habitId] = dailyTickOf(row[habitId]);
    });
    days[day] = ticks;
  });
  const hadHabits = Boolean(habits.length);
  const alreadySeeded = Boolean(source.snacksSeeded);
  const nightSeeded = Boolean(source.nightSeeded);
  let campusSeeded = Boolean(source.campusSeeded);
  if (!habits.length) {
    habits = defaultDailyHabits();
    campusSeeded = true;
  } else {
    if (!hasSnacksHabit(habits) && !alreadySeeded) habits = withSnacksHabit(habits);
    if (!hasSleepHabit(habits) && !nightSeeded) habits = withSleepHabit(habits);
    if (!campusSeeded) {
      habits = withCampusHabits(habits);
      campusSeeded = true;
    }
  }
  return {
    habits,
    days: pruneDailyDays(days),
    progress: normalizeDailyProgress(source.progress, habits, days),
    snacksSeeded: alreadySeeded || !hadHabits || hasSnacksHabit(habits),
    nightSeeded: nightSeeded || !hadHabits || hasSleepHabit(habits),
    campusSeeded,
  };
}

function ensureDaily() {
  const raw = state.daily;
  const daily = normalizeDaily(raw);
  const empty = !raw || !Array.isArray(raw.habits) || !raw.habits.length;
  const needsSnacks = Array.isArray(raw?.habits) && raw.habits.length && !hasSnacksHabit(raw.habits) && !raw.snacksSeeded;
  const needsNight = Array.isArray(raw?.habits) && raw.habits.length && !hasSleepHabit(raw.habits) && !raw.nightSeeded;
  const needsCampus = Array.isArray(raw?.habits) && raw.habits.length && !raw.campusSeeded;
  const needsProgress = !raw?.progress || typeof raw.progress !== "object";
  if (empty || needsSnacks || needsNight || needsCampus || needsProgress || !raw?.snacksSeeded || !raw?.nightSeeded || !raw?.campusSeeded) {
    state = { ...state, daily };
    schedulePersist();
  }
  return daily;
}

function writeDaily(patch, silent = false) {
  const daily = normalizeDaily({ ...ensureDaily(), ...patch });
  setState({ daily }, silent);
}

function recentIsoDays(count = 7) {
  const days = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const stamp = new Date(cursor);
    stamp.setDate(cursor.getDate() - i);
    days.push(dayKey(stamp.getTime()));
  }
  return days;
}

function monthEndIso(monthKey) {
  const stamp = new Date(`${monthKey}-01T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  stamp.setMonth(stamp.getMonth() + 1);
  stamp.setDate(0);
  return dayKey(stamp.getTime());
}

/** Days in the viewed month for the Daily strip: 1st → today (within that month). */
function dailyMonthStripDays(viewDay, today = isoToday()) {
  const day = clampDailyIso(viewDay, today);
  const monthKey = day.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  const monthEnd = monthEndIso(monthKey) || today;
  const end = monthEnd > today ? today : monthEnd;
  if (monthStart > end) return [clampDailyIso(today, today)];
  return isoDaySpan(monthStart, end);
}

function bindDailyStrip(scroller, viewDay, { recenter = false } = {}) {
  if (!scroller) return;
  const strip = scroller.querySelector(".daily-strip");
  if (!strip) return;

  const sizeDays = () => {
    const gap = 4;
    const width = Math.max(1, scroller.clientWidth);
    const dayW = Math.max(36, (width - gap * 6) / 7);
    strip.style.setProperty("--daily-day-w", `${dayW}px`);
  };
  sizeDays();
  if (typeof ResizeObserver !== "undefined") {
    const watch = new ResizeObserver(() => sizeDays());
    watch.observe(scroller);
  }

  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let pointerId = 0;
  let tracking = false;
  let axis = "";
  let dragged = false;

  const selected =
    strip.querySelector(`[data-day="${viewDay}"]`) ||
    strip.querySelector(".is-today") ||
    strip.querySelector("[data-day]");

  const scrollToSelected = (behavior = "auto") => {
    if (!selected) return;
    const box = scroller.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    const next = scroller.scrollLeft + (row.left - box.left) - (box.width - row.width) / 2;
    scroller.scrollTo({ left: Math.max(0, next), behavior });
    dailyStripScrollLeft = scroller.scrollLeft;
  };

  const restoreScroll = () => {
    sizeDays();
    if (recenter || dailyStripScrollLeft == null) {
      scrollToSelected("auto");
      return;
    }
    scroller.scrollLeft = dailyStripScrollLeft;
  };
  restoreScroll();
  requestAnimationFrame(restoreScroll);

  scroller.addEventListener(
    "scroll",
    () => {
      dailyStripScrollLeft = scroller.scrollLeft;
    },
    { passive: true }
  );

  scroller.addEventListener("pointerdown", (event) => {
    if (event.button && event.button !== 0) return;
    tracking = true;
    dragged = false;
    axis = "";
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScroll = scroller.scrollLeft;
    scroller.classList.add("is-dragging");
    try {
      scroller.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });

  scroller.addEventListener(
    "pointermove",
    (event) => {
      if (!tracking || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!axis && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (axis === "y") {
          tracking = false;
          scroller.classList.remove("is-dragging");
          try {
            scroller.releasePointerCapture(event.pointerId);
          } catch {
            /* ignore */
          }
          return;
        }
      }
      if (axis !== "x") return;
      event.preventDefault();
      dragged = Math.abs(dx) > 4;
      scroller.scrollLeft = startScroll - dx;
      dailyStripScrollLeft = scroller.scrollLeft;
    },
    { passive: false }
  );

  const endPointer = (event) => {
    if (!tracking || (event && event.pointerId !== pointerId)) return;
    tracking = false;
    scroller.classList.remove("is-dragging");
    if (dragged) {
      scroller.dataset.dragged = "1";
      window.setTimeout(() => {
        delete scroller.dataset.dragged;
      }, 40);
    }
    pointerId = 0;
    axis = "";
    dailyStripScrollLeft = scroller.scrollLeft;
  };

  scroller.addEventListener("pointerup", endPointer);
  scroller.addEventListener("pointercancel", endPointer);
  scroller.addEventListener(
    "click",
    (event) => {
      if (scroller.dataset.dragged === "1") {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );
}

function dailyCountFor(habits, ticks, who) {
  return habits.filter((habit) => Boolean((ticks || {})[habit.id]?.[who])).length;
}

function dailyStreakFor(daily, who) {
  const habits = daily.habits || [];
  if (!habits.length) return 0;
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  const todayKey = dayKey(cursor.getTime());
  if (dailyCountFor(habits, daily.days[todayKey] || {}, who) < habits.length) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (dailyCountFor(habits, daily.days[dayKey(cursor.getTime())] || {}, who) >= habits.length) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
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
  if (!box) return "";
  const y = box.querySelector('[data-part="y"]').value;
  const m = box.querySelector('[data-part="m"]').value;
  const d = box.querySelector('[data-part="d"]').value;
  if (!y || !m || !d) return "";
  const stamp = new Date(`${y}-${m}-${d}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  return `${y}-${m}-${String(stamp.getDate()).padStart(2, "0")}`;
}

function timePickerHtml(name, hhmm = "") {
  const [hour = "", minute = ""] = String(hhmm || "").split(":");
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
  if (minute && !mins.includes(minute)) mins.push(minute);
  mins.sort();
  return `
    <div class="date-picker time-picker" data-time-name="${name}">
      <select data-part="h" aria-label="Hour">
        <option value="">Hour</option>
        ${hours.map((h) => `<option value="${h}" ${h === hour ? "selected" : ""}>${h}</option>`).join("")}
      </select>
      <select data-part="min" aria-label="Minute">
        <option value="">Min</option>
        ${mins.map((m) => `<option value="${m}" ${m === minute ? "selected" : ""}>${m}</option>`).join("")}
      </select>
    </div>
  `;
}

function readTimePicker(root, name) {
  const box = root.querySelector(`[data-time-name="${name}"]`);
  if (!box) return "";
  const h = box.querySelector('[data-part="h"]').value;
  const m = box.querySelector('[data-part="min"]').value;
  if (!h || !m) return "";
  return `${h}:${m}`;
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
  if (document.hidden) return 5000;
  if (tab === "chat" || tab === "where" || callState) return 700;
  return 1500;
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
    const on = HOME_ALERTS.has(id) && (id === "chat" ? chatUnread > 0 : Boolean(sectionUnread[id]));
    button.classList.toggle("has-unread", on);
  });
  document.querySelector("[data-poke]")?.classList.toggle("has-unread", pokeUnread);
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

function chatHasBody(item) {
  if (!item || item.deleted) return false;
  if (String(item.text || "").trim()) return true;
  if (item.image) return true;
  if (item.audio) return true;
  if (item.type === "location" && item.lat != null) return true;
  if (item.poll) return true;
  return false;
}

async function decodeChatRows(rows) {
  const out = [];
  for (const row of rows || []) {
    if (row?.deleted) continue;
    if (!String(row?.iv || "").trim() || !String(row?.blob || "").trim()) continue;
    const key = `${row.id}:${row.iv}:${String(row.blob || "").length}:${String(row.blob || "").slice(-24)}`;
    const cached = cacheGet(key);
    if (cached) {
      if (!cached.deleted && chatHasBody(cached)) out.push(cached);
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
      deleted: Boolean(opened.deleted || row.deleted),
      kept: Boolean(opened.kept || opened.pinned),
    };
    cacheSet(key, item);
    if (!item.deleted && chatHasBody(item)) out.push(item);
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
  let rows = chatLog.filter((item) => !item.deleted && chatHasBody(item));
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
  // Keep pending local sends that the server has not echoed yet.
  const pending = chatLog.filter((item) => item.pending && !next.some((row) => row.id === item.id));
  chatLog = [...next.map((item) => (keptIds.has(item.id) ? { ...item, kept: true } : item)), ...pending];
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
    if (thread) {
      if (before !== after) delete thread.dataset.sig;
      paintChatThread(thread, after !== before && newFromThem.length > 0, before !== after);
    }
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

function paintChatThread(thread, stickToBottom, force = false) {
  if (stickToBottom) chatStickBottom = true;
  const keepEnd = Boolean(stickToBottom || chatStickBottom);
  const prevTop = thread.scrollTop;
  const sig = `${threadSig()}|${chatQuery}|${chatDisappearMs}`;
  if (!force && thread.dataset.sig === sig) {
    if (stickToBottom) thread.scrollTop = thread.scrollHeight;
    return;
  }
  thread.dataset.sig = sig;
  const parts = [];
  let lastDay = "";
  visibleChatLog().forEach((item) => {
    if (item.deleted || !chatHasBody(item)) return;
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
    const body = `${quote}${photo}${loc}${poll}${text}`;
    if (!body) return;
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
let pokeUnread = false;
let pokePulseAt = 0;
let todayDraftId = null;
let overviewTone = "good";
let overviewComposing = false;
let openNoteId = null;
let diaryMonth = "";
let monthSlideDir = 0;
let openDiaryDay = "";
let openMemoryId = null;
let memoryDraftDate = "";
let memoriesComposing = false;
let routineWho = "";
let cycleMonth = "";
let cycleEditId = "";
let cycleDraft = null;
let cycleSymptomsAdding = false;
let cycleSymptomsRemoving = false;
let cycleSymptomsEditing = false;
let cycleSymptomDraft = "";
let courseEditId = "";
let courseDraft = null;
let courseHistMonth = "";
let periodHistMonth = "";
let cycleSettingsOpen = false;
let cycleScrollY = 0;
let pendingScrollY = null;
let todayScrollY = 0;
let gate = "home";
/** Keeps a verified room code when setup answers are still needed (avoids typing the code twice). */
let pendingLogin = null;
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
let livePresent = { ba: "", ma: "" };
let geoWatch = 0;
let geoNote = "";
let locReady = false;
let locAsking = false;
let geoTick = 0;
let todoFilter = "active";
let todoDraftWho = "us";
let todoDraftPri = "later";
let todoDraftDue = "";
let todoDraftTime = "";
let todoWhenOpen = false;
let todosComposing = false;
let dailyViewDay = "";
let dailyDraftSlot = "morning";
let dailyEditing = false;
let dailyGraphRange = "week";
let dailyStripScrollLeft = null;
let dailyStripRecenter = false;
const root = document.getElementById("app") || document.body;

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

let appToastTimer = 0;
function showAppToast(message) {
  const text = String(message || "").trim();
  if (!text) return;
  let el = document.querySelector("[data-app-toast]");
  if (!el) {
    el = document.createElement("div");
    el.className = "app-toast";
    el.setAttribute("data-app-toast", "");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("is-on");
  window.clearTimeout(appToastTimer);
  appToastTimer = window.setTimeout(() => {
    el.classList.remove("is-on");
  }, 1800);
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
  // Local writes may have started while the fetch was in flight — never clobber them.
  if (saveTimer || persisting || typingInApp()) return;
  const stamp = Number(payload.updatedAt || 0);
  const sig = cloudSig(payload);
  if (sig && sig === lastBlobSig) return;
  if (stamp && stamp === lastCloudAt) return;
  // Drop older cloud snapshots so a slow fetch cannot undo a newer local persist.
  if (stamp && lastCloudAt && stamp < lastCloudAt) return;
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
  if (saveTimer || persisting || typingInApp()) return;
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
  if (nextSig.cycle !== prevSig.cycle) changed = true;
  if (nextSig.daily !== prevSig.daily) changed = true;
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
  if ((CONTENT_SECTIONS.includes(here) || here === "cycle" || here === "daily") && nextSig[here] !== prevSig[here]) {
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
  startPush();
  const had = new Set((opened?.dates || []).map((item) => item.id));
  if (KEPT_DATES.some((row) => !had.has(row.id))) persist().catch(() => {});
}

async function logout() {
  stopChatLoop();
  stopGeoShare();
  locAsking = false;
  locReady = sharingLoc();
  const token = session?.token || "";
  const id = deviceId();
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
  pushReady = false;
  state = defaultState();
  saveSession(null);
  livePlaces = [];
  livePresent = { ba: "", ma: "" };
  try {
    localStorage.removeItem(LAST_PIN_KEY);
  } catch {
    /* ignore */
  }
  forgetLocalIdentity();
  pendingLogin = null;
  await logoutCloud(token, id);
  tab = "home";
  gate = "home";
  render();
}

function gateView() {
  const setup = localStorage.getItem(SETUP_KEY) !== "1";
  const savedWho = readSavedWho() || coupleId(pendingLogin?.who);
  let pickedWho = savedWho;
  const codeReady = Boolean(pendingLogin?.code) && setup;
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
          <div class="who-pick" role="group" aria-label="Ba or Ma">
            <button class="who-option" type="button" data-who="ba"><span>Ba</span></button>
            <button class="who-option" type="button" data-who="ma"><span>Ma</span></button>
          </div>
        </div>
        `}
        ${
          codeReady
            ? ""
            : `<div class="field">
          <label for="code">Code</label>
          <input id="code" name="code" inputmode="numeric" autocomplete="off" required maxlength="12" value="${escapeHtml(pendingLogin?.code || "")}" />
        </div>`
        }
        <p class="err" data-err></p>
        <button class="btn rose setup-open" type="submit">Open</button>
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
    const codeInput = card.querySelector("#code");
    const code = (codeInput?.value || pendingLogin?.code || "").replace(/\D/g, "");
    if (!code) {
      err.textContent = "Enter the code.";
      return;
    }
    try {
      const who = coupleId(pickedWho) || readSavedWho() || coupleId(pendingLogin?.who);
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
      pendingLogin = null;
      localStorage.setItem(SETUP_KEY, "1");
      saveWho(coupleId(entered.username) || who);
      await openSession(entered);
      await locating;
      render();
    } catch (error) {
      const onPages = /\.github\.io$/i.test(location.hostname);
      err.textContent =
        onPages && /Can't reach|not connected/i.test(String(error.message || ""))
          ? "This GitHub Pages link needs a hosted Ba server. Deploy the API (see render.yaml), set the VITE_API_URL secret, then redeploy Pages."
          : error.message;
      if (error.needSetup) {
        const who = coupleId(pickedWho) || readSavedWho() || coupleId(pendingLogin?.who);
        pendingLogin = { code, who: who || "" };
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
  if (id === "us") {
    id = "cycle";
    cycleSettingsOpen = true;
  }
  if (id === "home") {
    goHome();
    return;
  }
  if (id === "where") {
    whereFollow = false;
    whereCenter = { ...INDIA_CENTER };
    followPinId = "";
    followWho = "";
    mapZoom = 5;
    whereSig = "";
  } else {
    whereFull = false;
    document.body.classList.remove("map-full");
  }
  openMemoryId = null;
  openNoteId = null;
  if (id !== "today") {
    todayDraftId = null;
    openDiaryDay = "";
    overviewComposing = false;
  }
  if (id !== "memories" && id !== "dates") {
    memoriesComposing = false;
  }
  if (id !== "todo") {
    todosComposing = false;
    todoWhenOpen = false;
  }
  if (id !== "cycle") {
    courseHistMonth = "";
    periodHistMonth = "";
    cycleSettingsOpen = false;
    cycleSymptomsAdding = false;
    cycleSymptomsRemoving = false;
    cycleSymptomsEditing = false;
    cycleSymptomDraft = "";
  }
  if (id === "daily") {
    dailyViewDay = "";
    dailyEditing = false;
    dailyStripScrollLeft = null;
    dailyStripRecenter = true;
  }
  if (id === "today" && !openDiaryDay) openDiaryDay = isoToday();
  if (id === "routine") routineWho = partnerId();
  tab = id;
  markSectionSeen(id);
  if (history.state?.ba === "section") history.replaceState({ ba: "section", tab: id }, "");
  else history.pushState({ ba: "section", tab: id }, "");
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

function homeSectionIcon(id) {
  const icons = {
    chat: `<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-3.5 2.5V16.5H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
    routine: `<path d="M7 5.5h10M7 12h10M7 18.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="17.5" cy="18.5" r="1.4" fill="currentColor"/>`,
    where: `<path d="M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    today: `<rect x="4.5" y="5.5" width="15" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 3.8v3.2M16 3.8v3.2M4.5 10h15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    memories: `<path d="M7 18.5 10.2 9.8a2 2 0 0 1 3.6 0L17 18.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="1.5" fill="currentColor"/>`,
    todo: `<path d="M6.5 7.5h11M6.5 12h11M6.5 16.5h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m15.2 15.2 1.5 1.5 2.8-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    daily: `<circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8.2v4.2l2.8 1.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    family: `<circle cx="8.2" cy="9" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15.8" cy="9" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 18.2c.4-2.6 2.2-4 3.4-4h1.2c1.1 0 2.3.8 3 2 .7-1.2 1.9-2 3-2h1.2c1.2 0 3 1.4 3.4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    cycle: `<path d="M12 5.2a6.8 6.8 0 1 1-5.4 2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6.2 4.8v3.4H9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  return `<svg class="home-ico" viewBox="0 0 24 24" aria-hidden="true">${icons[id] || ""}</svg>`;
}

function homeDailyQuote() {
  const quotes = [
    { text: "The journey of a thousand miles begins with one step.", by: "Lao Tzu" },
    { text: "Keep your face always toward the sunshine.", by: "Walt Whitman" },
    { text: "Happiness depends upon ourselves.", by: "Aristotle" },
    { text: "Wherever you go, go with all your heart.", by: "Confucius" },
    { text: "What we think, we become.", by: "Buddha" },
    { text: "Do what you can, with what you have.", by: "Theodore Roosevelt" },
    { text: "The best way out is always through.", by: "Robert Frost" },
    { text: "Fortune favors the brave.", by: "Latin proverb" },
    { text: "No act of kindness is ever wasted.", by: "Aesop" },
    { text: "It is never too late to be what you might have been.", by: "George Eliot" },
    { text: "We are what we repeatedly do.", by: "Aristotle" },
    { text: "Hope is the thing with feathers.", by: "Emily Dickinson" },
    { text: "Start where you are. Use what you have.", by: "Arthur Ashe" },
    { text: "Kindness is a language the deaf can hear.", by: "Mark Twain" },
    { text: "Bloom where you are planted.", by: "Proverb" },
    { text: "Every day may not be good, but there is something good in every day.", by: "Alice Morse Earle" },
    { text: "Courage is grace under pressure.", by: "Ernest Hemingway" },
    { text: "Love is composed of a single soul inhabiting two bodies.", by: "Aristotle" },
    { text: "Where there is love there is life.", by: "Mahatma Gandhi" },
    { text: "The only true wisdom is in knowing you know nothing.", by: "Socrates" },
    { text: "In three words I can sum up everything I’ve learned about life: it goes on.", by: "Robert Frost" },
    { text: "Don’t go where the path may lead; go instead where there is no path and leave a trail.", by: "Ralph Waldo Emerson" },
    { text: "The secret of getting ahead is getting started.", by: "Mark Twain" },
    { text: "There is nothing either good or bad, but thinking makes it so.", by: "Shakespeare" },
    { text: "To love and be loved is to feel the sun from both sides.", by: "David Viscott" },
    { text: "A day without laughter is a day wasted.", by: "Charlie Chaplin" },
    { text: "The only impossible journey is the one you never begin.", by: "Tony Robbins" },
    { text: "Simplicity is the ultimate sophistication.", by: "Leonardo da Vinci" },
    { text: "Be still, and know.", by: "Psalm 46" },
    { text: "Nothing great was ever achieved without enthusiasm.", by: "Ralph Waldo Emerson" },
    { text: "The future belongs to those who believe in the beauty of their dreams.", by: "Eleanor Roosevelt" },
  ];
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return quotes[Math.max(0, day) % quotes.length];
}

function homeView() {
  const days = daysTogether(state.startedOn);
  const lastPoke = state.pokes[0];
  const pokeTime = lastPoke
    ? new Date(lastPoke.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  const quote = homeDailyQuote();
  const sections = [
    ["chat", "Chat"],
    ["routine", "Routine"],
    ["daily", "Daily"],
    ["where", "Where"],
    ["todo", "To Do"],
    ["today", "Overview"],
    ["memories", "Memories"],
    ["cycle", "Periods"],
    ["family", "Family"],
  ];
  const page = el(`
    <div class="home">
      <header class="home-brand">
        <div class="home-brand-main">
          <p class="home-kicker">Together</p>
          <h2 class="home-wordmark">Ba</h2>
          ${
            state.startedOn
              ? `<p class="home-days"><strong>${days}</strong><span>days</span></p>`
              : ""
          }
        </div>
        <blockquote class="home-quote">
          <p class="home-quote-text">“${escapeHtml(quote.text)}”</p>
        </blockquote>
      </header>
      <button class="home-tile home-poke${Date.now() - pokePulseAt < 450 ? " is-poking" : ""}" type="button" data-poke aria-label="Poke">
        <span class="home-poke-time">${pokeTime ? escapeHtml(pokeTime) : "—"}</span>
      </button>
      <div class="home-links" role="navigation" aria-label="Sections">
        ${sections
          .map(([id, label]) => {
            const alert =
              HOME_ALERTS.has(id) && (id === "chat" ? chatUnread > 0 : sectionUnread[id])
                ? " has-unread"
                : "";
            return `<button class="home-tile${alert}" type="button" data-go="${id}">
              <span class="home-tile-ico">${homeSectionIcon(id)}</span>
              <span class="home-tile-label">${label}</span>
            </button>`;
          })
          .join("")}
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
    pokeUnread = false;
    document.querySelector("[data-poke]")?.classList.remove("has-unread");
    sendPoke();
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

let pokeTone = null;

function wakePokeTone() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!pokeTone) pokeTone = new AC();
  if (pokeTone.state === "suspended") pokeTone.resume().catch(() => {});
  return pokeTone;
}

function playPokeTone(strong = false) {
  const ctx = wakePokeTone();
  if (!ctx) return;
  const now = ctx.currentTime;
  const chirp = (freq, start, dur, vol) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  };
  if (strong) {
    chirp(920, 0, 0.08, 0.22);
    chirp(1380, 0.09, 0.12, 0.2);
  } else {
    chirp(1040, 0, 0.07, 0.18);
    chirp(1480, 0.055, 0.09, 0.16);
  }
}

async function pokeVibrate(strong = false) {
  playPokeTone(strong);
  try {
    if (Capacitor.isNativePlatform()) {
      if (strong) {
        await Haptics.vibrate({ duration: 70 });
        window.setTimeout(() => Haptics.vibrate({ duration: 110 }), 90);
        window.setTimeout(() => Haptics.vibrate({ duration: 160 }), 230);
      } else {
        await Haptics.impact({ style: ImpactStyle.Heavy });
        window.setTimeout(() => Haptics.vibrate({ duration: 80 }), 70);
      }
      return;
    }
    if (strong) navigator.vibrate?.([36, 50, 36, 50, 70, 40, 90]);
    else navigator.vibrate?.([18, 30, 18]);
  } catch {
    try {
      if (strong) navigator.vibrate?.([36, 50, 36, 50, 70, 40, 90]);
      else navigator.vibrate?.([18, 30, 18]);
    } catch {
      /* ignore */
    }
  }
}

function markPokeIncoming() {
  pokeUnread = true;
  document.querySelector("[data-poke]")?.classList.add("has-unread");
}

async function sendPoke() {
  const at = Date.now();
  pokePulseAt = at;
  setState({
    pokes: [{ id: uid(), from: currentName(), at }, ...state.pokes].slice(0, 20),
  });
  pokeVibrate(false);
  if (!session?.token) return;
  try {
    await sendSignal(session.token, { kind: "poke", data: { at } });
  } catch {
    /* synced poke log still saved in cloud state */
  }
}

async function pullSignals() {
  if (!session?.token || !session.roomId) return;
  const payload = await loadSignals(session.token);
  for (const sig of payload.signals || []) {
    if (sig.kind === "poke") {
      pokeVibrate(true);
      markPokeIncoming();
      if (tab === "home") render();
    } else if (sig.kind === "offer" && callState !== "live") {
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
  if ((tab === "memories" || tab === "dates") && memoriesComposing) {
    memoriesComposing = false;
    render();
    return;
  }
  if (tab === "todo" && todosComposing) {
    todosComposing = false;
    todoWhenOpen = false;
    render();
    return;
  }
  if (tab === "today" && openNoteId) {
    openNoteId = null;
    render();
    return;
  }
  if (tab === "cycle" && cycleSettingsOpen) {
    cycleSettingsOpen = false;
    pendingScrollY = Number(cycleScrollY) || 0;
    render();
    return;
  }
  if (tab === "cycle" && courseHistMonth) {
    courseHistMonth = "";
    pendingScrollY = Number(cycleScrollY) || 0;
    render();
    return;
  }
  if (tab === "cycle" && periodHistMonth) {
    periodHistMonth = "";
    pendingScrollY = Number(cycleScrollY) || 0;
    render();
    return;
  }
  if (tab === "home") return;
  if (history.state?.ba === "section") {
    history.back();
    return;
  }
  settleHome();
}

function settleHome() {
  todayDraftId = null;
  openDiaryDay = "";
  overviewComposing = false;
  openNoteId = null;
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
  if (tab === "chat") {
    leaveChat();
    return;
  }
  settleHome();
});

function chatView() {
  const wrap = el(`
    <section class="wa-app">
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
          <textarea data-chat-input rows="1" placeholder="Message" maxlength="2000" enterkeyhint="send"></textarea>
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
  const CHAT_INPUT_MAX = 160;
  const fitChatInput = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, CHAT_INPUT_MAX)}px`;
  };
  const chatEnterSends = () => {
    if (Capacitor.isNativePlatform()) return false;
    try {
      if (window.matchMedia("(pointer: coarse)").matches) return false;
    } catch {
      /* ignore */
    }
    return true;
  };
  input.setAttribute("enterkeyhint", chatEnterSends() ? "send" : "enter");
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
    fitChatInput();
    window.clearTimeout(typingTimer);
    typingChat(session.token, true);
    typingTimer = window.setTimeout(() => typingChat(session.token, false), 2000);
  });
  wrap.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    input.value = "";
    fitChatInput();
    await sendChatContent({ text });
  });
  // Desktop: Enter sends, Shift+Enter newline. Touch/native: Enter inserts newline; send via button.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    if (!chatEnterSends()) return;
    event.preventDefault();
    wrap.querySelector("form").requestSubmit();
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
      box.style.height = "auto";
      box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
      box.focus();
    }
    closeChatMenu();
    return;
  }
  if (act === "delete") {
    const toRemove = items.filter((item) => isMine(item.from));
    const removed = new Set(toRemove.map((item) => item.id));
    // Drop locally first so the bubble leaves the thread immediately.
    if (removed.size) {
      chatLog = chatLog.filter((row) => !removed.has(row.id));
      decryptCache.clear();
      if (thread) {
        removed.forEach((id) => thread.querySelector(`[data-mid="${CSS.escape(id)}"]`)?.remove());
        delete thread.dataset.sig;
      }
    }
    for (const item of toRemove) {
      try {
        const payload = await removeChat(session.token, item.id);
        if (Array.isArray(payload?.messages)) {
          const keptIds = new Set(chatLog.filter((row) => row.kept).map((row) => row.id));
          const next = await decodeChatRows(payload.messages);
          chatLog = next
            .filter((row) => !removed.has(row.id))
            .map((row) => (keptIds.has(row.id) ? { ...row, kept: true } : row));
        }
      } catch {
        /* keep local removal; next sync reconciles */
      }
    }
  }
  chatSelectMode = false;
  chatSelected.clear();
  closeChatMenu();
  if (thread) {
    delete thread.dataset.sig;
    paintChatThread(thread, false, true);
  }
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

function noteDay(note) {
  const day = String(note?.day || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return note?.at ? isoTodayFrom(note.at) : "";
}

function noteTone(note) {
  return note?.tone === "bad" ? "bad" : "good";
}

function noteWho(note) {
  const who = coupleId(note?.from);
  return who === "ba" ? "Ba" : who === "ma" ? "Ma" : "";
}

function notesForDay(day) {
  return state.notes
    .filter((note) => noteDay(note) === day)
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}

function notesForDayTone(day, tone) {
  return notesForDay(day).filter((note) => noteTone(note) === tone);
}

function dayToneCounts(day) {
  const notes = notesForDay(day);
  let good = 0;
  let bad = 0;
  notes.forEach((note) => {
    if (noteTone(note) === "bad") bad += 1;
    else good += 1;
  });
  return { good, bad, total: notes.length };
}

function diaryMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(value) ? value : isoToday().slice(0, 7);
}

function shiftMonthKey(monthKey, delta) {
  const stamp = new Date(`${monthKey}-01T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return monthKey;
  stamp.setMonth(stamp.getMonth() + Number(delta) || 0);
  return `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelForKey(monthKey) {
  const monthDate = new Date(`${monthKey}-01T12:00:00`);
  if (Number.isNaN(monthDate.getTime())) return monthKey;
  return monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthPartsFromKey(monthKey) {
  const stamp = new Date(`${monthKey}-01T12:00:00`);
  if (Number.isNaN(stamp.getTime())) {
    const today = isoToday();
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  }
  return { year: stamp.getFullYear(), month: stamp.getMonth() + 1 };
}

function monthNameShort(monthIndex) {
  return new Date(2000, monthIndex, 1).toLocaleDateString(undefined, { month: "short" });
}

function monthNameLong(monthIndex) {
  return new Date(2000, monthIndex, 1).toLocaleDateString(undefined, { month: "long" });
}

function clampMonthKey(year, month, { minIso = "", maxIso = "" } = {}) {
  let next = `${year}-${String(month).padStart(2, "0")}`;
  const min = /^\d{4}-\d{2}-\d{2}$/.test(minIso) ? minIso.slice(0, 7) : "";
  const max = /^\d{4}-\d{2}-\d{2}$/.test(maxIso) ? maxIso.slice(0, 7) : "";
  if (min && next < min) next = min;
  if (max && next > max) next = max;
  return next;
}

function appCalMonthsHtml(year, selectedMonthKey = "", { maxIso = "", minIso = "" } = {}) {
  const selected = /^\d{4}-\d{2}/.test(selectedMonthKey) ? selectedMonthKey.slice(0, 7) : "";
  const max = /^\d{4}-\d{2}-\d{2}$/.test(maxIso) ? maxIso.slice(0, 7) : "";
  const min = /^\d{4}-\d{2}-\d{2}$/.test(minIso) ? minIso.slice(0, 7) : "";
  return Array.from({ length: 12 }, (_, idx) => {
    const month = idx + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const disabled = Boolean((max && key > max) || (min && key < min));
    if (disabled) {
      return `<span class="app-cal-cell is-mute">${escapeHtml(monthNameShort(idx))}</span>`;
    }
    return `<button type="button" class="app-cal-cell${selected === key ? " is-picked" : ""}" data-cal-month-pick="${key}">${escapeHtml(monthNameShort(idx))}</button>`;
  }).join("");
}

function appCalYearsHtml(pageStart, selectedYear, { maxIso = "", minIso = "" } = {}) {
  const start = Number(pageStart) || new Date().getFullYear();
  const picked = Number(selectedYear) || 0;
  const maxY = /^\d{4}-\d{2}-\d{2}$/.test(maxIso) ? Number(maxIso.slice(0, 4)) : null;
  const minY = /^\d{4}-\d{2}-\d{2}$/.test(minIso) ? Number(minIso.slice(0, 4)) : null;
  return Array.from({ length: 12 }, (_, idx) => {
    const year = start + idx;
    const disabled = Boolean((maxY != null && year > maxY) || (minY != null && year < minY));
    if (disabled) {
      return `<span class="app-cal-cell is-mute">${year}</span>`;
    }
    return `<button type="button" class="app-cal-cell${picked === year ? " is-picked" : ""}" data-cal-year-pick="${year}">${year}</button>`;
  }).join("");
}

function monthWeekHeaderHtml() {
  return ["S", "M", "T", "W", "T", "F", "S"]
    .map((d, i) => `<span${i === 0 ? ' class="is-sunday"' : ""}>${d}</span>`)
    .join("");
}

function isSundayIso(iso) {
  const when = new Date(`${iso}T12:00:00`);
  return !Number.isNaN(when.getTime()) && when.getDay() === 0;
}

function monthGridCells(monthKey, mapDay) {
  const monthDate = new Date(`${monthKey}-01T12:00:00`);
  if (Number.isNaN(monthDate.getTime())) return [];
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push({ empty: true });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
    cells.push(mapDay(iso, day));
  }
  return cells;
}

function appCalGridHtml(monthKey, selectedIso = "", { maxIso = "", minIso = "" } = {}) {
  const today = isoToday();
  const max = /^\d{4}-\d{2}-\d{2}$/.test(maxIso) ? maxIso : "";
  const min = /^\d{4}-\d{2}-\d{2}$/.test(minIso) ? minIso : "";
  const cells = monthGridCells(monthKey, (iso, day) => ({
    empty: false,
    iso,
    day,
    today: iso === today,
    picked: iso === selectedIso,
    sunday: isSundayIso(iso),
    disabled: Boolean((max && iso > max) || (min && iso < min)),
  }));
  return cells
    .map((cell) =>
      cell.empty
        ? `<span class="app-cal-day is-mute"></span>`
        : cell.disabled
          ? `<span class="app-cal-day is-mute is-future">${cell.day}</span>`
          : `<button type="button" class="app-cal-day${cell.today ? " is-today" : ""}${cell.picked ? " is-picked" : ""}${cell.sunday ? " is-sunday" : ""}" data-cal-day="${cell.iso}">${cell.day}</button>`
    )
    .join("");
}

function appCalPickerHtml(name, iso = "", { clearable = false, icon = false, maxIso = "", minIso = "" } = {}) {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
  const monthKey = (selected || isoToday()).slice(0, 7);
  const label = selected ? fmt(selected) : "Pick a date";
  const maxAttr = /^\d{4}-\d{2}-\d{2}$/.test(maxIso) ? ` data-cal-max="${escapeHtml(maxIso)}"` : "";
  const minAttr = /^\d{4}-\d{2}-\d{2}$/.test(minIso) ? ` data-cal-min="${escapeHtml(minIso)}"` : "";
  const trigger = icon
    ? `<button type="button" class="app-cal-trigger is-icon" data-cal-open aria-haspopup="dialog" aria-expanded="false" aria-label="Jump to date">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M8 3.5v3.2M16 3.5v3.2M3.5 9.5h17"/>
          <circle cx="8.2" cy="13.2" r="1.05" fill="currentColor"/>
          <circle cx="12" cy="13.2" r="1.05" fill="currentColor"/>
          <circle cx="15.8" cy="13.2" r="1.05" fill="currentColor"/>
          <circle cx="8.2" cy="16.8" r="1.05" fill="currentColor"/>
          <circle cx="12" cy="16.8" r="1.05" fill="currentColor"/>
        </svg>
      </button>`
    : `<button type="button" class="app-cal-trigger" data-cal-open aria-haspopup="dialog" aria-expanded="false">${escapeHtml(label)}</button>`;
  const { year, month } = monthPartsFromKey(monthKey);
  const yearPage = Math.floor(year / 12) * 12;
  return `
    <div class="app-cal${clearable ? " is-clearable" : ""}${icon ? " is-icon" : ""}" data-cal-name="${name}" data-cal-iso="${escapeHtml(selected)}" data-cal-month="${escapeHtml(monthKey)}" data-cal-view="days" data-cal-year-page="${yearPage}"${clearable ? ' data-cal-clearable="1"' : ""}${maxAttr}${minAttr}>
      ${trigger}
      <div class="app-cal-scrim" data-cal-scrim hidden aria-hidden="true"></div>
      <div class="app-cal-pop" data-cal-pop hidden>
        <div class="app-cal-head">
          <button type="button" class="app-cal-nav" data-cal-prev aria-label="Previous">‹</button>
          <div class="app-cal-title">
            <button type="button" class="app-cal-chip" data-cal-pick-month aria-label="Choose month">${escapeHtml(monthNameLong(month - 1))}</button>
            <button type="button" class="app-cal-chip" data-cal-pick-year aria-label="Choose year">${year}</button>
          </div>
          <button type="button" class="app-cal-nav" data-cal-next aria-label="Next">›</button>
        </div>
        <div class="app-cal-week" data-cal-week aria-hidden="true">${monthWeekHeaderHtml()}</div>
        <div class="app-cal-grid" data-cal-grid>${appCalGridHtml(monthKey, selected, { maxIso, minIso })}</div>
        ${
          clearable
            ? `<button type="button" class="app-cal-clear" data-cal-clear${selected ? "" : " hidden"}>Clear</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function pageScrollY() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function captureCycleScroll() {
  cycleScrollY = pageScrollY();
}

function applyPendingScroll() {
  if (pendingScrollY == null) return;
  const y = Math.max(0, Number(pendingScrollY) || 0);
  pendingScrollY = null;
  const apply = () => {
    window.scrollTo(0, y);
    document.documentElement.scrollTop = y;
    document.body.scrollTop = y;
  };
  apply();
  requestAnimationFrame(apply);
}

function bindAppCalPicker(root, name, { getIso, setIso }) {
  const box = root.querySelector(`[data-cal-name="${name}"]`);
  if (!box) return;
  const pop = box.querySelector("[data-cal-pop]");
  const scrim = box.querySelector("[data-cal-scrim]");
  const trigger = box.querySelector("[data-cal-open]");
  const grid = box.querySelector("[data-cal-grid]");
  const weekEl = box.querySelector("[data-cal-week]");
  const monthChip = box.querySelector("[data-cal-pick-month]");
  const yearChip = box.querySelector("[data-cal-pick-year]");
  const prevBtn = box.querySelector("[data-cal-prev]");
  const nextBtn = box.querySelector("[data-cal-next]");
  const clearBtn = box.querySelector("[data-cal-clear]");
  const clearable = box.dataset.calClearable === "1";
  const placePop = () => {
    if (!pop || pop.hidden) return;
    const margin = 10;
    const prevVis = pop.style.visibility;
    pop.style.visibility = "hidden";
    pop.style.left = "0px";
    pop.style.top = "0px";
    const popW = pop.offsetWidth || 280;
    const popH = pop.offsetHeight || 320;
    pop.style.visibility = prevVis || "";
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(margin, (vw - popW) / 2), Math.max(margin, vw - popW - margin));
    const top = Math.min(Math.max(margin, (vh - popH) / 2), Math.max(margin, vh - popH - margin));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };
  const onReposition = () => placePop();
  const syncClear = (iso) => {
    if (!clearBtn) return;
    clearBtn.hidden = !iso;
  };
  const syncTitle = () => {
    const month = box.dataset.calMonth || isoToday().slice(0, 7);
    const view = box.dataset.calView || "days";
    const { year, month: monthNum } = monthPartsFromKey(month);
    if (monthChip) {
      monthChip.textContent = monthNameLong(monthNum - 1);
      monthChip.classList.toggle("is-active", view === "months");
      monthChip.setAttribute("aria-expanded", view === "months" ? "true" : "false");
    }
    if (yearChip) {
      if (view === "years") {
        const page = Number(box.dataset.calYearPage) || Math.floor(year / 12) * 12;
        yearChip.textContent = `${page}–${page + 11}`;
      } else {
        yearChip.textContent = String(year);
      }
      yearChip.classList.toggle("is-active", view === "years");
      yearChip.setAttribute("aria-expanded", view === "years" ? "true" : "false");
    }
    if (prevBtn) {
      prevBtn.setAttribute("aria-label", view === "years" ? "Previous years" : view === "months" ? "Previous year" : "Previous month");
    }
    if (nextBtn) {
      nextBtn.setAttribute("aria-label", view === "years" ? "Next years" : view === "months" ? "Next year" : "Next month");
    }
  };
  const paintGrid = () => {
    const month = box.dataset.calMonth || isoToday().slice(0, 7);
    const selected = getIso() || "";
    const maxIso = box.dataset.calMax || "";
    const minIso = box.dataset.calMin || "";
    const view = box.dataset.calView || "days";
    const { year } = monthPartsFromKey(month);
    syncTitle();
    syncClear(selected);
    if (weekEl) weekEl.hidden = view !== "days";
    if (!grid) return;
    grid.classList.toggle("is-months", view === "months");
    grid.classList.toggle("is-years", view === "years");
    if (view === "months") {
      grid.innerHTML = appCalMonthsHtml(year, month, { maxIso, minIso });
      grid.querySelectorAll("[data-cal-month-pick]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          box.dataset.calMonth = btn.dataset.calMonthPick || month;
          box.dataset.calView = "days";
          paintGrid();
        });
      });
    } else if (view === "years") {
      const page = Number(box.dataset.calYearPage) || Math.floor(year / 12) * 12;
      box.dataset.calYearPage = String(page);
      grid.innerHTML = appCalYearsHtml(page, year, { maxIso, minIso });
      grid.querySelectorAll("[data-cal-year-pick]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const nextYear = Number(btn.dataset.calYearPick) || year;
          const { month: monthNum } = monthPartsFromKey(month);
          box.dataset.calMonth = clampMonthKey(nextYear, monthNum, { minIso, maxIso });
          box.dataset.calView = "months";
          paintGrid();
        });
      });
    } else {
      grid.innerHTML = appCalGridHtml(month, selected, { maxIso, minIso });
      grid.querySelectorAll("[data-cal-day]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const day = btn.dataset.calDay || "";
          if (trigger && !trigger.classList.contains("is-icon")) {
            trigger.textContent = day ? fmt(day) : "Pick a date";
          }
          box.dataset.calIso = day;
          syncClear(day);
          closePop();
          setIso(day);
        });
      });
    }
    placePop();
  };
  const restoreOverlay = () => {
    if (!box?.isConnected) {
      scrim?.remove();
      pop?.remove();
      return;
    }
    if (scrim && scrim.parentElement !== box) box.append(scrim);
    if (pop && pop.parentElement !== box) box.append(pop);
  };
  const onDocClick = (event) => {
    if (pop?.hidden) return;
    if (box.contains(event.target) || pop?.contains(event.target) || scrim?.contains(event.target)) return;
    closePop();
  };
  const closePop = () => {
    if (!pop) return;
    document.removeEventListener("click", onDocClick);
    pop.hidden = true;
    if (scrim) scrim.hidden = true;
    box.classList.remove("is-open");
    box.dataset.calView = "days";
    pop.style.left = "";
    pop.style.top = "";
    pop.style.visibility = "";
    window.removeEventListener("resize", onReposition);
    window.removeEventListener("scroll", onReposition, true);
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    restoreOverlay();
  };
  const openPop = () => {
    const selected = getIso() || "";
    const seed = /^\d{4}-\d{2}-\d{2}$/.test(selected) ? selected : isoToday();
    const month = seed.slice(0, 7);
    const { year } = monthPartsFromKey(month);
    box.dataset.calMonth = month;
    box.dataset.calView = "days";
    box.dataset.calYearPage = String(Math.floor(year / 12) * 12);
    // Cards use contain:paint, which traps position:fixed — mount over the page instead.
    if (scrim) document.body.append(scrim);
    if (pop) document.body.append(pop);
    paintGrid();
    if (scrim) scrim.hidden = false;
    pop.hidden = false;
    box.classList.add("is-open");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    placePop();
    requestAnimationFrame(placePop);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    window.setTimeout(() => document.addEventListener("click", onDocClick), 0);
  };
  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pop.hidden) openPop();
    else closePop();
  });
  monthChip?.addEventListener("click", (event) => {
    event.stopPropagation();
    const view = box.dataset.calView || "days";
    box.dataset.calView = view === "months" ? "days" : "months";
    paintGrid();
  });
  yearChip?.addEventListener("click", (event) => {
    event.stopPropagation();
    const view = box.dataset.calView || "days";
    if (view === "years") {
      box.dataset.calView = "days";
    } else {
      const { year } = monthPartsFromKey(box.dataset.calMonth || isoToday().slice(0, 7));
      box.dataset.calYearPage = String(Math.floor(year / 12) * 12);
      box.dataset.calView = "years";
    }
    paintGrid();
  });
  prevBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const view = box.dataset.calView || "days";
    const cur = box.dataset.calMonth || isoToday().slice(0, 7);
    const minIso = box.dataset.calMin || "";
    const maxIso = box.dataset.calMax || "";
    if (view === "years") {
      const page = Number(box.dataset.calYearPage) || Math.floor(monthPartsFromKey(cur).year / 12) * 12;
      const nextPage = page - 12;
      const minY = /^\d{4}-\d{2}-\d{2}$/.test(minIso) ? Number(minIso.slice(0, 4)) : null;
      if (minY != null && nextPage + 11 < minY) return;
      box.dataset.calYearPage = String(nextPage);
      paintGrid();
      return;
    }
    if (view === "months") {
      const { year, month } = monthPartsFromKey(cur);
      const next = clampMonthKey(year - 1, month, { minIso, maxIso });
      if (Number(next.slice(0, 4)) >= year) return;
      box.dataset.calMonth = next;
      paintGrid();
      return;
    }
    const prev = shiftMonthKey(cur, -1);
    if (minIso && prev < minIso.slice(0, 7)) return;
    box.dataset.calMonth = prev;
    paintGrid();
  });
  nextBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const view = box.dataset.calView || "days";
    const cur = box.dataset.calMonth || isoToday().slice(0, 7);
    const minIso = box.dataset.calMin || "";
    const maxIso = box.dataset.calMax || "";
    if (view === "years") {
      const page = Number(box.dataset.calYearPage) || Math.floor(monthPartsFromKey(cur).year / 12) * 12;
      const nextPage = page + 12;
      const maxY = /^\d{4}-\d{2}-\d{2}$/.test(maxIso) ? Number(maxIso.slice(0, 4)) : null;
      if (maxY != null && nextPage > maxY) return;
      box.dataset.calYearPage = String(nextPage);
      paintGrid();
      return;
    }
    if (view === "months") {
      const { year, month } = monthPartsFromKey(cur);
      const next = clampMonthKey(year + 1, month, { minIso, maxIso });
      if (Number(next.slice(0, 4)) <= year) return;
      box.dataset.calMonth = next;
      paintGrid();
      return;
    }
    const next = shiftMonthKey(cur, 1);
    if (maxIso && next > maxIso.slice(0, 7)) return;
    box.dataset.calMonth = next;
    paintGrid();
  });
  clearBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!clearable) return;
    if (trigger && !trigger.classList.contains("is-icon")) trigger.textContent = "Pick a date";
    box.dataset.calIso = "";
    syncClear("");
    closePop();
    setIso("");
  });
  scrim?.addEventListener("click", (event) => {
    event.stopPropagation();
    closePop();
  });
  pop?.addEventListener("click", (event) => event.stopPropagation());
}

function courseSegHtml(name, options, value = "") {
  return `<div class="cycle-seg" role="group" data-seg="${name}">
    ${options
      .map(
        ([id, label]) =>
          `<button type="button" class="cycle-seg-btn${value === id ? " is-on" : ""}" data-seg-val="${escapeHtml(id)}">${escapeHtml(label)}</button>`
      )
      .join("")}
  </div>`;
}

function bindCourseSeg(root, name, onPick) {
  const box = root.querySelector(`[data-seg="${name}"]`);
  if (!box) return;
  box.querySelectorAll("[data-seg-val]").forEach((btn) => {
    btn.addEventListener("click", () => {
      box.querySelectorAll(".cycle-seg-btn").forEach((node) => node.classList.toggle("is-on", node === btn));
      onPick(btn.dataset.segVal || "");
    });
  });
}

function cycleMonthPeekHtml(monthKey, cycle) {
  const today = isoToday();
  const marks = cycleDayMarks(cycle);
  const cells = monthGridCells(monthKey, (iso, day) => {
    const kind = marks.period.has(iso)
      ? "period"
      : marks.predicted.has(iso)
        ? "pred"
        : marks.fertile.has(iso)
          ? "fertile"
          : "";
    return { empty: false, iso, day, kind, today: iso === today, sunday: isSundayIso(iso) };
  });
  return `
    <div class="cycle-cal-head">
      <h3>${escapeHtml(monthLabelForKey(monthKey))}</h3>
    </div>
    <div class="cycle-week">${monthWeekHeaderHtml()}</div>
    <div class="cycle-grid">
      ${cells
        .map((cell) =>
          cell.empty
            ? `<span class="cycle-day is-mute"></span>`
            : `<span class="cycle-day${cell.kind ? ` is-${cell.kind}` : ""}${cell.today ? " is-today" : ""}${cell.sunday ? " is-sunday" : ""}">${cell.day}</span>`
        )
        .join("")}
    </div>
    <div class="cycle-legend">
      <span><i class="is-period"></i>Period</span>
      <span><i class="is-pred"></i>Predicted period</span>
      <span><i class="is-fertile"></i>Fertile</span>
      <span><i class="is-today"></i>Today</span>
    </div>
  `;
}

function playMonthSlide(surface, dir) {
  if (!surface || !dir) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  const from = dir > 0 ? "from-right" : "from-left";
  surface.classList.remove("month-slide-in", "month-slide-from-left", "month-slide-from-right");
  // Restart CSS animation without waiting an extra frame before paint.
  void surface.offsetWidth;
  surface.classList.add("month-slide-in", `month-slide-${from}`);
  const done = (event) => {
    if (event.target !== surface) return;
    surface.classList.remove("month-slide-in", "month-slide-from-left", "month-slide-from-right");
    surface.removeEventListener("animationend", done);
  };
  surface.addEventListener("animationend", done);
}

function bindMonthSwipe(surface, onMonth, getPeekHtml) {
  if (!surface || surface.dataset.monthSwipe === "1") return;
  surface.dataset.monthSwipe = "1";
  const threshold = 48;
  const snapMs = 120;
  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  let startX = 0;
  let startY = 0;
  let pointerId = 0;
  let tracking = false;
  let axis = "";
  let dragging = false;
  let lastDx = 0;
  let settling = false;
  let skipClick = false;
  let track = null;
  let peekDir = 0;
  let paneWidth = 0;

  const restX = () => (peekDir < 0 ? -paneWidth : 0);

  const teardownTrack = () => {
    if (!track) {
      peekDir = 0;
      paneWidth = 0;
      return;
    }
    const current = track.querySelector(".month-swipe-pane.is-current");
    if (current) {
      while (current.firstChild) surface.appendChild(current.firstChild);
    }
    track.remove();
    track = null;
    peekDir = 0;
    paneWidth = 0;
    surface.classList.remove("is-month-carousel");
  };

  const clearPaint = () => {
    surface.classList.remove("is-month-dragging", "is-month-settling");
    teardownTrack();
    surface.style.transition = "";
    surface.style.transform = "";
  };

  const resetGesture = () => {
    tracking = false;
    axis = "";
    pointerId = 0;
    dragging = false;
    lastDx = 0;
  };

  const ensureTrack = (dir) => {
    if (!dir || typeof getPeekHtml !== "function") return false;
    if (track && peekDir === dir) return true;
    teardownTrack();
    const styles = window.getComputedStyle(surface);
    const padX =
      (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
    paneWidth = Math.max(1, surface.clientWidth - padX);
    const current = document.createElement("div");
    current.className = "month-swipe-pane is-current";
    current.style.flex = `0 0 ${paneWidth}px`;
    current.style.width = `${paneWidth}px`;
    while (surface.firstChild) current.appendChild(surface.firstChild);
    const peek = document.createElement("div");
    peek.className = "month-swipe-pane is-peek";
    peek.style.flex = `0 0 ${paneWidth}px`;
    peek.style.width = `${paneWidth}px`;
    peek.setAttribute("aria-hidden", "true");
    peek.innerHTML = getPeekHtml(dir) || "";
    track = document.createElement("div");
    track.className = "month-swipe-track";
    if (dir > 0) track.append(current, peek);
    else track.append(peek, current);
    surface.appendChild(track);
    surface.classList.add("is-month-carousel");
    peekDir = dir;
    track.style.transition = "none";
    track.style.transform = `translateX(${restX()}px)`;
    return true;
  };

  const paintDrag = (dx) => {
    lastDx = dx;
    if (!getPeekHtml) {
      surface.style.transition = "none";
      surface.style.transform = `translateX(${dx}px)`;
      return;
    }
    if (Math.abs(dx) < 1) {
      if (track) {
        track.style.transition = "none";
        track.style.transform = `translateX(${restX()}px)`;
      }
      return;
    }
    const dir = dx < 0 ? 1 : -1;
    if (!ensureTrack(dir)) return;
    // Finger-follow on the track: current slides; neighbor peeks in from the side.
    const x = dir > 0 ? Math.min(0, dx) : -paneWidth + Math.max(0, dx);
    track.style.transition = "none";
    track.style.transform = `translateX(${x}px)`;
  };

  const snapBack = (ms) =>
    new Promise((resolve) => {
      if (!track || reduceMotion() || ms <= 0) {
        clearPaint();
        resolve();
        return;
      }
      let finished = false;
      const finishAnim = () => {
        if (finished) return;
        finished = true;
        track?.removeEventListener("transitionend", onEnd);
        clearPaint();
        resolve();
      };
      const onEnd = (event) => {
        if (event.target !== track || event.propertyName !== "transform") return;
        finishAnim();
      };
      surface.classList.add("is-month-settling");
      track.style.transition = `transform ${ms}ms ease-out`;
      track.style.transform = `translateX(${restX()}px)`;
      track.addEventListener("transitionend", onEnd);
      window.setTimeout(finishAnim, ms + 32);
    });

  const releaseCapture = (id) => {
    try {
      surface.releasePointerCapture(id);
    } catch {
      /* already released */
    }
  };

  surface.addEventListener(
    "pointerdown",
    (event) => {
      if (settling) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest("input, textarea, select, a")) return;
      tracking = true;
      axis = "";
      dragging = false;
      lastDx = 0;
      startX = event.clientX;
      startY = event.clientY;
      pointerId = event.pointerId;
      if (track) track.style.transition = "none";
      else surface.style.transition = "none";
    },
    { passive: true }
  );
  surface.addEventListener(
    "pointermove",
    (event) => {
      if (!tracking || settling || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          axis = "v";
          return;
        }
        if (Math.abs(dx) > Math.abs(dy) * 1.4) {
          axis = "h";
          dragging = true;
          surface.classList.add("is-month-dragging");
          try {
            surface.setPointerCapture(event.pointerId);
          } catch {
            /* some browsers ignore capture during scroll */
          }
          if (!reduceMotion()) paintDrag(dx);
          else lastDx = dx;
        }
        return;
      }
      if (axis === "v") return;
      if (reduceMotion()) {
        lastDx = dx;
        return;
      }
      paintDrag(dx);
    },
    { passive: true }
  );
  const finish = (event) => {
    if (!tracking || event.pointerId !== pointerId) return;
    const dx = dragging ? lastDx : event.clientX - startX;
    const horizontal = axis === "h";
    const id = pointerId;
    const didDrag = dragging;
    if (horizontal) releaseCapture(id);
    resetGesture();
    if (!horizontal) {
      clearPaint();
      return;
    }
    if (didDrag) skipClick = true;
    const commit = Math.abs(dx) >= threshold;
    if (commit) {
      // Commit immediately — don't wait on exit settle before month change/render.
      clearPaint();
      onMonth(dx < 0 ? 1 : -1);
      return;
    }
    if (reduceMotion()) {
      clearPaint();
      return;
    }
    settling = true;
    void snapBack(snapMs).then(() => {
      settling = false;
    });
  };
  surface.addEventListener("pointerup", finish);
  surface.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== pointerId) return;
    const horizontal = axis === "h";
    const id = pointerId;
    const didDrag = dragging;
    if (horizontal) releaseCapture(id);
    resetGesture();
    if (!horizontal) {
      clearPaint();
      return;
    }
    if (didDrag) skipClick = true;
    if (reduceMotion()) {
      clearPaint();
      return;
    }
    settling = true;
    void snapBack(snapMs).then(() => {
      settling = false;
    });
  });
  surface.addEventListener(
    "click",
    (event) => {
      if (!skipClick) return;
      skipClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}

function noteAtForDay(day) {
  if (day === isoToday()) return Date.now();
  const stamp = new Date(`${day}T12:00:00`);
  return Number.isNaN(stamp.getTime()) ? Date.now() : stamp.getTime();
}

function diaryDayParts(iso) {
  const when = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(when.getTime())) {
    return { weekday: "", date: iso, num: "", dow: "", long: iso };
  }
  return {
    weekday: when.toLocaleDateString(undefined, { weekday: "long" }),
    date: when.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
    num: String(when.getDate()),
    dow: when.toLocaleDateString(undefined, { weekday: "short" }),
    long: when.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
  };
}

function diaryPlaceholder(iso, tone = "good") {
  const kind = tone === "bad" ? "bad" : "good";
  if (iso === isoToday()) {
    return kind === "bad" ? "Something hard that happened today" : "Something good that happened today";
  }
  const parts = diaryDayParts(iso);
  if (!parts.long) return kind === "bad" ? "Something hard that day" : "Something good that day";
  return kind === "bad" ? `Something hard on ${parts.long}` : `Something good on ${parts.long}`;
}

function openDiary(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  todayScrollY = pageScrollY();
  if (openDiaryDay !== day) overviewComposing = false;
  openDiaryDay = day;
  diaryMonth = day.slice(0, 7);
  openNoteId = null;
  if (todayDraftId) {
    const draft = state.notes.find((note) => note.id === todayDraftId);
    if (!draft || noteDay(draft) !== day) todayDraftId = null;
  }
  render();
}

function diaryTime(note) {
  const at = Number(note?.at) || 0;
  if (!at) return "";
  const day = noteDay(note);
  const noon = day ? new Date(`${day}T12:00:00`).getTime() : 0;
  if (noon && Math.abs(at - noon) < 1000) return "";
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function todayNoteCard(note) {
  const who = noteWho(note);
  const time = diaryTime(note);
  const tone = noteTone(note);
  const meta = [who && `<span class="diary-who">${escapeHtml(who)}</span>`, time && `<span>${escapeHtml(time)}</span>`]
    .filter(Boolean)
    .join(`<span class="diary-sep">·</span>`);
  return el(`
    <article class="today-note is-open diary-entry overview-note is-${tone}" data-note="${escapeHtml(note.id)}" role="button" tabindex="0">
      <span class="overview-note-tone" aria-hidden="true">${tone === "bad" ? "Bad" : "Good"}</span>
      ${meta ? `<p class="today-time">${meta}</p>` : ""}
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
  const menu = el(`<div class="hold-menu" data-story-del hidden>
    <button type="button" class="hold-menu-scrim" data-hold-scrim aria-label="Dismiss"></button>
    <div class="hold-menu-card" role="dialog" aria-modal="true" aria-labelledby="hold-menu-title">
      <p class="hold-menu-kicker" data-hold-kicker>Delete</p>
      <h2 class="hold-menu-title" id="hold-menu-title" data-hold-title>Remove this item?</h2>
      <p class="hold-menu-note" data-hold-note hidden></p>
      <div class="hold-menu-row">
        <button type="button" class="hold-menu-btn" data-act="cancel">Keep</button>
        <button type="button" class="hold-menu-btn is-danger" data-act="delete">Delete</button>
      </div>
      <div class="hold-menu-extra" data-hold-extra hidden>
        <button type="button" data-act="edit" hidden>Edit</button>
        <button type="button" data-act="last-day" hidden>Last day</button>
      </div>
    </div>
  </div>`);
  page.append(menu);
  let pendingDelete = null;
  let pendingEdit = null;
  let pendingLastDay = null;
  let ignoreOpen = false;
  const kickerEl = menu.querySelector("[data-hold-kicker]");
  const titleEl = menu.querySelector("[data-hold-title]");
  const noteEl = menu.querySelector("[data-hold-note]");
  const extraBox = menu.querySelector("[data-hold-extra]");
  const editBtn = menu.querySelector('[data-act="edit"]');
  const lastDayBtn = menu.querySelector('[data-act="last-day"]');

  const labelFromCard = (card) => {
    const raw =
      card?.querySelector?.("[data-label]")?.value ||
      card?.querySelector?.(".daily-label")?.textContent ||
      card?.querySelector?.("[data-text]")?.value ||
      card?.querySelector?.("h3")?.textContent ||
      card?.querySelector?.(".cycle-course-title")?.textContent ||
      card?.getAttribute?.("aria-label") ||
      "";
    return String(raw || "").replace(/\s+/g, " ").trim();
  };

  const close = () => {
    if (!menu.hidden) ignoreOpen = true;
    menu.hidden = true;
    document.body.classList.remove("is-hold-menu");
    pendingDelete = null;
    pendingEdit = null;
    pendingLastDay = null;
  };

  const open = (card, handlers) => {
    if (typeof handlers === "function") {
      pendingDelete = handlers;
      pendingEdit = null;
      pendingLastDay = null;
    } else {
      pendingDelete = handlers?.onDelete || null;
      pendingEdit = handlers?.onEdit || null;
      pendingLastDay = handlers?.onLastDay || null;
    }
    const label = String(handlers?.label || labelFromCard(card) || "").trim();
    const kicker = String(handlers?.kicker || "Delete").trim();
    const title = String(handlers?.title || (label ? `Remove “${label}”?` : "Remove this item?")).trim();
    const note = String(handlers?.note || "").trim();
    if (kickerEl) kickerEl.textContent = kicker;
    if (titleEl) titleEl.textContent = title;
    if (noteEl) {
      noteEl.textContent = note;
      noteEl.hidden = !note;
    }
    if (editBtn) editBtn.hidden = !pendingEdit;
    if (lastDayBtn) lastDayBtn.hidden = !pendingLastDay;
    if (extraBox) extraBox.hidden = !(pendingEdit || pendingLastDay);
    ignoreOpen = false;
    menu.hidden = false;
    document.body.classList.add("is-hold-menu");
  };

  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const runDelete = pendingDelete;
    const runEdit = pendingEdit;
    const runLastDay = pendingLastDay;
    close();
    ignoreOpen = true;
    if (act === "edit") runEdit?.();
    else if (act === "last-day") runLastDay?.();
    else if (act === "delete") runDelete?.();
  });
  menu.querySelector("[data-hold-scrim]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  page.addEventListener("pointerdown", (event) => {
    if (menu.hidden) return;
    if (event.target.closest("[data-story-del]")) return;
    close();
  });
  return {
    open,
    close,
    consume() {
      if (!ignoreOpen) return false;
      ignoreOpen = false;
      return true;
    },
  };
}

function bindHoldOpen(card, { menu, onOpen, onDelete, onEdit, onLastDay }) {
  let hold = 0;
  let skipClick = false;
  const swallow = (event) => {
    if (skipClick || menu.consume()) {
      skipClick = false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  };
  card.addEventListener("click", swallow, true);
  if (onOpen) {
    bindOpenCard(card, () => {
      if (skipClick || menu.consume()) {
        skipClick = false;
        return;
      }
      onOpen();
    });
  }
  card.addEventListener("pointerdown", () => {
    skipClick = false;
    hold = window.setTimeout(() => {
      skipClick = true;
      navigator.vibrate?.(10);
      menu.open(card, { onDelete, onEdit, onLastDay });
    }, 480);
  });
  const cancelHold = () => window.clearTimeout(hold);
  card.addEventListener("pointerup", cancelHold);
  card.addEventListener("pointercancel", cancelHold);
  card.addEventListener("contextmenu", (event) => event.preventDefault());
}

function bindDailyHabitReorder(tbody) {
  const slot = dailySlotOf(tbody.closest("[data-slot-group]")?.dataset.slotGroup);
  let drag = null;
  let moveRaf = 0;
  let pendingY = 0;

  const liveRows = () =>
    [...tbody.querySelectorAll(".daily-item")].filter(
      (row) => !row.classList.contains("is-placeholder") && !row.classList.contains("is-drag-source")
    );

  const orderedIds = () => {
    const ids = [];
    [...tbody.querySelectorAll(".daily-item")].forEach((row) => {
      if (row.classList.contains("is-placeholder")) {
        if (drag?.row?.dataset.id) ids.push(drag.row.dataset.id);
        return;
      }
      if (row.classList.contains("is-drag-source")) return;
      if (row.dataset.id) ids.push(row.dataset.id);
    });
    return ids;
  };

  const movePlaceholder = (clientY) => {
    if (!drag?.placeholder) return;
    const others = liveRows();
    let before = null;
    for (const other of others) {
      const rect = other.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        before = other;
        break;
      }
    }
    if (before) tbody.insertBefore(drag.placeholder, before);
    else tbody.appendChild(drag.placeholder);
  };

  const autoScroll = (clientY) => {
    const edge = 72;
    const max = 18;
    if (clientY < edge) {
      window.scrollBy(0, -Math.ceil(((edge - clientY) / edge) * max));
      return true;
    }
    if (clientY > window.innerHeight - edge) {
      window.scrollBy(0, Math.ceil(((clientY - (window.innerHeight - edge)) / edge) * max));
      return true;
    }
    return false;
  };

  const paintMove = () => {
    moveRaf = 0;
    if (!drag) return;
    const y = pendingY - drag.offsetY;
    drag.ghost.style.transform = `translate3d(${drag.left}px, ${y}px, 0)`;
    movePlaceholder(pendingY);
    if (autoScroll(pendingY)) movePlaceholder(pendingY);
  };

  const finish = () => {
    if (!drag) return;
    const { row, placeholder, ghost, origin, handle, pointerId } = drag;
    if (moveRaf) {
      cancelAnimationFrame(moveRaf);
      moveRaf = 0;
    }
    try {
      handle.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    if (placeholder?.parentNode) {
      tbody.insertBefore(row, placeholder);
      placeholder.remove();
    }
    ghost?.remove();
    row.classList.remove("is-drag-source");
    tbody.classList.remove("is-reordering");
    document.body.classList.remove("is-daily-sorting");
    drag = null;
    const nextIds = orderedIds();
    if (nextIds.join("|") === origin.join("|")) return;
    writeDaily({
      habits: reorderDailyHabitsInSlot(normalizeDaily(state.daily).habits, slot, nextIds),
    });
  };

  tbody.querySelectorAll("[data-drag]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) return;
      const row = handle.closest(".daily-item");
      if (!row || !tbody.contains(row) || drag) return;
      event.preventDefault();
      event.stopPropagation();

      const origin = [...tbody.querySelectorAll(".daily-item")]
        .map((item) => item.dataset.id)
        .filter(Boolean);
      const rect = row.getBoundingClientRect();
      const colSpan = Math.max(1, row.children.length);
      const placeholder = document.createElement("tr");
      placeholder.className = "daily-item is-placeholder";
      placeholder.innerHTML = `<td colspan="${colSpan}"><div class="daily-drag-gap" style="height:${Math.round(rect.height)}px"></div></td>`;
      row.after(placeholder);

      const label =
        row.querySelector("[data-label]")?.value?.trim() ||
        row.querySelector(".daily-label")?.textContent?.trim() ||
        "Task";
      const ghost = document.createElement("div");
      ghost.className = "daily-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = `<span>${escapeHtml(label)}</span>`;
      ghost.style.width = `${Math.round(rect.width)}px`;
      ghost.style.height = `${Math.round(rect.height)}px`;
      ghost.style.transform = `translate3d(${Math.round(rect.left)}px, ${Math.round(rect.top)}px, 0)`;
      document.body.appendChild(ghost);

      row.classList.add("is-drag-source");
      tbody.classList.add("is-reordering");
      document.body.classList.add("is-daily-sorting");

      drag = {
        row,
        placeholder,
        ghost,
        handle,
        pointerId: event.pointerId,
        origin,
        offsetY: event.clientY - rect.top,
        left: Math.round(rect.left),
      };

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      navigator.vibrate?.(8);
    });

    handle.addEventListener(
      "pointermove",
      (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        pendingY = event.clientY;
        if (!moveRaf) moveRaf = requestAnimationFrame(paintMove);
      },
      { passive: false }
    );

    handle.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      finish();
    });
    handle.addEventListener("pointercancel", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      finish();
    });
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("contextmenu", (event) => event.preventDefault());
  });
}

function todayEditorView(item) {
  const day = noteDay(item) || isoToday();
  const parts = diaryDayParts(day);
  let tone = noteTone(item);
  const wrap = el(`
    <div class="overview-page">
      <article class="card overview-head">
        <div class="overview-head-copy">
          <p class="overview-kicker">Edit note</p>
          <p class="overview-date">
            <span class="overview-weekday${isSundayIso(day) ? " is-sunday" : ""}">${escapeHtml(parts.weekday)}</span>
            <strong>${escapeHtml(parts.date)}</strong>
          </p>
        </div>
      </article>
      <form class="overview-compose is-edit card">
        <div class="overview-tone" role="group" aria-label="Good or bad">
          <button type="button" class="overview-tone-btn${tone === "good" ? " is-on" : ""}" data-tone="good">Good</button>
          <button type="button" class="overview-tone-btn${tone === "bad" ? " is-on" : ""}" data-tone="bad">Bad</button>
        </div>
        <textarea id="today-story" rows="10" placeholder="${escapeHtml(diaryPlaceholder(day, tone))}">${escapeHtml(item.text || "")}</textarea>
      </form>
    </div>
  `);
  let wait = 0;
  const save = () => {
    const text = wrap.querySelector("#today-story").value;
    setState({
      notes: state.notes.map((note) => (note.id === item.id ? { ...note, text, day, tone } : note)),
    }, true);
  };
  const syncTone = () => {
    wrap.querySelectorAll("[data-tone]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.tone === tone);
    });
    wrap.querySelector("#today-story").placeholder = diaryPlaceholder(day, tone);
  };
  wrap.querySelectorAll("[data-tone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tone = btn.dataset.tone === "bad" ? "bad" : "good";
      syncTone();
      save();
    });
  });
  wrap.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  wrap.querySelector("form").addEventListener("input", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(save, 400);
  });
  return wrap;
}

function bindDiaryNote(card, { menu, box }) {
  const id = card.dataset.note;
  if (!id) return;
  bindHoldOpen(card, {
    menu,
    onOpen: () => {
      openNoteId = id;
      const item = state.notes.find((note) => note.id === id);
      if (item) openDiaryDay = noteDay(item) || openDiaryDay;
      render();
    },
    onDelete: () => {
      setState({ notes: state.notes.filter((note) => note.id !== id) }, true);
      card.remove();
      if (todayDraftId === id) {
        todayDraftId = null;
        if (box) box.value = "";
      }
    },
  });
}

function overviewPanelHtml(tone, notes) {
  const label = tone === "bad" ? "Bad" : "Good";
  const empty = tone === "bad" ? "No hard moments logged." : "No good moments logged.";
  return `
    <article class="card overview-panel is-${tone}">
      <div class="overview-panel-head">
        <h3>${label}</h3>
        <span class="overview-panel-count">${notes.length}</span>
      </div>
      <div class="overview-list" data-list="${tone}">
        ${notes.length ? "" : `<p class="overview-empty">${empty}</p>`}
      </div>
    </article>
  `;
}

function todayDayView(day) {
  const parts = diaryDayParts(day);
  const counts = dayToneCounts(day);
  const goodNotes = notesForDayTone(day, "good");
  const badNotes = notesForDayTone(day, "bad");
  if (overviewTone !== "bad") overviewTone = "good";
  const wrap = el(`
    <div class="overview-page">
      <article class="card overview-head">
        <div class="overview-head-row">
          <div class="overview-head-copy">
            <p class="overview-kicker">Day overview</p>
            <p class="overview-date">
              <span class="overview-weekday${isSundayIso(day) ? " is-sunday" : ""}">${escapeHtml(parts.weekday)}</span>
              <strong class="${isSundayIso(day) ? "is-sunday" : ""}">${escapeHtml(parts.date)}</strong>
            </p>
            <p class="overview-counts" aria-label="Notes this day">
              <span class="is-good">${counts.good} good</span>
              <span class="is-bad">${counts.bad} bad</span>
            </p>
          </div>
          <div class="overview-jump">${appCalPickerHtml("overview-jump", day, { icon: true })}</div>
        </div>
      </article>
      ${goodNotes.length ? overviewPanelHtml("good", goodNotes) : ""}
      ${badNotes.length ? overviewPanelHtml("bad", badNotes) : ""}
      ${
        overviewComposing
          ? `<form class="overview-compose card">
        <div class="overview-tone" role="group" aria-label="Good or bad">
          <button type="button" class="overview-tone-btn${overviewTone === "good" ? " is-on" : ""}" data-tone="good">Good</button>
          <button type="button" class="overview-tone-btn${overviewTone === "bad" ? " is-on" : ""}" data-tone="bad">Bad</button>
        </div>
        <div class="overview-add-row">
          <textarea data-new rows="2" placeholder="${escapeHtml(diaryPlaceholder(day, overviewTone))}" maxlength="2000" enterkeyhint="done"></textarea>
        </div>
        <button type="submit" class="compose-done-btn" data-overview-save>Save</button>
      </form>`
          : `<div class="overview-add-wrap">
        <button type="button" class="overview-add-btn" data-overview-add>Add</button>
      </div>`
      }
    </div>
  `);
  const menu = storyDeleteMenu(wrap);
  const box = wrap.querySelector("[data-new]");
  goodNotes.forEach((note) => {
    const card = todayNoteCard(note);
    wrap.querySelector('[data-list="good"]')?.append(card);
    bindDiaryNote(card, { menu, box });
  });
  badNotes.forEach((note) => {
    const card = todayNoteCard(note);
    wrap.querySelector('[data-list="bad"]')?.append(card);
    bindDiaryNote(card, { menu, box });
  });
  bindAppCalPicker(wrap, "overview-jump", {
    getIso: () => day,
    setIso: (iso) => {
      const next = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
      if (!next || next === day) return;
      openDiary(next);
    },
  });
  if (!overviewComposing) {
    wrap.querySelector("[data-overview-add]")?.addEventListener("click", () => {
      overviewComposing = true;
      overviewTone = "good";
      render();
    });
    return wrap;
  }
  const syncToneUi = () => {
    wrap.querySelectorAll(".overview-compose [data-tone]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.tone === overviewTone);
    });
    box.placeholder = diaryPlaceholder(day, overviewTone);
    wrap.querySelector(".overview-compose")?.classList.toggle("is-bad", overviewTone === "bad");
    wrap.querySelector(".overview-compose")?.classList.toggle("is-good", overviewTone === "good");
  };
  wrap.querySelectorAll(".overview-compose [data-tone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      overviewTone = btn.dataset.tone === "bad" ? "bad" : "good";
      syncToneUi();
    });
  });
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.value.trim();
    todayDraftId = null;
    overviewComposing = false;
    if (text) {
      const note = {
        id: uid(),
        from: currentName(),
        text,
        at: noteAtForDay(day),
        day,
        tone: overviewTone === "bad" ? "bad" : "good",
      };
      setState({ notes: [...state.notes, note] }, true);
    }
    render();
  });
  syncToneUi();
  requestAnimationFrame(() => box?.focus());
  return wrap;
}

function todayView() {
  diaryMonth = diaryMonthKey(diaryMonth);
  if (openNoteId) {
    const item = state.notes.find((note) => note.id === openNoteId);
    if (item) {
      if (!openDiaryDay) openDiaryDay = noteDay(item);
      return todayEditorView(item);
    }
    openNoteId = null;
  }
  if (!openDiaryDay) openDiaryDay = isoToday();
  return todayDayView(openDiaryDay);
}

function memoryDay(item) {
  const iso = memoryIso(item);
  const when = iso ? new Date(`${iso}T12:00:00`) : item.at ? new Date(item.at) : null;
  if (!when || Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString(
    undefined,
    item.noYear
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "long", day: "numeric", month: "short", year: "numeric" }
  );
}

function memoryIso(item) {
  const day = String(item?.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return item?.at ? isoTodayFrom(item.at) : "";
}

function isKeptMemory(id) {
  return KEPT_DATES.some((row) => row.id === id);
}

function memoryMarkNext(item) {
  const iso = memoryIso(item);
  if (!iso) return "";
  const mmdd = iso.slice(5);
  const today = isoToday();
  let year = Number(today.slice(0, 4));
  let next = `${year}-${mmdd}`;
  const stamp = new Date(`${next}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  next = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
  if (next < today) {
    year += 1;
    const again = new Date(`${year}-${mmdd}T12:00:00`);
    if (Number.isNaN(again.getTime())) return "";
    next = `${again.getFullYear()}-${String(again.getMonth() + 1).padStart(2, "0")}-${String(again.getDate()).padStart(2, "0")}`;
  }
  return next;
}

function memoryYearsOn(item, onIso) {
  const iso = memoryIso(item);
  if (!iso || !onIso || item.noYear) return 0;
  return Math.max(0, Number(onIso.slice(0, 4)) - Number(iso.slice(0, 4)));
}

function memoryRelLabel(item) {
  const iso = memoryIso(item);
  if (!iso) return "";
  const today = isoToday();
  if (item.noYear) {
    const next = memoryMarkNext(item);
    const diff = isoDiffDays(today, next);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff <= 60) return `In ${diff} days`;
    return memoryDay(item);
  }
  if (iso === today) return "Today";
  if (iso > today) {
    const ahead = isoDiffDays(today, iso);
    if (ahead === 1) return "Tomorrow";
    if (ahead <= 60) return `In ${ahead} days`;
    return memoryDay(item);
  }
  const ago = isoDiffDays(iso, today);
  if (ago === 1) return "Yesterday";
  if (ago < 30) return `${ago} days ago`;
  if (ago < 365) {
    const months = Math.max(1, Math.round(ago / 30));
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.max(1, Math.floor(ago / 365));
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function memoryUpcomingRows(within = 45) {
  const today = isoToday();
  const rows = [];
  for (const item of state.dates || []) {
    const next = memoryMarkNext(item);
    if (!next) continue;
    const diff = isoDiffDays(today, next);
    if (diff < 0 || diff > within) continue;
    const years = memoryYearsOn(item, next);
    rows.push({ item, next, diff, years });
  }
  rows.sort((a, b) => a.diff - b.diff || String(a.item.text || "").localeCompare(String(b.item.text || "")));
  return rows;
}

function memoryCardHtml(item, { upcoming = null } = {}) {
  const text = item.text || item.title || "";
  const story = String(item.story || "").trim();
  const when = upcoming
    ? upcoming.diff === 0
      ? "Today"
      : upcoming.diff === 1
        ? "Tomorrow"
        : `In ${upcoming.diff} days`
    : "";
  const dateLine = memoryDay(item);
  const years = upcoming?.years || 0;
  const meta = [when, dateLine].filter(Boolean).join(" · ");
  const badges = [
    item.noYear ? `<span class="memories-badge">Yearly</span>` : "",
    isKeptMemory(item.id) ? `<span class="memories-badge is-kept">Kept</span>` : "",
    years > 0 ? `<span class="memories-badge is-years">${years}y</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `
    <article class="memories-note${item.noYear ? " is-yearly" : ""}${isKeptMemory(item.id) ? " is-kept" : ""}" data-memory="${escapeHtml(item.id)}" role="button" tabindex="0">
      <div class="memories-note-top">
        <p class="memories-note-when">${escapeHtml(meta)}</p>
        ${badges ? `<div class="memories-badges">${badges}</div>` : ""}
      </div>
      <h3 class="memories-note-title">${escapeHtml(text)}</h3>
      ${story ? `<p class="memories-note-story">${escapeHtml(story.length > 90 ? `${story.slice(0, 90)}…` : story)}</p>` : ""}
    </article>
  `;
}

function datesView() {
  if (openMemoryId) {
    const item = state.dates.find((row) => row.id === openMemoryId);
    if (item) return memoryEditorView(item);
    openMemoryId = null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(memoryDraftDate)) memoryDraftDate = isoToday();
  const rows = [...state.dates].sort((a, b) => {
    const da = memoryIso(a) || String(a.at || "");
    const db = memoryIso(b) || String(b.at || "");
    return db.localeCompare(da);
  });
  const upcoming = memoryUpcomingRows(45);
  const groups = new Map();
  rows.forEach((item) => {
    const iso = memoryIso(item);
    const key = item.noYear ? "Yearly" : iso ? iso.slice(0, 4) : "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const groupKeys = [...groups.keys()].sort((a, b) => {
    if (a === "Yearly") return -1;
    if (b === "Yearly") return 1;
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return b.localeCompare(a);
  });
  const wrap = el(`
    <div class="memories-page">
      <article class="card memories-head">
        <div class="memories-head-copy">
          <p class="memories-kicker">Memories</p>
          <p class="memories-lead">Dates and stories you want to keep.</p>
          <p class="memories-counts" aria-label="Memory count">
            <span>${rows.length} saved</span>
            ${upcoming.length ? `<span class="is-soon">${upcoming.length} coming up</span>` : ""}
          </p>
        </div>
      </article>
      ${
        upcoming.length
          ? `<article class="card memories-upcoming">
        <div class="memories-section-head">
          <h3>Coming up</h3>
          <span>Next 45 days</span>
        </div>
        <div class="memories-upcoming-list">
          ${upcoming.map((row) => memoryCardHtml(row.item, { upcoming: row })).join("")}
        </div>
      </article>`
          : ""
      }
      <article class="card memories-list">
        <div class="memories-section-head">
          <h3>All</h3>
        </div>
        ${
          rows.length
            ? groupKeys
                .map((key) => {
                  const list = groups.get(key) || [];
                  return `<div class="memories-group">
                    <p class="memories-group-label">${escapeHtml(key)}</p>
                    <div class="memories-group-list">
                      ${list.map((item) => memoryCardHtml(item)).join("")}
                    </div>
                  </div>`;
                })
                .join("")
            : `<p class="memories-empty">No memories yet.</p>`
        }
      </article>
      ${
        memoriesComposing
          ? `<form class="memories-compose card">
        <div class="memories-compose-date">
          <span class="memories-compose-label">Date</span>
          ${appCalPickerHtml("memory-new-date", memoryDraftDate)}
        </div>
        <label class="memories-yearly">
          <input type="checkbox" data-yearly />
          <span>Repeat yearly</span>
        </label>
        <div class="memories-add-row">
          <input data-title type="text" maxlength="180" placeholder="Title" enterkeyhint="done" />
          <button class="memories-save" type="submit" data-save aria-label="Save" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5 10 17.5 19 7"/></svg>
          </button>
        </div>
        <textarea data-story rows="2" maxlength="4000" placeholder="Story (optional)"></textarea>
        <button type="button" class="compose-done-btn" data-memories-done>Done</button>
      </form>`
          : `<div class="memories-add-wrap">
        <button type="button" class="memories-add-btn" data-memories-add>Add</button>
      </div>`
      }
    </div>
  `);
  const menu = storyDeleteMenu(wrap);
  const bindCard = (node) => {
    const id = node.dataset.memory;
    const item = state.dates.find((row) => row.id === id);
    if (!item) return;
    if (isKeptMemory(item.id)) {
      bindOpenCard(node, () => {
        openMemoryId = item.id;
        render();
      });
      let hold = 0;
      node.addEventListener("pointerdown", () => {
        hold = window.setTimeout(() => {
          navigator.vibrate?.(10);
          showAppToast("Kept memories stay.");
        }, 480);
      });
      const cancel = () => window.clearTimeout(hold);
      node.addEventListener("pointerup", cancel);
      node.addEventListener("pointercancel", cancel);
      node.addEventListener("contextmenu", (event) => event.preventDefault());
      return;
    }
    bindHoldOpen(node, {
      menu,
      label: item.text || item.title || "Memory",
      onOpen: () => {
        openMemoryId = item.id;
        render();
      },
      onDelete: () => {
        setState({ dates: state.dates.filter((row) => row.id !== item.id) }, true);
        render();
      },
    });
  };
  wrap.querySelectorAll("[data-memory]").forEach(bindCard);
  if (!memoriesComposing) {
    wrap.querySelector("[data-memories-add]")?.addEventListener("click", () => {
      memoriesComposing = true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(memoryDraftDate)) memoryDraftDate = isoToday();
      render();
    });
    return wrap;
  }
  const titleBox = wrap.querySelector("[data-title]");
  const storyBox = wrap.querySelector("[data-story]");
  const yearlyBox = wrap.querySelector("[data-yearly]");
  const saveBtn = wrap.querySelector("[data-save]");
  const syncSave = () => {
    const ready = Boolean(titleBox.value.trim() && memoryDraftDate);
    saveBtn.disabled = !ready;
    saveBtn.classList.toggle("is-ready", ready);
  };
  bindAppCalPicker(wrap, "memory-new-date", {
    getIso: () => memoryDraftDate,
    setIso: (iso) => {
      memoryDraftDate = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : memoryDraftDate;
      syncSave();
    },
  });
  titleBox.addEventListener("input", syncSave);
  wrap.querySelector("[data-memories-done]")?.addEventListener("click", () => {
    memoriesComposing = false;
    memoryDraftDate = isoToday();
    render();
  });
  wrap.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = titleBox.value.trim();
    const story = storyBox.value.trim();
    const date = memoryDraftDate;
    if (!text || !date) return;
    const item = {
      id: uid(),
      date,
      text,
      story,
      noYear: Boolean(yearlyBox.checked),
      at: Date.now(),
    };
    memoriesComposing = false;
    memoryDraftDate = isoToday();
    setState({ dates: [item, ...state.dates] }, true);
    render();
  });
  syncSave();
  requestAnimationFrame(() => titleBox?.focus());
  return wrap;
}

function memoryEditorView(item) {
  let date = memoryIso(item) || isoToday();
  let yearly = Boolean(item.noYear);
  const kept = isKeptMemory(item.id);
  const wrap = el(`
    <div class="memories-page">
      <article class="card memories-head">
        <div class="memories-head-copy">
          <p class="memories-kicker">${kept ? "Kept memory" : "Edit memory"}</p>
          <p class="memories-lead">${escapeHtml(memoryRelLabel(item) || "Update the date, title, or story.")}</p>
        </div>
      </article>
      <form class="memories-compose is-edit card">
        <div class="memories-compose-date">
          <span class="memories-compose-label">Date</span>
          ${appCalPickerHtml("memory-edit-date", date)}
        </div>
        <label class="memories-yearly">
          <input type="checkbox" data-yearly ${yearly ? "checked" : ""} />
          <span>Repeat yearly</span>
        </label>
        <input id="memory-title" data-title type="text" maxlength="180" placeholder="Title" value="${escapeHtml(item.text || item.title || "")}" />
        <textarea id="memory-story" data-story rows="10" maxlength="8000" placeholder="Story">${escapeHtml(item.story || "")}</textarea>
      </form>
    </div>
  `);
  let wait = 0;
  const titleBox = wrap.querySelector("[data-title]");
  const storyBox = wrap.querySelector("[data-story]");
  const yearlyBox = wrap.querySelector("[data-yearly]");
  const save = () => {
    const text = titleBox.value.trim();
    const story = storyBox.value;
    if (!date || !text) return;
    setState({
      dates: state.dates.map((row) =>
        row.id === item.id
          ? { ...row, date, text, story: story.trim(), noYear: Boolean(yearlyBox.checked), at: Date.now() }
          : row
      ),
    }, true);
  };
  bindAppCalPicker(wrap, "memory-edit-date", {
    getIso: () => date,
    setIso: (iso) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      date = iso;
      save();
    },
  });
  wrap.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  wrap.querySelector("form").addEventListener("input", () => {
    window.clearTimeout(wait);
    wait = window.setTimeout(save, 400);
  });
  yearlyBox.addEventListener("change", save);
  return wrap;
}

function isoTodayFrom(ms) {
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

function isoAddDays(iso, days) {
  const stamp = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  stamp.setDate(stamp.getDate() + Number(days) || 0);
  return `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
}

function isoDiffDays(from, to) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b - a) / 86400000);
}

function eachIsoDay(from, to, visit) {
  if (!from || !to || from > to) return;
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    visit(cursor);
    cursor = isoAddDays(cursor, 1);
    guard += 1;
  }
}

function emptyCycleDraft() {
  return {
    id: "",
    start: isoToday(),
    end: "",
    ongoing: true,
    flow: "",
    symptoms: [],
    note: "",
    who: "ba",
  };
}

function draftFromPeriod(item) {
  const row = normalizeCyclePeriod(item);
  if (!row) return emptyCycleDraft();
  return {
    id: row.id,
    start: row.start,
    end: row.end,
    ongoing: !row.end,
    flow: row.flow,
    symptoms: [...row.symptoms],
    note: row.note,
    who: row.who,
  };
}

function emptyCourseDraft() {
  return {
    id: "",
    start: isoToday(),
    status: COURSE_STATUS_ON,
    intake: "",
    note: "",
  };
}

function draftFromCourse(item) {
  const row = normalizeCycleCourse(item);
  if (!row) return emptyCourseDraft();
  return {
    id: row.id,
    start: row.start,
    status: row.status || COURSE_STATUS_ON,
    intake: row.intake || "",
    note: row.intake === COURSE_INTAKE_NOT ? row.note : "",
  };
}

function withCourseGaps(courses, periods) {
  return (courses || []).map((row) => {
    const gap = courseGapDays(row, periods);
    return { ...row, gapDays: gap };
  });
}

function writeCycle(patch, silent = false) {
  const base = normalizeCycle(state.cycle);
  const merged = normalizeCycle({ ...base, ...patch, who: "ba" });
  const next = normalizeCycle({
    ...merged,
    courses: withCourseGaps(merged.courses, merged.periods),
    lastMedName: MEPRATE_NAME,
  });
  setState({ cycle: next }, silent);
}

function ensureCycle() {
  const raw = state.cycle;
  const cycle = normalizeCycle(raw);
  const whoOff = String(raw?.who || "").toLowerCase() !== "ba";
  if (!raw || !Array.isArray(raw.meds) || !Array.isArray(raw.courses) || whoOff) {
    state = { ...state, cycle };
    schedulePersist();
  }
  return cycle;
}

/** Gap(m): days from Meprate end to the immediate next period start. */
function nextPeriodAfterMedEnd(periods, medEnd) {
  if (!medEnd || !/^\d{4}-\d{2}-\d{2}$/.test(medEnd)) return null;
  return [...(periods || [])]
    .filter((row) => row?.start && /^\d{4}-\d{2}-\d{2}$/.test(row.start) && row.start > medEnd)
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

function courseGapDays(course, periods) {
  if (!course?.end) return null;
  const next = nextPeriodAfterMedEnd(periods, course.end);
  if (!next) return null;
  const gap = isoDiffDays(course.end, next.start);
  return gap >= 0 ? gap : null;
}

/** One gap row per ended Meprate course (month): med end → next period start. */
function cycleGapTableRows(cycle) {
  const periods = cycle?.periods || [];
  const ended = coursesChrono(cycle?.courses || []).filter(
    (row) => row.status === COURSE_STATUS_ENDED && row.end && /^\d{4}-\d{2}-\d{2}$/.test(row.end)
  );
  const byMonth = new Map();
  for (const row of ended) {
    const key = String(row.end || row.start || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const prev = byMonth.get(key);
    if (!prev || row.end > prev.end || (row.end === prev.end && Number(row.at || 0) >= Number(prev.at || 0))) {
      byMonth.set(key, row);
    }
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, row]) => {
      const next = nextPeriodAfterMedEnd(periods, row.end);
      const gap = courseGapDays(row, periods);
      return {
        key,
        month: monthLabelForKey(key),
        medEnd: row.end,
        periodStart: next?.start || "",
        gap,
      };
    });
}

function coursesGroupedByMonth(list) {
  const groups = [];
  const map = new Map();
  for (const row of coursesChrono(list || [])) {
    const key = String(row.start || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (!map.has(key)) {
      const rows = [];
      map.set(key, rows);
      groups.push({ key, label: monthLabelForKey(key), rows });
    }
    map.get(key).push(row);
  }
  groups.reverse();
  return groups;
}

/** Month detail: daily logs while Still on; Ended → stored month summary. */
function buildCourseMonthSummary(rows) {
  const list = coursesChrono(rows || []).filter((row) => row.intake);
  if (!list.length) return "";
  const from = list[0].start;
  const to = list[list.length - 1].start;
  const range = from === to ? `On ${fmt(from)}` : `From ${fmt(from)} to ${fmt(to)}`;
  const taken = list.filter((row) => row.intake === COURSE_INTAKE_TAKEN);
  const skipped = list.filter((row) => row.intake === COURSE_INTAKE_NOT);
  const skipBits = skipped.map((row) => {
    const why = String(row.note || "").trim();
    if (why && why !== COURSE_TAKEN_NOTE) return `${fmt(row.start)} due to ${why}`;
    return fmt(row.start);
  });
  if (taken.length && !skipped.length) return `${range} the course was taken successfully.`;
  if (!taken.length && skipped.length) {
    return `${range} the course was not taken${skipBits.length ? ` (${skipBits.join("; ")})` : ""}.`;
  }
  return `${range} the course was taken successfully, and not taken on ${skipBits.join("; ")}.`;
}

function courseMonthDetail(rows) {
  const list = coursesChrono(rows || []);
  if (!list.length) return { ended: false, items: [] };
  const endedRow =
    [...list].reverse().find((row) => row.status === COURSE_STATUS_ENDED || row.end) || null;
  if (endedRow) {
    const summary = String(endedRow.summary || "").trim() || buildCourseMonthSummary(list);
    return {
      ended: true,
      items: [
        {
          kind: "summary",
          id: endedRow.id,
          ids: list.map((row) => row.id),
          from: list[0].start,
          to: endedRow.end || endedRow.start,
          summary,
        },
      ],
    };
  }
  return {
    ended: false,
    items: list.map((row) => ({
      kind: "day",
      id: row.id,
      ids: [row.id],
      start: row.start,
      at: row.at,
      intake: row.intake,
      note: row.note,
    })),
  };
}

function cycleStats(cycle) {
  const data = normalizeCycle(cycle);
  const chronological = [...data.periods].sort((a, b) => a.start.localeCompare(b.start));
  const gaps = [];
  for (let i = 1; i < chronological.length; i += 1) {
    const span = isoDiffDays(chronological[i - 1].start, chronological[i].start);
    if (span >= 15 && span <= 60) gaps.push(span);
  }
  const bleeds = chronological
    .filter((row) => row.end && row.end >= row.start)
    .map((row) => isoDiffDays(row.start, row.end) + 1)
    .filter((span) => span >= 1 && span <= 14);
  const avgCycle = gaps.length ? Math.round(gaps.reduce((sum, n) => sum + n, 0) / gaps.length) : 0;
  const avgPeriod = bleeds.length ? Math.round(bleeds.reduce((sum, n) => sum + n, 0) / bleeds.length) : 0;
  // Prefer logged averages; Period settings are the fallback when logs are few.
  const cycleLen = avgCycle || data.cycleLen || 28;
  const periodLen = avgPeriod || data.periodLen || 5;
  const last = chronological[chronological.length - 1] || null;
  const today = isoToday();
  let nextStart = last ? isoAddDays(last.start, cycleLen) : "";
  if (nextStart) {
    let guard = 0;
    while (nextStart < today && guard < 24) {
      const windowEnd = isoAddDays(nextStart, periodLen - 1);
      if (today <= windowEnd) break;
      nextStart = isoAddDays(nextStart, cycleLen);
      guard += 1;
    }
  }
  const nextEnd = nextStart ? isoAddDays(nextStart, periodLen - 1) : "";
  let cycleDay = 0;
  if (last) {
    const since = isoDiffDays(last.start, today);
    if (since >= 0) {
      cycleDay = (since % cycleLen) + 1;
      if (nextStart && today >= nextStart) cycleDay = isoDiffDays(nextStart, today) + 1;
    }
  }
  const ovulation = nextStart ? isoAddDays(nextStart, -14) : "";
  const fertileStart = ovulation ? isoAddDays(ovulation, -5) : "";
  const fertileEnd = ovulation ? isoAddDays(ovulation, 1) : "";
  return {
    periods: data.periods,
    chronological,
    avgCycle,
    avgPeriod,
    cycleLen,
    periodLen,
    last,
    nextStart,
    nextEnd,
    cycleDay,
    ovulation,
    fertileStart,
    fertileEnd,
  };
}

function cycleDayMarks(cycle) {
  const stats = cycleStats(cycle);
  const period = new Set();
  const predicted = new Set();
  const fertile = new Set();
  stats.chronological.forEach((row) => {
    const end = row.end || isoAddDays(row.start, stats.periodLen - 1);
    eachIsoDay(row.start, end, (iso) => period.add(iso));
  });
  if (stats.last) {
    let start = stats.last.start;
    for (let i = 0; i < 8; i += 1) start = isoAddDays(start, -stats.cycleLen);
    for (let i = 0; i < 20; i += 1) {
      const next = isoAddDays(start, stats.cycleLen);
      const logged = stats.chronological.some((row) => row.start === start);
      if (!logged) {
        eachIsoDay(start, isoAddDays(start, stats.periodLen - 1), (iso) => {
          if (!period.has(iso)) predicted.add(iso);
        });
      }
      const ovu = isoAddDays(next, -14);
      eachIsoDay(isoAddDays(ovu, -5), isoAddDays(ovu, 1), (iso) => fertile.add(iso));
      start = next;
    }
  }
  return { period, predicted, fertile };
}

function cycleHistoryMeta(row, nextStart, periodLen) {
  const cycleDays = nextStart ? isoDiffDays(row.start, nextStart) : 0;
  const bleed = row.end ? isoDiffDays(row.start, row.end) + 1 : 0;
  return {
    cycleDays,
    periodDays: bleed || periodLen,
    ongoing: !row.end,
  };
}

function periodsGroupedByMonth(list) {
  const groups = [];
  const map = new Map();
  const chronological = [...(list || [])]
    .filter((row) => row?.start && /^\d{4}-\d{2}-\d{2}$/.test(row.start))
    .sort((a, b) => a.start.localeCompare(b.start));
  for (const row of chronological) {
    const key = row.start.slice(0, 7);
    if (!map.has(key)) {
      const rows = [];
      map.set(key, rows);
      groups.push({ key, label: monthLabelForKey(key), rows });
    }
    map.get(key).push(row);
  }
  groups.reverse();
  return groups;
}

function periodHistorySummaryHtml(row, nextStart, periodLen) {
  const meta = cycleHistoryMeta(row, nextStart, periodLen);
  const flowLabel = CYCLE_FLOWS.find(([id]) => id === row.flow)?.[1] || "";
  const symptoms = (row.symptoms || [])
    .map((id) => symptomLabelOf(id, ensureCycle().symptomList))
    .filter(Boolean)
    .join(" · ");
  const range = row.end
    ? row.end === row.start
      ? fmt(row.start)
      : `${fmt(row.start)} – ${fmt(row.end)}`
    : `${fmt(row.start)} – Still on`;
  const length = meta.ongoing ? "Open" : `${meta.periodDays} days`;
  const cycle = meta.cycleDays ? `${meta.cycleDays}-day cycle` : "Latest";
  const bits = [length, cycle];
  if (flowLabel) bits.push(flowLabel);
  if (symptoms) bits.push(symptoms);
  return `<article class="cycle-course${cycleEditId === row.id ? " is-on" : ""}" data-period="${escapeHtml(row.id)}">
    <p class="cycle-course-line">${escapeHtml(range)}</p>
    <p class="cycle-course-summary">${escapeHtml(bits.join(" · "))}</p>
    ${row.note ? `<p class="cycle-hist-note">${escapeHtml(row.note)}</p>` : ""}
  </article>`;
}

/** Dedicated Period History month screen (topbar back + month title). */
function cyclePeriodMonthView(group) {
  const cycle = ensureCycle();
  const stats = cycleStats(cycle);
  const chrono = stats.chronological;
  const nextStartOf = (row) => {
    const idx = chrono.findIndex((item) => item.id === row.id);
    return idx >= 0 && idx < chrono.length - 1 ? chrono[idx + 1].start : "";
  };
  const rows = [...group.rows].reverse();
  const wrap = el(`
    <div class="cycle-page cycle-course-month-page">
      <article class="card cycle-card">
        <div class="cycle-course-list">
          ${
            rows.length
              ? rows
                  .map((row) => periodHistorySummaryHtml(row, nextStartOf(row), stats.periodLen))
                  .join("")
              : `<p class="muted">No periods logged yet.</p>`
          }
        </div>
      </article>
    </div>
  `);
  const menu = storyDeleteMenu(wrap);
  const openPeriod = (id) => {
    const item = cycle.periods.find((row) => row.id === id);
    if (!item) return;
    periodHistMonth = "";
    cycleEditId = id;
    cycleDraft = draftFromPeriod(item);
    cycleSymptomsAdding = false;
    cycleSymptomsRemoving = false;
    cycleSymptomsEditing = false;
    cycleSymptomDraft = "";
    render();
    requestAnimationFrame(() =>
      document.querySelector("[data-log]")?.scrollIntoView({ block: "start" })
    );
  };
  wrap.querySelectorAll("[data-period]").forEach((card) => {
    const id = card.dataset.period;
    const item = cycle.periods.find((row) => row.id === id);
    bindHoldOpen(card, {
      menu,
      onEdit: () => openPeriod(id),
      onLastDay: item && !item.end
        ? () => {
            writeCycle({
              periods: cycle.periods.map((row) =>
                row.id === id ? { ...row, end: isoToday(), at: Date.now() } : row
              ),
            });
          }
        : null,
      onDelete: () => {
        const remaining = cycle.periods.filter((row) => row.id !== id);
        const left = periodsGroupedByMonth(remaining).some((row) => row.key === group.key);
        if (!left) periodHistMonth = "";
        if (cycleEditId === id) {
          cycleEditId = "";
          cycleDraft = emptyCycleDraft();
          cycleSymptomsAdding = false;
          cycleSymptomsRemoving = false;
          cycleSymptomsEditing = false;
          cycleSymptomDraft = "";
        }
        writeCycle({ periods: remaining });
      },
    });
  });
  return wrap;
}

/** Dedicated Meprate History month screen (topbar back + month title). */
function cycleCourseMonthView(group) {
  const cycle = ensureCycle();
  const detail = courseMonthDetail(group.rows);
  const wrap = el(`
    <div class="cycle-page cycle-course-month-page">
      <article class="card cycle-card">
        <div class="cycle-course-list">
          ${
            detail.items.length
              ? detail.items
                  .map((item) => {
                    if (item.kind === "summary") {
                      return `<article class="cycle-course${courseEditId === item.id ? " is-on" : ""}" data-course="${escapeHtml(item.id)}" data-course-ids="${escapeHtml(item.ids.join(","))}">
                        <p class="cycle-course-summary">${escapeHtml(item.summary)}</p>
                      </article>`;
                    }
                    const intakeLabel =
                      item.intake === COURSE_INTAKE_NOT
                        ? "Not taken"
                        : item.intake === COURSE_INTAKE_TAKEN
                          ? "Taken"
                          : "";
                    const time = item.at ? fmtClock(item.at) : "";
                    const showNote =
                      item.intake === COURSE_INTAKE_NOT && String(item.note || "").trim();
                    return `<article class="cycle-course${courseEditId === item.id ? " is-on" : ""}" data-course="${escapeHtml(item.id)}" data-course-ids="${escapeHtml(item.id)}">
                      <p class="cycle-course-line">${escapeHtml(fmt(item.start))}${intakeLabel ? ` · ${escapeHtml(intakeLabel)}` : ""}${time ? ` · ${escapeHtml(time)}` : ""}</p>
                      ${showNote ? `<p class="cycle-hist-note">${escapeHtml(item.note)}</p>` : ""}
                    </article>`;
                  })
                  .join("")
              : `<p class="muted">No Meprate yet.</p>`
          }
        </div>
      </article>
    </div>
  `);
  const menu = storyDeleteMenu(wrap);
  const openCourse = (id) => {
    const item = (cycle.courses || []).find((row) => row.id === id);
    if (!item) return;
    courseHistMonth = "";
    courseEditId = id;
    courseDraft = draftFromCourse(item);
    render();
    requestAnimationFrame(() =>
      document.querySelector("[data-course-log]")?.scrollIntoView({ block: "start" })
    );
  };
  wrap.querySelectorAll(".cycle-course").forEach((card) => {
    const id = card.dataset.course;
    const ids = String(card.dataset.courseIds || id)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    bindHoldOpen(card, {
      menu,
      onEdit: () => openCourse(id),
      onDelete: () => {
        const next = normalizeCycle(state.cycle);
        const drop = new Set(ids);
        const remaining = next.courses.filter((row) => !drop.has(row.id));
        const left = coursesGroupedByMonth(remaining).some((row) => row.key === group.key);
        if (!left) courseHistMonth = "";
        if (courseEditId && drop.has(courseEditId)) {
          courseEditId = "";
          courseDraft = emptyCourseDraft();
        }
        writeCycle({ courses: remaining });
      },
    });
  });
  return wrap;
}

function cycleSettingsView() {
  const cycle = ensureCycle();
  const wrap = el(`
    <div class="cycle-page cycle-settings-page">
      <article class="card cycle-card">
        <div class="cycle-set-row">
          <div class="field">
            <label for="cycle-len">Days between periods</label>
            <input id="cycle-len" type="number" inputmode="numeric" min="15" max="60" value="${escapeHtml(String(cycle.cycleLen))}" />
          </div>
          <div class="field">
            <label for="period-len">Period length</label>
            <input id="period-len" type="number" inputmode="numeric" min="1" max="14" value="${escapeHtml(String(cycle.periodLen))}" />
          </div>
        </div>
      </article>
    </div>
  `);
  const saveLens = () => {
    const nextCycle = clampCycleLen(wrap.querySelector("#cycle-len").value, cycle.cycleLen);
    const nextPeriod = clampPeriodLen(wrap.querySelector("#period-len").value, cycle.periodLen);
    if (nextCycle === cycle.cycleLen && nextPeriod === cycle.periodLen) return;
    writeCycle({ cycleLen: nextCycle, periodLen: nextPeriod });
  };
  wrap.querySelector("#cycle-len").addEventListener("change", saveLens);
  wrap.querySelector("#period-len").addEventListener("change", saveLens);
  return wrap;
}

function cycleView() {
  const cycle = ensureCycle();
  if (cycleSettingsOpen) return cycleSettingsView();
  if (periodHistMonth) {
    const group = periodsGroupedByMonth(cycle.periods || []).find((row) => row.key === periodHistMonth);
    if (group) return cyclePeriodMonthView(group);
    periodHistMonth = "";
  }
  if (courseHistMonth) {
    const group = coursesGroupedByMonth(cycle.courses || []).find((row) => row.key === courseHistMonth);
    if (group) return cycleCourseMonthView(group);
    courseHistMonth = "";
  }
  const stats = cycleStats(cycle);
  if (!cycleDraft) cycleDraft = emptyCycleDraft();
  if (!courseDraft) courseDraft = emptyCourseDraft();
  if (cycleEditId) {
    const item = cycle.periods.find((row) => row.id === cycleEditId);
    if (!item) {
      cycleEditId = "";
      cycleDraft = emptyCycleDraft();
      cycleSymptomsAdding = false;
      cycleSymptomsRemoving = false;
      cycleSymptomsEditing = false;
      cycleSymptomDraft = "";
    } else if (cycleDraft.id !== item.id) {
      cycleDraft = draftFromPeriod(item);
      cycleSymptomsAdding = false;
      cycleSymptomsRemoving = false;
      cycleSymptomsEditing = false;
      cycleSymptomDraft = "";
    }
  }
  if (courseEditId) {
    const item = (cycle.courses || []).find((row) => row.id === courseEditId);
    if (!item) {
      courseEditId = "";
      courseDraft = emptyCourseDraft();
    } else if (courseDraft.id !== item.id) {
      courseDraft = draftFromCourse(item);
    }
  }
  const today = isoToday();
  const monthKey = cycleMonth || today.slice(0, 7);
  cycleMonth = monthKey;
  const monthDate = new Date(`${monthKey}-01T12:00:00`);
  const monthLabel = Number.isNaN(monthDate.getTime())
    ? monthKey
    : monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const marks = cycleDayMarks(cycle);
  const nextLabel = stats.nextStart
    ? stats.nextStart === stats.nextEnd
      ? fmt(stats.nextStart, false)
      : `${fmt(stats.nextStart, false)} – ${fmt(stats.nextEnd, false)}`
    : "—";
  const lastLabel = stats.last ? fmt(stats.last.start, false) : "—";
  const fertileLabel = stats.fertileStart
    ? `${fmt(stats.fertileStart, false)} – ${fmt(stats.fertileEnd, false)}`
    : "—";
  const avgLabel = stats.avgCycle ? `${stats.avgCycle} days` : `${stats.cycleLen} days`;
  const periodLabel = stats.avgPeriod ? `${stats.avgPeriod} days` : `${stats.periodLen} days`;
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push({ empty: true });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
    const kind = marks.period.has(iso) ? "period" : marks.predicted.has(iso) ? "pred" : marks.fertile.has(iso) ? "fertile" : "";
    cells.push({ iso, day, kind, today: iso === today, picked: iso === cycleDraft.start, sunday: isSundayIso(iso) });
  }
  const periodMonths = periodsGroupedByMonth(cycle.periods || []);
  const periodHistoryHtml = periodMonths.length
    ? `<div class="cycle-course-history">
      <div class="cycle-course-months">
        ${periodMonths
          .map(
            (group) =>
              `<button type="button" class="cycle-course-month-btn" data-period-month="${escapeHtml(group.key)}">${escapeHtml(group.label)}</button>`
          )
          .join("")}
      </div>
    </div>`
    : `<p class="muted">No periods logged yet.</p>`;
  const courseMonths = coursesGroupedByMonth(cycle.courses || []);
  const courseHistoryHtml = courseMonths.length
    ? `<div class="cycle-course-history">
      <div class="cycle-course-months">
        ${courseMonths
          .map(
            (group) =>
              `<button type="button" class="cycle-course-month-btn" data-course-month="${escapeHtml(group.key)}">${escapeHtml(group.label)}</button>`
          )
          .join("")}
      </div>
    </div>`
    : `<p class="muted">No Meprate yet.</p>`;
  const gapRows = cycleGapTableRows(cycle);
  const gapTableHtml = gapRows.length
    ? `<div class="cycle-gap-table-wrap">
        <table class="cycle-gap-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Medicine end</th>
              <th scope="col">Period start</th>
              <th scope="col">Gap</th>
            </tr>
          </thead>
          <tbody>
            ${gapRows
              .map(
                (row) => `<tr>
              <td>${escapeHtml(row.month)}</td>
              <td>${escapeHtml(fmt(row.medEnd, false))}</td>
              <td>${row.periodStart ? escapeHtml(fmt(row.periodStart, false)) : "—"}</td>
              <td>${row.gap != null ? escapeHtml(`${row.gap} days`) : "—"}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<p class="muted">No gaps yet.</p>`;
  const wrap = el(`
    <div class="cycle-page">
      <article class="card cycle-card">
        <h3>Summary</h3>
        <dl class="cycle-facts cycle-summary">
          <div class="cycle-fact"><dt>Period start</dt><dd>${escapeHtml(lastLabel)}</dd></div>
          <div class="cycle-fact"><dt>Day</dt><dd>${stats.cycleDay ? escapeHtml(String(stats.cycleDay)) : "—"}</dd></div>
          <div class="cycle-fact"><dt>Fertile window</dt><dd>${escapeHtml(fertileLabel)}</dd></div>
          <div class="cycle-fact"><dt>Next period</dt><dd>${escapeHtml(nextLabel)}</dd></div>
          <div class="cycle-fact"><dt>Days between periods</dt><dd>${escapeHtml(avgLabel)}</dd></div>
          <div class="cycle-fact"><dt>Period length</dt><dd>${escapeHtml(periodLabel)}</dd></div>
        </dl>
      </article>
      <article class="card cycle-card cycle-cal">
        <div class="cycle-cal-head">
          <h3>${escapeHtml(monthLabel)}</h3>
        </div>
        <div class="cycle-week">${monthWeekHeaderHtml()}</div>
        <div class="cycle-grid">
          ${cells
            .map((cell) =>
              cell.empty
                ? `<span class="cycle-day is-mute"></span>`
                : `<button type="button" class="cycle-day${cell.kind ? ` is-${cell.kind}` : ""}${cell.today ? " is-today" : ""}${cell.picked ? " is-picked" : ""}${cell.sunday ? " is-sunday" : ""}" data-day="${cell.iso}">${cell.day}</button>`
            )
            .join("")}
        </div>
        <div class="cycle-legend">
          <span><i class="is-period"></i>Period</span>
          <span><i class="is-pred"></i>Predicted period</span>
          <span><i class="is-fertile"></i>Fertile</span>
          <span><i class="is-today"></i>Today</span>
        </div>
      </article>
      <article class="card cycle-card cycle-record-card" data-log>
        <h3>${cycleDraft.id ? "Edit period" : "Record period"}</h3>
        <div class="cycle-record">
          <div class="cycle-record-row">
            <span class="cycle-record-label">Period start</span>
            <div class="cycle-record-control">${appCalPickerHtml("cycle-start", cycleDraft.start || "")}</div>
          </div>
          <div class="cycle-record-row">
            <span class="cycle-record-label">End date</span>
            <div class="cycle-record-control">${appCalPickerHtml("cycle-end", cycleDraft.end || "", { clearable: true })}</div>
          </div>
          <div class="cycle-record-row">
            <span class="cycle-record-label">Menstrual flow</span>
            <div class="cycle-record-control">
              ${courseSegHtml(
                "cycle-flow",
                CYCLE_FLOWS,
                cycleDraft.flow || ""
              )}
            </div>
          </div>
          <div class="cycle-record-block cycle-symptoms-block${cycleSymptomsRemoving ? " is-removing" : ""}${cycleSymptomsEditing ? " is-editing" : ""}">
            <div class="cycle-symptoms-head">
              <span class="cycle-record-label" id="cycle-symptoms-label">Symptoms</span>
            </div>
            ${
              cycleSymptomsAdding
                ? `<form class="cycle-symptom-add" data-symptom-add-form>
              <input type="text" data-symptom-input maxlength="40" placeholder="Symptom name" value="${escapeHtml(cycleSymptomDraft)}" enterkeyhint="done" autocomplete="off" />
              <button type="submit" class="cycle-symptoms-toggle">Save</button>
              <button type="button" class="cycle-symptoms-toggle" data-symptoms-done>Done</button>
            </form>`
                : ""
            }
            <div class="cycle-checks" role="group" aria-labelledby="cycle-symptoms-label">
              ${(cycle.symptomList || [])
                .map(
                  (row) =>
                    `<label class="cycle-check${cycleSymptomsRemoving ? " is-removable" : ""}"><input type="checkbox" data-sym="${escapeHtml(row.id)}"${
                      cycleDraft.symptoms.includes(row.id) ? " checked" : ""
                    }${cycleSymptomsRemoving ? " disabled" : ""} /><span>${escapeHtml(row.label)}</span></label>`
                )
                .join("")}
              ${(cycle.symptomList || []).length ? "" : `<p class="cycle-symptoms-summary">${cycleSymptomsEditing ? "No symptoms yet — tap Add." : "No symptoms yet."}</p>`}
            </div>
            ${cycleSymptomsRemoving ? `<p class="cycle-symptoms-hint">Tap a symptom to remove it from your list.</p>` : ""}
            <div class="cycle-symptoms-foot">
              ${
                cycleSymptomsEditing
                  ? `<div class="cycle-symptoms-actions">
                <button type="button" class="cycle-symptoms-toggle" data-symptoms-add ${cycleSymptomsRemoving || cycleSymptomsAdding ? "disabled" : ""}>Add</button>
                <button type="button" class="cycle-symptoms-toggle${cycleSymptomsRemoving ? " is-on" : ""}" data-symptoms-remove ${cycleSymptomsAdding ? "disabled" : ""}>
                  Remove
                </button>
                ${cycleSymptomsAdding ? "" : `<button type="button" class="cycle-symptoms-toggle" data-symptoms-done>Done</button>`}
              </div>`
                  : `<button type="button" class="cycle-symptoms-edit" data-symptoms-edit aria-label="Edit symptoms" aria-pressed="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4.2L19.4 8.8a1.9 1.9 0 0 0 0-2.7L17.9 4.6a1.9 1.9 0 0 0-2.7 0L4 15.8V20z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m13.8 6.1 4.1 4.1"/></svg>
              </button>`
              }
            </div>
          </div>
          <div class="cycle-record-block">
            <label class="cycle-record-label" for="cycle-note">Notes</label>
            <textarea id="cycle-note" class="cycle-note" rows="3" maxlength="400" placeholder="Optional">${escapeHtml(cycleDraft.note)}</textarea>
          </div>
          <div class="cycle-record-row cycle-actions-row">
            <span class="cycle-record-label" aria-hidden="true"></span>
            <div class="cycle-record-control">
              <div class="btn-row">
                <button class="btn rose cycle-save" type="button" data-save>${cycleDraft.id ? "Update" : "Save"}</button>
                ${cycleDraft.id ? `<button class="btn ghost" type="button" data-cancel>Cancel</button>` : ""}
              </div>
            </div>
          </div>
        </div>
        <p class="err" data-cycle-err></p>
        <p class="cycle-course-form-title">History</p>
        ${periodHistoryHtml}
      </article>
      <article class="card cycle-card" data-course-log>
        <h3>Meprate</h3>
        <div class="cycle-record cycle-course-form">
          <div class="cycle-record-row">
            <span class="cycle-record-label">Date</span>
            <div class="cycle-record-control">${appCalPickerHtml("course-date", courseDraft.start || "")}</div>
          </div>
          <div class="cycle-record-row">
            <span class="cycle-record-label">Status</span>
            <div class="cycle-record-control">
              ${courseSegHtml(
                "course-status",
                [
                  [COURSE_STATUS_ON, "Still on"],
                  [COURSE_STATUS_ENDED, "Ended"],
                ],
                courseDraft.status || COURSE_STATUS_ON
              )}
            </div>
          </div>
          <div class="cycle-record-row">
            <span class="cycle-record-label">Taken</span>
            <div class="cycle-record-control">
              ${courseSegHtml(
                "course-intake",
                [
                  [COURSE_INTAKE_TAKEN, "Taken"],
                  [COURSE_INTAKE_NOT, "Not taken"],
                ],
                courseDraft.intake || ""
              )}
            </div>
          </div>
          <div class="cycle-record-block" data-course-reason ${courseDraft.intake === COURSE_INTAKE_NOT ? "" : "hidden"}>
            <label class="cycle-record-label" for="course-note">Reason</label>
            <textarea id="course-note" data-course-note class="cycle-note" rows="3" maxlength="400" placeholder="Why not taken">${escapeHtml(courseDraft.note || "")}</textarea>
          </div>
          <div class="cycle-record-row cycle-actions-row">
            <span class="cycle-record-label" aria-hidden="true"></span>
            <div class="cycle-record-control">
              <div class="btn-row">
                <button class="btn rose cycle-save" type="button" data-course-save>${courseDraft.id ? "Update" : "Save"}</button>
                ${courseDraft.id ? `<button class="btn ghost" type="button" data-course-cancel>Cancel</button>` : ""}
              </div>
            </div>
          </div>
        </div>
        <p class="err" data-course-err></p>
        <p class="cycle-course-form-title">History</p>
        ${courseHistoryHtml}
      </article>
      <article class="card cycle-card cycle-gap-card">
        <h3>Gap</h3>
        ${gapTableHtml}
      </article>
      <div class="cycle-settings-launch">
        <button class="back-ico cycle-settings-btn" type="button" data-cycle-settings aria-label="Period settings">
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
  const err = wrap.querySelector("[data-cycle-err]");
  const courseErr = wrap.querySelector("[data-course-err]");
  const readDraftDates = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleDraft.end || "")) cycleDraft.end = "";
    cycleDraft.ongoing = !cycleDraft.end;
    cycleDraft.flow = cycleFlowOf(cycleDraft.flow);
    cycleDraft.symptoms = cycleSymptomsOf(
      [...wrap.querySelectorAll("[data-sym]:checked")].map((input) => input.dataset.sym)
    );
    cycleDraft.note = wrap.querySelector("#cycle-note").value.trim();
  };
  const readCourseDraftFrom = () => {
    if (!courseDraft) return;
    const reason = wrap.querySelector("[data-course-note]");
    if (courseDraft.intake === COURSE_INTAKE_NOT && reason) {
      courseDraft.note = reason.value.trim();
    }
  };
  const syncCourseReason = () => {
    const block = wrap.querySelector("[data-course-reason]");
    if (block) block.hidden = courseDraft.intake !== COURSE_INTAKE_NOT;
    if (courseDraft.intake !== COURSE_INTAKE_NOT) courseDraft.note = "";
  };
  const goMonth = (delta) => {
    monthSlideDir = delta;
    cycleMonth = shiftMonthKey(cycleMonth, delta);
    readDraftDates();
    readCourseDraftFrom();
    render();
  };
  const cycleCal = wrap.querySelector(".cycle-cal");
  const slideDir = monthSlideDir;
  monthSlideDir = 0;
  playMonthSlide(cycleCal, slideDir);
  bindMonthSwipe(cycleCal, goMonth, (delta) => cycleMonthPeekHtml(shiftMonthKey(monthKey, delta), cycle));
  bindAppCalPicker(wrap, "cycle-start", {
    getIso: () => cycleDraft?.start || "",
    setIso: (iso) => {
      if (!cycleDraft) return;
      cycleDraft.start = iso;
      if (cycleDraft.end && cycleDraft.end < iso) cycleDraft.end = iso;
    },
  });
  bindAppCalPicker(wrap, "cycle-end", {
    getIso: () => cycleDraft?.end || "",
    setIso: (iso) => {
      if (!cycleDraft) return;
      cycleDraft.end = /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso : "";
      cycleDraft.ongoing = !cycleDraft.end;
    },
  });
  bindAppCalPicker(wrap, "course-date", {
    getIso: () => courseDraft?.start || "",
    setIso: (iso) => {
      if (!courseDraft) return;
      courseDraft.start = iso;
    },
  });
  bindCourseSeg(wrap, "cycle-flow", (value) => {
    cycleDraft.flow = cycleFlowOf(value);
  });
  bindCourseSeg(wrap, "course-status", (value) => {
    courseDraft.status = courseStatusOf(value);
  });
  bindCourseSeg(wrap, "course-intake", (value) => {
    courseDraft.intake = courseIntakeOf(value);
    syncCourseReason();
    if (courseDraft.intake === COURSE_INTAKE_NOT) {
      requestAnimationFrame(() => wrap.querySelector("[data-course-note]")?.focus());
    }
  });
  wrap.querySelectorAll("[data-day]").forEach((button) => {
    button.addEventListener("click", () => {
      readDraftDates();
      readCourseDraftFrom();
      cycleDraft.start = button.dataset.day;
      if (cycleDraft.end && cycleDraft.end < cycleDraft.start) cycleDraft.end = cycleDraft.start;
      render();
    });
  });
  wrap.querySelectorAll("[data-sym]").forEach((input) => {
    const row = input.closest(".cycle-check");
    if (cycleSymptomsRemoving) {
      row?.addEventListener("click", (event) => {
        event.preventDefault();
        const id = input.dataset.sym;
        if (!id) return;
        readDraftDates();
        readCourseDraftFrom();
        const nextList = (ensureCycle().symptomList || []).filter((item) => item.id !== id);
        cycleDraft.symptoms = cycleDraft.symptoms.filter((item) => item !== id);
        writeCycle({ symptomList: nextList }, true);
        render();
      });
      return;
    }
    input.addEventListener("change", () => {
      const id = input.dataset.sym;
      if (input.checked && !cycleDraft.symptoms.includes(id)) cycleDraft.symptoms = [...cycleDraft.symptoms, id];
      else if (!input.checked) cycleDraft.symptoms = cycleDraft.symptoms.filter((item) => item !== id);
    });
  });
  const exitCycleSymptomsModes = () => {
    cycleSymptomsAdding = false;
    cycleSymptomsRemoving = false;
    cycleSymptomsEditing = false;
    cycleSymptomDraft = "";
  };
  wrap.querySelector("[data-symptoms-edit]")?.addEventListener("click", () => {
    readDraftDates();
    readCourseDraftFrom();
    cycleSymptomsEditing = true;
    cycleSymptomsAdding = false;
    cycleSymptomsRemoving = false;
    cycleSymptomDraft = "";
    render();
  });
  wrap.querySelectorAll("[data-symptoms-done]").forEach((button) => {
    button.addEventListener("click", () => {
      readDraftDates();
      readCourseDraftFrom();
      exitCycleSymptomsModes();
      render();
    });
  });
  wrap.querySelector("[data-symptoms-add]")?.addEventListener("click", () => {
    readDraftDates();
    readCourseDraftFrom();
    cycleSymptomsRemoving = false;
    cycleSymptomsEditing = true;
    cycleSymptomsAdding = true;
    cycleSymptomDraft = "";
    render();
  });
  wrap.querySelector("[data-symptoms-remove]")?.addEventListener("click", () => {
    readDraftDates();
    readCourseDraftFrom();
    cycleSymptomsEditing = true;
    cycleSymptomsAdding = false;
    cycleSymptomDraft = "";
    cycleSymptomsRemoving = !cycleSymptomsRemoving;
    render();
  });
  wrap.querySelector("[data-symptom-add-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    readDraftDates();
    readCourseDraftFrom();
    const input = wrap.querySelector("[data-symptom-input]");
    const label = String(input?.value || cycleSymptomDraft || "").trim().slice(0, 40);
    if (!label) {
      if (err) err.textContent = "Enter a symptom name.";
      return;
    }
    const id = symptomIdFromLabel(label);
    const latest = ensureCycle();
    if ((latest.symptomList || []).some((row) => row.id === id || row.label.toLowerCase() === label.toLowerCase())) {
      if (err) err.textContent = "That symptom is already in your list.";
      return;
    }
    if ((latest.symptomList || []).length >= 40) {
      if (err) err.textContent = "Symptom list is full.";
      return;
    }
    cycleSymptomsAdding = false;
    cycleSymptomDraft = "";
    cycleSymptomsEditing = true;
    writeCycle({ symptomList: [...(latest.symptomList || []), { id, label }] }, true);
    render();
  });
  wrap.querySelector("[data-symptom-input]")?.addEventListener("input", (event) => {
    cycleSymptomDraft = String(event.target.value || "").slice(0, 40);
  });
  wrap.querySelector("[data-save]").addEventListener("click", () => {
    readDraftDates();
    const start = cycleDraft.start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      if (err) err.textContent = "Choose a period start date.";
      return;
    }
    const end = /^\d{4}-\d{2}-\d{2}$/.test(cycleDraft.end || "") ? cycleDraft.end : "";
    if (end && end < start) {
      if (err) err.textContent = "End date cannot be before period start.";
      return;
    }
    const row = {
      id: cycleDraft.id || uid(),
      start,
      end,
      flow: cycleFlowOf(cycleDraft.flow),
      symptoms: cycleSymptomsOf(cycleDraft.symptoms),
      note: cycleDraft.note,
      at: Date.now(),
      who: "ba",
    };
    const latest = normalizeCycle(state.cycle);
    const others = latest.periods.filter((item) => item.id !== row.id);
    const wasEdit = Boolean(cycleDraft.id);
    cycleEditId = "";
    cycleSymptomsAdding = false;
    cycleSymptomsRemoving = false;
    cycleSymptomsEditing = false;
    cycleSymptomDraft = "";
    cycleDraft = emptyCycleDraft();
    writeCycle({ who: "ba", periods: [row, ...others] });
    showAppToast(wasEdit ? "Period updated" : "Period saved");
  });
  wrap.querySelector("[data-cancel]")?.addEventListener("click", () => {
    cycleEditId = "";
    cycleSymptomsAdding = false;
    cycleSymptomsRemoving = false;
    cycleSymptomsEditing = false;
    cycleSymptomDraft = "";
    cycleDraft = emptyCycleDraft();
    render();
  });
  const menu = storyDeleteMenu(wrap);
  wrap.querySelectorAll("[data-period-month]").forEach((button) => {
    button.addEventListener("click", () => {
      readDraftDates();
      readCourseDraftFrom();
      captureCycleScroll();
      periodHistMonth = button.dataset.periodMonth || "";
      render();
    });
  });
  wrap.querySelector("[data-course-save]").addEventListener("click", () => {
    readCourseDraftFrom();
    const start = courseDraft.start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      if (courseErr) courseErr.textContent = "Choose a date.";
      return;
    }
    const status = courseStatusOf(courseDraft.status);
    const intake = courseIntakeOf(courseDraft.intake);
    if (!intake) {
      if (courseErr) courseErr.textContent = "Choose Taken or Not taken.";
      return;
    }
    if (intake === COURSE_INTAKE_NOT && !String(courseDraft.note || "").trim()) {
      if (courseErr) courseErr.textContent = "Add a reason.";
      return;
    }
    const note = intake === COURSE_INTAKE_TAKEN ? COURSE_TAKEN_NOTE : String(courseDraft.note || "").trim().slice(0, 400);
    const next = normalizeCycle(state.cycle);
    const sameDay = (next.courses || []).find(
      (item) => item.start === start && item.id !== courseDraft.id
    );
    const editId = courseDraft.id || sameDay?.id || "";
    const monthKeyForCourse = start.slice(0, 7);
    if (!editId && (next.courses || []).length >= 80) {
      if (courseErr) courseErr.textContent = "Too many entries.";
      return;
    }
    const row = {
      id: editId || uid(),
      name: MEPRATE_NAME,
      start,
      end: status === COURSE_STATUS_ENDED ? start : "",
      status,
      intake,
      note,
      summary: "",
      at: Date.now(),
      gapDays: null,
    };
    let list = (next.courses || []).filter((item) => item.id !== row.id);
    list = [row, ...list];
    if (status === COURSE_STATUS_ENDED) {
      list = list.map((item) => {
        if (item.id === row.id) return item;
        if (String(item.start || "").slice(0, 7) !== monthKeyForCourse) return item;
        if (item.status !== COURSE_STATUS_ENDED && !item.end && !item.summary) return item;
        return { ...item, end: "", status: COURSE_STATUS_ON, summary: "", gapDays: null };
      });
      const monthRows = list.filter((item) => String(item.start || "").slice(0, 7) === monthKeyForCourse);
      const summary = buildCourseMonthSummary(monthRows);
      const gap = courseGapDays({ ...row, end: start }, next.periods);
      list = list.map((item) =>
        item.id === row.id
          ? { ...item, summary, end: start, status: COURSE_STATUS_ENDED, gapDays: gap }
          : item
      );
    } else {
      list = list.map((item) =>
        item.id === row.id
          ? { ...item, summary: "", end: "", status: COURSE_STATUS_ON, gapDays: null }
          : item
      );
    }
    const wasEdit = Boolean(editId);
    courseEditId = "";
    courseDraft = emptyCourseDraft();
    writeCycle({
      courses: list,
      lastMedName: MEPRATE_NAME,
    });
    showAppToast(wasEdit ? "Meprate updated" : "Meprate saved");
  });
  wrap.querySelector("[data-course-cancel]")?.addEventListener("click", () => {
    courseEditId = "";
    courseDraft = emptyCourseDraft();
    render();
  });
  const openCourse = (id) => {
    const item = (cycle.courses || []).find((row) => row.id === id);
    if (!item) return;
    readDraftDates();
    courseEditId = id;
    courseDraft = draftFromCourse(item);
    render();
    requestAnimationFrame(() => document.querySelector("[data-course-log]")?.scrollIntoView({ block: "start" }));
  };
  wrap.querySelectorAll("[data-course-month]").forEach((button) => {
    button.addEventListener("click", () => {
      readDraftDates();
      readCourseDraftFrom();
      captureCycleScroll();
      courseHistMonth = button.dataset.courseMonth || "";
      render();
    });
  });
  wrap.querySelectorAll(".cycle-course").forEach((card) => {
    const id = card.dataset.course;
    const ids = String(card.dataset.courseIds || id)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    bindHoldOpen(card, {
      menu,
      onEdit: () => openCourse(id),
      onDelete: () => {
        const next = normalizeCycle(state.cycle);
        const drop = new Set(ids);
        writeCycle({ courses: next.courses.filter((row) => !drop.has(row.id)) });
        if (courseEditId && drop.has(courseEditId)) {
          courseEditId = "";
          courseDraft = emptyCourseDraft();
        }
      },
    });
  });
  wrap.querySelector("[data-cycle-settings]")?.addEventListener("click", () => {
    readDraftDates();
    readCourseDraftFrom();
    captureCycleScroll();
    cycleSettingsOpen = true;
    render();
  });
  if (cycleSymptomsAdding) {
    requestAnimationFrame(() => wrap.querySelector("[data-symptom-input]")?.focus());
  }
  return wrap;
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
  tab = "settings";
  return settingsView();
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
  const menu = storyDeleteMenu(wrap);
  wrap.querySelectorAll("[data-tree-id]").forEach((card) => {
    let wait = 0;
    card.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        window.clearTimeout(wait);
        wait = window.setTimeout(() => saveCard(card), 350);
      });
    });
    if (card.dataset.locked === "1") return;
    bindHoldOpen(card, {
      menu,
      onDelete: () => {
        const id = card.dataset.treeId;
        setState({
          familyTree: {
            mandi: removePerson(state.familyTree.mandi, id),
            tudu: removePerson(state.familyTree.tudu, id),
            union: removePerson(state.familyTree.union, id),
          },
        });
      },
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
  const pri = String(item?.pri || "").toLowerCase();
  if (pri === "near" || pri === "high" || pri === "1") return "near";
  if (pri === "soon") return "soon";
  return "later";
}

function todoTimeOf(item) {
  const named = String(item?.time || "").slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(named)) return named;
  const due = String(item?.due || "");
  const stamp = due.match(/T(\d{2}:\d{2})/);
  return stamp ? stamp[1] : "";
}

function todoDayOf(item) {
  return String(item?.due || "").slice(0, 10);
}

function todoDueMs(item) {
  const day = todoDayOf(item);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  const time = todoTimeOf(item);
  const stamp = new Date(`${day}T${time || "23:59"}:00`);
  return Number.isNaN(stamp.getTime()) ? 0 : stamp.getTime();
}

function todoDueLabel(item) {
  const day = todoDayOf(item);
  if (!day) return "";
  const today = isoToday();
  const stamp = new Date(`${day}T12:00:00`);
  if (Number.isNaN(stamp.getTime())) return "";
  const dateText = day === today ? "Today" : stamp.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = todoTimeOf(item);
  if (!time) return dateText;
  const clock = new Date(`${day}T${time}:00`);
  if (Number.isNaN(clock.getTime())) return dateText;
  return `${dateText} · ${clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function todoOverdue(item) {
  if (item?.done) return false;
  const at = todoDueMs(item);
  if (!at) return false;
  if (todoTimeOf(item)) return at < Date.now();
  return todoDayOf(item) < isoToday();
}

function todoPriLabel(pri) {
  if (pri === "near") return "Near";
  if (pri === "soon") return "Soon";
  return "Later";
}

function sortTodos(list) {
  const rank = { near: 0, soon: 1, later: 2 };
  return [...list].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    const pa = rank[todoPriOf(a)] ?? 2;
    const pb = rank[todoPriOf(b)] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = todoDueMs(a) || Number.MAX_SAFE_INTEGER;
    const db = todoDueMs(b) || Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return Number(b.at || 0) - Number(a.at || 0);
  });
}

function todoView() {
  const all = Array.isArray(state.todos) ? state.todos : [];
  const shown = sortTodos(all).filter((item) => {
    if (todoFilter === "active") return !item.done;
    if (todoFilter === "done") return item.done;
    return true;
  });
  const dueChip = todoDueLabel({ due: todoDraftDue, time: todoDraftTime });
  const wrap = el(`
    <div class="todo-page">
      <article class="card todo-card todo-tasks">
        <div class="todo-bar">
          <div class="todo-filters" role="tablist" aria-label="Task filter">
            <button type="button" role="tab" data-filter="active" class="${todoFilter === "active" ? "is-on" : ""}" aria-selected="${todoFilter === "active"}">Active</button>
            <button type="button" role="tab" data-filter="done" class="${todoFilter === "done" ? "is-on" : ""}" aria-selected="${todoFilter === "done"}">Done</button>
            <button type="button" role="tab" data-filter="all" class="${todoFilter === "all" ? "is-on" : ""}" aria-selected="${todoFilter === "all"}">All</button>
          </div>
        </div>
        <div class="todo-list" data-list ${shown.length ? "" : "hidden"}></div>
        ${shown.length ? "" : `<p class="todo-empty">${all.length ? "Nothing in this list." : "No tasks yet."}</p>`}
      </article>
      ${
        todosComposing
          ? `<form class="todo-compose card${todoWhenOpen ? " is-when" : ""}">
        <div class="todo-add-row">
          <input data-new maxlength="200" placeholder="Add a task" autocomplete="off" />
        </div>
        <div class="todo-add-actions">
          <button type="button" data-toggle-when class="${todoWhenOpen || dueChip ? "is-on" : ""}" aria-label="Date and time" aria-pressed="${todoWhenOpen}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
              <path d="M4 9h16M8 3.2v3.6M16 3.2v3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
          <div class="todo-who" role="group" aria-label="For">
            <button type="button" data-who="us" class="${todoDraftWho === "us" ? "is-on" : ""}">Us</button>
            <button type="button" data-who="ba" class="${todoDraftWho === "ba" ? "is-on" : ""}">Ba</button>
            <button type="button" data-who="ma" class="${todoDraftWho === "ma" ? "is-on" : ""}">Ma</button>
          </div>
          <div class="todo-pri" role="group" aria-label="Priority">
            <button type="button" data-pri="near" class="todo-pri-dot is-near${todoDraftPri === "near" ? " is-on" : ""}" aria-label="Near" title="Near"></button>
            <button type="button" data-pri="soon" class="todo-pri-dot is-soon${todoDraftPri === "soon" ? " is-on" : ""}" aria-label="Soon" title="Soon"></button>
            <button type="button" data-pri="later" class="todo-pri-dot is-later${todoDraftPri === "later" ? " is-on" : ""}" aria-label="Later" title="Later"></button>
          </div>
        </div>
        <div class="todo-when" ${todoWhenOpen ? "" : "hidden"}>
          <div class="todo-when-date">
            <span class="todo-when-label">Date</span>
            ${appCalPickerHtml("todo-due", todoDraftDue || "", { clearable: true, minIso: isoToday() })}
          </div>
          ${timePickerHtml("todo-time", todoDraftTime)}
        </div>
        <div class="todo-chip" data-due-chip ${dueChip ? "" : "hidden"}>
          <span data-due-text>${escapeHtml(dueChip)}</span>
          <button type="button" data-clear-when>Clear</button>
        </div>
        <button type="submit" class="compose-done-btn" data-todo-save>Save</button>
      </form>`
          : `<div class="todo-add-wrap">
        <button type="button" class="todo-add-btn" data-todo-add aria-label="Add task">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>`
      }
    </div>
  `);
  const list = wrap.querySelector("[data-list]");
  const menu = storyDeleteMenu(wrap);
  const addRow = (item) => {
    const who = todoWhoOf(item);
    const pri = todoPriOf(item);
    const dueText = todoDueLabel(item);
    const overdue = todoOverdue(item);
    const whoLabel = who === "ba" ? "Ba" : who === "ma" ? "Ma" : "Us";
    const row = el(`
      <article class="todo-item ${item.done ? "is-done" : ""} is-${pri} ${overdue ? "is-late" : ""}" data-id="${escapeHtml(item.id)}">
        <button type="button" data-done aria-label="${item.done ? "Not done" : "Done"}"></button>
        <div class="todo-body">
          <input data-text value="${escapeHtml(item.text || "")}" />
          ${dueText || who !== "us" ? `<p class="todo-meta">
            ${dueText ? `<span class="todo-due${overdue ? " is-late" : ""}">${overdue ? "Overdue · " : ""}${escapeHtml(dueText)}</span>` : ""}
            ${who !== "us" ? `<span class="todo-owner">${whoLabel}</span>` : ""}
          </p>` : ""}
        </div>
        <span class="todo-flag" title="${todoPriLabel(pri)}" aria-hidden="true"></span>
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
    bindHoldOpen(row, {
      menu,
      onDelete: () => {
        setState({ todos: (state.todos || []).filter((todo) => todo.id !== item.id) });
      },
    });
    return row;
  };
  shown.forEach((item) => list.append(addRow(item)));
  wrap.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      todoFilter = button.dataset.filter;
      render();
    });
  });
  if (!todosComposing) {
    wrap.querySelector("[data-todo-add]")?.addEventListener("click", () => {
      todosComposing = true;
      todoWhenOpen = false;
      render();
    });
    return wrap;
  }
  const composer = wrap.querySelector("[data-new]");
  const form = wrap.querySelector("form");
  const whenBox = wrap.querySelector(".todo-when");
  const chip = wrap.querySelector("[data-due-chip]");
  const chipText = wrap.querySelector("[data-due-text]");
  const whenToggle = wrap.querySelector("[data-toggle-when]");
  const paintWhen = () => {
    todoDraftTime = readTimePicker(wrap, "todo-time");
    const label = todoDueLabel({ due: todoDraftDue, time: todoDraftTime });
    if (chipText) chipText.textContent = label;
    if (chip) chip.hidden = !label;
    whenToggle?.classList.toggle("is-on", todoWhenOpen || Boolean(label));
  };
  const closeCompose = () => {
    todosComposing = false;
    todoWhenOpen = false;
    todoDraftDue = "";
    todoDraftTime = "";
    render();
  };
  const addItem = () => {
    const text = composer.value.trim();
    todoDraftTime = readTimePicker(wrap, "todo-time");
    if (todoDraftTime && !todoDraftDue) todoDraftDue = isoToday();
    if (!text) {
      closeCompose();
      return;
    }
    const item = {
      id: uid(),
      text,
      done: false,
      from: currentName(),
      at: Date.now(),
      who: todoDraftWho,
      pri: todoDraftPri,
      due: todoDraftDue,
      time: todoDraftTime,
    };
    todoDraftDue = "";
    todoDraftTime = "";
    todoWhenOpen = false;
    todosComposing = false;
    setState({ todos: [item, ...(state.todos || [])] });
  };
  bindAppCalPicker(wrap, "todo-due", {
    getIso: () => todoDraftDue || "",
    setIso: (iso) => {
      todoDraftDue = /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso : "";
      paintWhen();
    },
  });
  wrap.querySelectorAll("[data-who]").forEach((button) => {
    button.addEventListener("click", () => {
      todoDraftWho = button.dataset.who === "ba" || button.dataset.who === "ma" ? button.dataset.who : "us";
      wrap.querySelectorAll("[data-who]").forEach((item) => item.classList.toggle("is-on", item === button));
    });
  });
  wrap.querySelectorAll("[data-pri]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.pri;
      todoDraftPri = next === "near" || next === "soon" ? next : "later";
      wrap.querySelectorAll("[data-pri]").forEach((item) => item.classList.toggle("is-on", item === button));
    });
  });
  whenToggle.addEventListener("click", () => {
    todoWhenOpen = !todoWhenOpen;
    form.classList.toggle("is-when", todoWhenOpen);
    whenBox.hidden = !todoWhenOpen;
    whenToggle.setAttribute("aria-pressed", String(todoWhenOpen));
    paintWhen();
  });
  wrap.querySelector("[data-clear-when]")?.addEventListener("click", () => {
    todoDraftDue = "";
    todoDraftTime = "";
    wrap.querySelectorAll("[data-time-name='todo-time'] select").forEach((sel) => {
      sel.value = "";
    });
    const cal = wrap.querySelector('[data-cal-name="todo-due"]');
    if (cal) {
      cal.dataset.calIso = "";
      const trigger = cal.querySelector("[data-cal-open]");
      if (trigger && !trigger.classList.contains("is-icon")) trigger.textContent = "Pick a date";
      const clearBtn = cal.querySelector("[data-cal-clear]");
      if (clearBtn) clearBtn.hidden = true;
    }
    paintWhen();
  });
  wrap.querySelectorAll(".todo-when [data-time-name] select").forEach((sel) => {
    sel.addEventListener("change", paintWhen);
  });
  composer.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addItem();
  });
  paintWhen();
  requestAnimationFrame(() => composer?.focus());
  return wrap;
}

function dailyView() {
  const daily = ensureDaily();
  const today = isoToday();
  const rawView = /^\d{4}-\d{2}-\d{2}$/.test(dailyViewDay) ? dailyViewDay : today;
  const viewDay = clampDailyIso(rawView, today);
  dailyViewDay = viewDay;
  const ticks = daily.days[viewDay] || {};
  const habits = daily.habits;
  const total = habits.length;
  const baDone = dailyCountFor(habits, ticks, "ba");
  const maDone = dailyCountFor(habits, ticks, "ma");
  const viewStamp = new Date(`${viewDay}T12:00:00`);
  const weekdayLabel = viewStamp.toLocaleDateString(undefined, { weekday: "long" });
  const dateShort = viewStamp.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const baStreak = dailyStreakFor(daily, "ba");
  const maStreak = dailyStreakFor(daily, "ma");
  const streakBits = [];
  if (viewDay === today) {
    if (baStreak >= 2) streakBits.push(`Ba ${baStreak} days`);
    if (maStreak >= 2) streakBits.push(`Ma ${maStreak} days`);
  }
  const extra = streakBits.join(" · ");
  const strip = dailyMonthStripDays(viewDay, today);
  const viewIsSunday = isSundayIso(viewDay);
  const groups = DAILY_SLOTS.map(([id, label]) => [id, label, habits.filter((habit) => habit.slot === id)]).filter(
    ([, , rows]) => rows.length
  );
  const graphRange = dailyGraphRangeOf(dailyGraphRange);
  dailyGraphRange = graphRange;
  const graphPoints = dailyGraphPoints(daily, graphRange, today);
  const graphBaAvg = dailyGraphAvg(graphPoints, "ba");
  const graphMaAvg = dailyGraphAvg(graphPoints, "ma");
  const wrap = el(`
    <div class="daily-page${dailyEditing ? " is-editing" : ""}">
      <article class="card daily-card daily-overview">
        <div class="daily-head">
          <div class="daily-head-copy">
            <p class="daily-date">
              <span class="daily-weekday${viewIsSunday ? " is-sunday" : ""}">${escapeHtml(weekdayLabel)}</span>
              <strong class="daily-daynum${viewIsSunday ? " is-sunday" : ""}">${escapeHtml(dateShort)}</strong>
            </p>
            ${
              total
                ? `<div class="daily-stats" aria-label="Progress">
              <div class="daily-stat is-ba"><span>Ba</span><strong>${baDone}/${total}</strong></div>
              <div class="daily-stat is-ma"><span>Ma</span><strong>${maDone}/${total}</strong></div>
            </div>`
                : ""
            }
            ${extra ? `<p class="daily-extra">${escapeHtml(extra)}</p>` : ""}
          </div>
        </div>
        <div class="daily-strip-row">
          <div class="daily-strip-wrap">
            <div class="daily-strip" role="tablist" aria-label="Days this month">
              ${strip
                .map((day) => {
                  const stamp = new Date(`${day}T12:00:00`);
                  const wd = stamp.toLocaleDateString(undefined, { weekday: "short" });
                  const num = String(stamp.getDate());
                  const sunday = isSundayIso(day);
                  return `<button type="button" role="tab" data-day="${day}" class="${day === viewDay ? "is-on" : ""}${day === today ? " is-today" : ""}${sunday ? " is-sunday" : ""}" aria-selected="${day === viewDay}" aria-label="${escapeHtml(stamp.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}">
                  <em>${escapeHtml(wd)}</em>
                  <strong>${escapeHtml(num)}</strong>
                </button>`;
                })
                .join("")}
            </div>
          </div>
          <div class="daily-jump">${appCalPickerHtml("daily-jump", viewDay, { icon: true, maxIso: today })}</div>
        </div>
      </article>
      ${
        dailyEditing
          ? ""
          : `<article class="card daily-card daily-graph">
        <div class="daily-graph-head">
          <div>
            <h3 class="daily-graph-title">Completion</h3>
            <p class="daily-graph-from">From 13 Sep 2026</p>
          </div>
          <p class="daily-graph-avg" aria-label="Average completion">
            <span class="is-ba">Ba ${graphBaAvg}%</span>
            <span class="is-ma">Ma ${graphMaAvg}%</span>
          </p>
        </div>
        <div class="daily-graph-ranges" role="tablist" aria-label="Graph range">
          ${DAILY_GRAPH_RANGES.map(
            ([id, label]) =>
              `<button type="button" role="tab" data-graph-range="${id}" class="${graphRange === id ? "is-on" : ""}" aria-selected="${graphRange === id}">${label}</button>`
          ).join("")}
        </div>
        ${dailyGraphSvg(graphPoints)}
        <div class="daily-graph-legend" aria-hidden="true">
          <span class="is-ba">Ba</span>
          <span class="is-ma">Ma</span>
        </div>
      </article>`
      }
      <article class="card daily-card daily-tasks">
        <div class="daily-table-wrap">
          ${
            groups.length
              ? groups
                  .map(
                    ([slot, label, rows]) => `
            <section class="daily-block" data-slot-group="${slot}">
              <h3 class="daily-block-title">${escapeHtml(label)}</h3>
              <table class="daily-table">
                <thead>
                  <tr>
                    <th scope="col" class="daily-task-head">Task</th>
                    <th scope="col" class="is-ba">Ba</th>
                    <th scope="col" class="is-ma">Ma</th>
                  </tr>
                </thead>
                <tbody class="daily-group">
                  ${rows
                    .map((habit) => {
                      const done = dailyTickOf(ticks[habit.id]);
                      const both = done.ba && done.ma;
                      return `<tr class="daily-item${both ? " is-both" : ""}" data-id="${escapeHtml(habit.id)}">
                    <td class="daily-task-cell">
                      <div class="daily-body">
                        ${
                          dailyEditing
                            ? `<button type="button" class="daily-drag" data-drag aria-label="Reorder ${escapeHtml(habit.label)}">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM8 13.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM8 20a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>
                        </button>
                        <div class="daily-edit-copy">
                          <input data-label maxlength="40" value="${escapeHtml(habit.label)}" aria-label="Task name" />
                          <button type="button" data-slot class="daily-slot">${escapeHtml(dailySlotLabel(habit.slot))}</button>
                        </div>`
                            : `<p class="daily-label">${escapeHtml(habit.label)}</p>`
                        }
                      </div>
                    </td>
                    <td class="daily-tick-cell">
                      <button type="button" data-tick="ba" class="is-ba${done.ba ? " is-on" : ""}" aria-label="Ba, ${escapeHtml(habit.label)}${done.ba ? ", done" : ""}"></button>
                    </td>
                    <td class="daily-tick-cell">
                      <button type="button" data-tick="ma" class="is-ma${done.ma ? " is-on" : ""}" aria-label="Ma, ${escapeHtml(habit.label)}${done.ma ? ", done" : ""}"></button>
                    </td>
                  </tr>`;
                    })
                    .join("")}
                </tbody>
              </table>
            </section>`
                  )
                  .join("")
              : `<p class="daily-empty">No daily tasks yet.</p>`
          }
        </div>
      </article>
      <div class="daily-bottom">
        ${
          dailyEditing
            ? `<form class="daily-compose card">
          <div class="daily-add-row">
            <input data-new maxlength="40" placeholder="Add a daily task" autocomplete="off" />
            <button class="todo-save" type="submit" aria-label="Add daily task">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.2 16.6 4.8 12.2l1.4-1.4 3 3 8.6-8.6 1.4 1.4z"/></svg>
            </button>
          </div>
          <div class="daily-add-slots" role="group" aria-label="Time of day">
            ${DAILY_SLOTS.map(
              ([id, label]) =>
                `<button type="button" data-new-slot="${id}" class="${dailyDraftSlot === id ? "is-on" : ""}">${label}</button>`
            ).join("")}
          </div>
        </form>`
            : ""
        }
        <button class="daily-edit" type="button" data-daily-edit aria-pressed="${dailyEditing}">${dailyEditing ? "Done" : "Edit"}</button>
      </div>
    </div>
  `);
  wrap.querySelector("[data-daily-edit]").addEventListener("click", () => {
    dailyEditing = !dailyEditing;
    render();
  });
  wrap.querySelectorAll("[data-graph-range]").forEach((button) => {
    button.addEventListener("click", () => {
      dailyGraphRange = dailyGraphRangeOf(button.dataset.graphRange);
      render();
    });
  });
  wrap.querySelectorAll(".daily-strip [data-day]").forEach((button) => {
    button.addEventListener("click", () => {
      const scroller = wrap.querySelector(".daily-strip-wrap");
      if (scroller?.dataset.dragged === "1") return;
      const next = button.dataset.day;
      if (!next || next === dailyViewDay) return;
      dailyViewDay = next;
      dailyStripScrollLeft = null;
      dailyStripRecenter = true;
      render();
    });
  });
  const shouldRecenter = dailyStripRecenter;
  dailyStripRecenter = false;
  bindDailyStrip(wrap.querySelector(".daily-strip-wrap"), viewDay, { recenter: shouldRecenter });
  bindAppCalPicker(wrap, "daily-jump", {
    getIso: () => dailyViewDay || viewDay,
    setIso: (iso) => {
      const next = clampDailyIso(iso, today);
      if (!next || next === dailyViewDay) return;
      dailyViewDay = next;
      dailyStripScrollLeft = null;
      dailyStripRecenter = true;
      render();
    },
  });
  const menu = dailyEditing ? storyDeleteMenu(wrap) : null;
  wrap.querySelectorAll(".daily-item").forEach((row) => {
    const id = row.dataset.id;
    row.querySelectorAll("[data-tick]").forEach((button) => {
      button.addEventListener("click", () => {
        const who = button.dataset.tick === "ma" ? "ma" : "ba";
        const nextDaily = normalizeDaily(state.daily);
        const dayTicks = { ...(nextDaily.days[viewDay] || {}) };
        const cur = dailyTickOf(dayTicks[id]);
        dayTicks[id] = { ...cur, [who]: !cur[who] };
        writeDaily({ days: { ...nextDaily.days, [viewDay]: dayTicks } });
      });
    });
    if (!dailyEditing) return;
    const labelInput = row.querySelector("[data-label]");
    let wait = 0;
    labelInput.addEventListener("input", (event) => {
      window.clearTimeout(wait);
      wait = window.setTimeout(() => {
        const label = event.target.value.trim();
        if (!label) return;
        writeDaily(
          {
            habits: (normalizeDaily(state.daily).habits || []).map((habit) =>
              habit.id === id ? { ...habit, label } : habit
            ),
          },
          true
        );
      }, 350);
    });
    row.querySelector("[data-slot]").addEventListener("click", () => {
      const order = DAILY_SLOTS.map(([slot]) => slot);
      const cur = dailySlotOf((normalizeDaily(state.daily).habits.find((habit) => habit.id === id) || {}).slot);
      const next = order[(order.indexOf(cur) + 1) % order.length];
      writeDaily({
        habits: (normalizeDaily(state.daily).habits || []).map((habit) => (habit.id === id ? { ...habit, slot: next } : habit)),
      });
    });
    bindHoldOpen(row, {
      menu,
      onDelete: () => {
        writeDaily({ habits: (normalizeDaily(state.daily).habits || []).filter((habit) => habit.id !== id) });
      },
    });
  });
  if (dailyEditing) {
    wrap.querySelectorAll(".daily-group").forEach((tbody) => bindDailyHabitReorder(tbody));
  }
  const composer = wrap.querySelector("[data-new]");
  const saveBtn = wrap.querySelector(".todo-save");
  if (composer && saveBtn) {
    wrap.querySelectorAll("[data-new-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        dailyDraftSlot = dailySlotOf(button.dataset.newSlot);
        wrap.querySelectorAll("[data-new-slot]").forEach((item) => item.classList.toggle("is-on", item === button));
      });
    });
    const addHabit = () => {
      const label = composer.value.trim();
      if (!label) return;
      const next = normalizeDaily(state.daily);
      if (next.habits.length >= DAILY_HABIT_LIMIT) return;
      composer.value = "";
      writeDaily({
        habits: [...next.habits, { id: uid(), label, slot: dailySlotOf(dailyDraftSlot) }],
      });
    };
    const paintSave = () => {
      saveBtn.classList.toggle("is-ready", Boolean(composer.value.trim()));
    };
    composer.addEventListener("input", paintSave);
    composer.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addHabit();
      }
    });
    wrap.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      addHabit();
    });
    paintSave();
  }
  return wrap;
}

const PRIVACY_URL = "https://sonatudu.github.io/ba/privacy.html";

function settingsView() {
  const theme = readTheme();
  const sharing = sharingLoc();
  let startDraft = state.startedOn || "";
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
      <div class="settings-start">
        <span class="settings-start-label">Start date</span>
        <div class="settings-start-control">${appCalPickerHtml("started-on", startDraft)}</div>
      </div>
      <button type="button" class="settings-row" data-share-loc aria-pressed="${sharing}">
        <span>Share location</span>
        <i class="switch ${sharing ? "is-on" : ""}" aria-hidden="true"></i>
      </button>
      <p class="settings-note">Location is optional. Used only for Where when sharing is on.</p>
      <button type="button" class="settings-row" data-push aria-pressed="${pushWanted()}">
        <span>Notifications</span>
        <i class="switch ${pushWanted() ? "is-on" : ""}" aria-hidden="true"></i>
      </button>
      <p class="settings-note">Chat and calls show a banner. Poke only vibrates.</p>
      <a class="settings-link" href="${PRIVACY_URL}" target="_blank" rel="noopener noreferrer">Privacy policy</a>
      <button class="settings-out" type="button" data-out>Log out</button>
      <button class="settings-danger" type="button" data-delete-account>Delete account</button>
      <p class="err" data-settings-err hidden></p>
    </div>
  `);
  const err = wrap.querySelector("[data-settings-err]");
  bindAppCalPicker(wrap, "started-on", {
    getIso: () => startDraft,
    setIso: (iso) => {
      startDraft = iso;
      if (iso && iso !== state.startedOn) setState({ startedOn: iso });
    },
  });
  wrap.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(button.dataset.theme);
      render();
    });
  });
  wrap.querySelector("[data-share-loc]").addEventListener("click", () => toggleShareLocation());
  wrap.querySelector("[data-push]").addEventListener("click", () => togglePush());
  wrap.querySelector("[data-out]").addEventListener("click", () => logout());
  wrap.querySelector("[data-delete-account]").addEventListener("click", async () => {
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    const code = window.prompt("Enter your room code to delete this account.");
    if (code == null) return;
    const cleaned = String(code).replace(/\D/g, "");
    if (!cleaned) {
      if (err) {
        err.hidden = false;
        err.textContent = "Enter the room code.";
      }
      return;
    }
    if (!window.confirm("Delete your account? The shared room will close.")) return;
    try {
      await deleteAccount(session.token, cleaned);
      await logout();
    } catch (error) {
      if (err) {
        err.hidden = false;
        err.textContent = error?.message || "Could not delete account.";
      }
    }
  });
  return wrap;
}

async function toggleShareLocation() {
  if (sharingLoc()) {
    locReady = false;
    forgetLocConsent();
    stopGeoShare();
    if (session?.token) {
      try {
        const next = await sendPlace(session.token, { share: false, deviceId: deviceId() });
        applyPlaces(next);
      } catch {
        /* ignore */
      }
    }
    render();
    return;
  }
  await requestLocation();
  render();
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
  livePresent = {
    ba: String(payload?.present?.ba || ""),
    ma: String(payload?.present?.ma || ""),
  };
  if (Array.isArray(payload?.pins)) {
    livePlaces = payload.pins.filter((pin) => pin && Number.isFinite(Number(pin.lat)));
    return;
  }
  livePlaces = ["ba", "ma"]
    .map((who) => {
      const pin = payload?.[who];
      const id = livePresent[who];
      if (!pin || !id) return null;
      return { ...pin, id, who };
    })
    .filter(Boolean);
}

async function syncPlaces() {
  if (!session?.token || !session.roomId) return;
  const next = await loadPlaces(session.token);
  applyPlaces(next);
  if (tab === "where") markSectionSeen("where");
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
    localStorage.setItem(SHARE_LOC_KEY, "0");
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
  try {
    if (localStorage.getItem(SHARE_LOC_KEY) === "0") return false;
  } catch {
    /* ignore */
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

const MAP_Z_MIN = 3;
const MAP_Z_MAX = 19;
const MAP_TILE_MAXZOOM = 19;
const MAP_PIN_ZOOM = 16.5;
const MAP_PIN_PITCH = 0;
const DETAIL_AREAS = [
  { id: "agri", west: 85.3, south: 23.432, east: 85.33, north: 23.458, pinZoom: 18.4 },
  { id: "kanke", west: 85.25, south: 23.36, east: 85.4, north: 23.5, pinZoom: 17.8 },
  { id: "nitk", west: 74.778, south: 12.992, east: 74.822, north: 13.038, pinZoom: 18.2 },
];
const INDIA_CENTER = { lat: 22.8, lng: 82.0 };
const INDIA_ZOOM = 4.35;
const INDIA_BOUNDS = [
  [68.0, 6.6],
  [97.5, 35.7],
];
let mapZoom = 5;
let whereFollow = false;
let whereSig = "";
let whereFull = false;
let whereCenter = { ...INDIA_CENTER };
let followPinId = "";
let followWho = "";
let whereMap = null;
let whereMapReady = false;
let whereMapMoving = false;
let whereMapBooting = false;
let whereMapGen = 0;
let whereStyleUrl = "";
let whereDidFly = false;
let whereMapVector = false;
let whereLabelSig = "";
let whereMapKind = "natural";
let whereMarkers = new Map();
let mapLibre = null;

function readMapKind() {
  try {
    if (localStorage.getItem(MAP_KIND_KEY) === "political") return "political";
  } catch {
    /* ignore */
  }
  return "natural";
}

whereMapKind = readMapKind();

async function ensureMapLibre() {
  if (mapLibre) return mapLibre;
  const [mod] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
  mapLibre = mod;
  return mapLibre;
}

function clampZoom(z) {
  return Math.max(MAP_Z_MIN, Math.min(MAP_Z_MAX, z));
}

function inDetailArea(lng, lat) {
  return (
    DETAIL_AREAS.find((box) => lng >= box.west && lng <= box.east && lat >= box.south && lat <= box.north) || null
  );
}

function pinZoomFor(lat, lng) {
  const area = inDetailArea(Number(lng), Number(lat));
  return area?.pinZoom || MAP_PIN_ZOOM;
}

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return { z, x, y };
}

let detailPrefetchAt = 0;
function prefetchDetailTiles() {
  if (!whereMap) return;
  const c = whereMap.getCenter();
  if (!inDetailArea(c.lng, c.lat)) return;
  const now = Date.now();
  if (now - detailPrefetchAt < 700) return;
  detailPrefetchAt = now;
  const z = Math.min(MAP_Z_MAX, Math.max(12, Math.floor(whereMap.getZoom())));
  const kind = whereMapKind === "political" ? "political" : "sat";
  const ver = kind === "political" ? "v=6" : "v=2";
  const bounds = whereMap.getBounds();
  const zooms = z >= 18 ? [z] : [z, Math.min(MAP_Z_MAX, z + 1)];
  const urls = [];
  for (const zz of zooms) {
    const nw = lngLatToTile(bounds.getWest(), bounds.getNorth(), zz);
    const se = lngLatToTile(bounds.getEast(), bounds.getSouth(), zz);
    const x0 = Math.min(nw.x, se.x) - 1;
    const x1 = Math.max(nw.x, se.x) + 1;
    const y0 = Math.min(nw.y, se.y) - 1;
    const y1 = Math.max(nw.y, se.y) + 1;
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        urls.push(`${API_BASE || ""}/api/map/${kind}/${zz}/${x}/${y}?${ver}`);
      }
    }
  }
  urls.slice(0, 72).forEach((url) => {
    fetch(url, { cache: "force-cache" }).catch(() => {});
  });
}

function mapTileTemplate() {
  const theme = readTheme() === "day" ? "day" : "dark";
  return `${API_BASE || ""}/api/map/{z}/{x}/{y}?v=9&t=${theme}`;
}

function mapStyleUrl() {
  const theme = readTheme() === "day" ? "day" : "dark";
  const kind = whereMapKind === "political" ? "&k=political" : "";
  return `${API_BASE || ""}/api/map/style?v=16&t=${theme}${kind}`;
}

function mapSatTemplate() {
  return `${API_BASE || ""}/api/map/sat/{z}/{x}/{y}?v=2`;
}

function rewriteMapRequest(url) {
  if (typeof url !== "string") return { url };
  // Styles from the API use root-relative /api/map paths. MapLibre resolves those
  // against the page origin (GitHub Pages / Capacitor localhost), not the API host.
  try {
    const base = typeof location !== "undefined" ? location.href : "https://localhost/";
    const parsed = new URL(url, base);
    if (parsed.pathname.startsWith("/api/map")) {
      return { url: `${API_BASE || ""}${parsed.pathname}${parsed.search}` };
    }
  } catch {
    /* fall through */
  }
  if (url.startsWith("/api/map")) {
    return { url: `${API_BASE || ""}${url}` };
  }
  if (/tiles\.openfreemap\.org/i.test(url)) {
    return { url: url.replace(/https?:\/\/tiles\.openfreemap\.org/i, `${API_BASE || ""}/api/map/ofm`) };
  }
  return { url };
}

function absolutizeMapStyle(style) {
  if (!style || typeof style !== "object") return style;
  const fix = (value) => {
    if (typeof value === "string") return rewriteMapRequest(value).url;
    if (Array.isArray(value)) return value.map(fix);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, next] of Object.entries(value)) out[key] = fix(next);
      return out;
    }
    return value;
  };
  return fix(style);
}

function rasterStyle() {
  return {
    version: 8,
    glyphs: `${API_BASE || ""}/api/map/ofm/fonts/{fontstack}/{range}.pbf`,
    sprite: `${API_BASE || ""}/api/map/ofm/sprites/ofm_f384/ofm`,
    sources: {
      baRaster: {
        type: "raster",
        tiles: [mapTileTemplate()],
        tileSize: 256,
        attribution: "© OpenStreetMap",
        maxzoom: MAP_TILE_MAXZOOM,
      },
      baSat: {
        type: "raster",
        tiles: [mapSatTemplate()],
        tileSize: 256,
        maxzoom: MAP_TILE_MAXZOOM,
        attribution: "Esri",
      },
    },
    layers: [
      {
        id: "ba-raster",
        type: "raster",
        source: "baRaster",
        paint: {
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      },
      {
        id: "ba-sat",
        type: "raster",
        source: "baSat",
        paint: {
          "raster-opacity": 1,
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      },
    ],
  };
}

function mergeOfmNameLayersOntoRaster(base, ofm) {
  const next = {
    ...base,
    glyphs: ofm.glyphs || base.glyphs,
    sprite: ofm.sprite || base.sprite,
    sources: { ...base.sources },
    layers: [...base.layers],
  };
  if (ofm.sources?.openmaptiles) next.sources.openmaptiles = ofm.sources.openmaptiles;
  const have = new Set(next.layers.map((layer) => layer.id));
  for (const layer of ofm.layers || []) {
    if (!isWhereNameLayer(layer) || have.has(layer.id)) continue;
    next.layers.push(layer);
    have.add(layer.id);
  }
  return next;
}

function styleHasStreetFills(style) {
  return (style.layers || []).some((layer) => layer && layer.type !== "raster" && layer.type !== "symbol");
}

function politicalRasterStyle() {
  return {
    version: 8,
    sources: {
      baPolitical: {
        type: "raster",
        tiles: [`${API_BASE || ""}/api/map/political/{z}/{x}/{y}?v=6`],
        tileSize: 256,
        maxzoom: 17,
        attribution: "OpenStreetMap",
      },
    },
    layers: [
      {
        id: "ba-political",
        type: "raster",
        source: "baPolitical",
        paint: {
          "raster-opacity": 1,
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      },
    ],
  };
}

function quickMapStyle() {
  return whereMapKind === "political" ? politicalRasterStyle() : rasterStyle();
}

function styleHasOverlayLayers(style) {
  return (style?.layers || []).some((layer) => layer && layer.type !== "raster");
}

async function loadMapStyle() {
  const base = quickMapStyle();
  if (whereMapKind === "political") return { style: absolutizeMapStyle(base), vector: false };
  try {
    const res = await fetch(mapStyleUrl());
    if (!res.ok) throw new Error("style");
    const ofm = absolutizeMapStyle(await res.json());
    const hasNames = (ofm.layers || []).some(isWhereNameLayer);
    if (!styleHasStreetFills(ofm) && ofm.sources?.baSat && hasNames) {
      return { style: ofm, vector: true };
    }
    return { style: absolutizeMapStyle(mergeOfmNameLayersOntoRaster(base, ofm)), vector: hasNames };
  } catch {
    return { style: absolutizeMapStyle(base), vector: false };
  }
}

function setMapZoom(next, keepFollow = false) {
  const target = clampZoom(next);
  mapZoom = target;
  if (keepFollow) whereFollow = true;
  if (!whereMap) return;
  whereMap.stop();
  whereMap.easeTo({
    zoom: target,
    pitch: 0,
    duration: 220,
    essential: true,
    easing: (t) => 1 - (1 - t) * (1 - t),
  });
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

function presentDevice(who) {
  return String(livePresent[who] || "");
}

function pickWhoPin(rows, who) {
  const same = rows.filter((pin) => coupleId(pin.who) === who);
  if (!same.length) return null;
  const presentId = presentDevice(who);
  if (presentId) {
    const live = same.find((pin) => String(pin.id) === presentId);
    if (live) return live;
  }
  if (selfId() === who) {
    const mine = same.find((pin) => String(pin.id) === String(deviceId()));
    if (mine) return mine;
  }
  return same.slice().sort((a, b) => Number(b.at || 0) - Number(a.at || 0))[0];
}

function localSelfPin() {
  if (!session?.token || !sharingLoc()) return [];
  const who = selfId();
  if (!who) return [];
  const last = readLastPin();
  if (!last) return [];
  return [{ ...last, id: deviceId(), who }];
}

function wherePins() {
  const rows = (Array.isArray(livePlaces) ? livePlaces : [])
    .filter((pin) => pin && Number.isFinite(Number(pin.lat)) && Number.isFinite(Number(pin.lng)))
    .map((pin) => ({ ...pin, id: pin.id || pin.who, who: coupleId(pin.who) || pin.who }));
  const self = localSelfPin()[0];
  if (self) {
    const i = rows.findIndex((pin) => coupleId(pin.who) === self.who);
    if (i < 0) rows.push(self);
    else if (Number(self.at || 0) >= Number(rows[i].at || 0)) rows[i] = { ...rows[i], ...self };
  }
  return ["ba", "ma"].map((who) => pickWhoPin(rows, who)).filter(Boolean);
}

function pinMark(pin) {
  return coupleId(pin.who) === "ma" ? "Ma" : "Ba";
}

function followedPin(pins = wherePins()) {
  if (!whereFollow) return null;
  const who = coupleId(followWho);
  if (who) return pins.find((pin) => coupleId(pin.who) === who) || null;
  return pins.find((pin) => pin.id === followPinId) || pins.find((pin) => pin.id === deviceId()) || pins[0] || null;
}

function locateButtonsHtml(pins = wherePins()) {
  const here = deviceId();
  return pins
    .map((pin) => {
      const mark = pinMark(pin);
      const who = coupleId(pin.who) || mark.toLowerCase();
      const mine = who === selfId();
      const self = String(pin.id) === String(here);
      const on = whereFollow && (followWho === who || followPinId === pin.id);
      return `<button type="button" class="map-locate ${mine ? "mine" : "theirs"}${self ? " here" : ""}${on ? " is-on" : ""}" data-go-pin="${escapeHtml(who)}" aria-label="Go to ${escapeHtml(mark)}">${escapeHtml(mark)}</button>`;
    })
    .join("");
}

function paintLocateButtons(pins = wherePins()) {
  const box = document.querySelector("[data-locates]");
  if (!box) return;
  const html = locateButtonsHtml(pins);
  if (box.innerHTML === html) return;
  box.innerHTML = html;
}

function goToDevice(id) {
  const pins = wherePins();
  const pin =
    pins.find((row) => coupleId(row.who) === coupleId(id)) ||
    pins.find((row) => String(row.id) === String(id));
  if (!pin) return;
  followPinId = pin.id;
  followWho = coupleId(pin.who);
  whereFollow = true;
  whereCenter = { lat: Number(pin.lat), lng: Number(pin.lng) };
  const pinZoom = pinZoomFor(pin.lat, pin.lng);
  mapZoom = Math.max(mapZoom, pinZoom);
  paintLocateButtons(pins);
  if (whereMapReady) flyToPin(pin, pinZoom);
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
  el.dataset.goPin = coupleId(pin.who) || String(pin.id);
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", pinMark(pin));
  if (heading != null) el.style.setProperty("--heading", `${heading - bearing}deg`);
  else el.style.removeProperty("--heading");
  const mark = pinMark(pin);
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
  const ids = new Set(pins.map((pin) => coupleId(pin.who) || String(pin.id)));
  for (const [id, rec] of whereMarkers) {
    if (ids.has(id)) continue;
    rec.marker.remove();
    whereMarkers.delete(id);
  }
  for (const pin of pins) {
    const id = coupleId(pin.who) || String(pin.id);
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
  whereMap.stop();
  whereMap.flyTo({
    center: [Number(pin.lng), Number(pin.lat)],
    zoom: nextZoom,
    pitch: nextZoom >= 15.5 ? MAP_PIN_PITCH : 0,
    duration: 820,
    essential: true,
    easing: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
  });
}

function followLivePin(pin) {
  if (!whereMapReady || !whereFollow || whereMapMoving || !pin) return;
  const c = whereMap.getCenter();
  const dLat = (c.lat - Number(pin.lat)) * 111320;
  const dLng = (c.lng - Number(pin.lng)) * 111320 * Math.cos((c.lat * Math.PI) / 180);
  const meters = Math.hypot(dLat, dLng);
  if (meters < 1.4) return;
  whereMapMoving = true;
  whereMap.easeTo({
    center: [Number(pin.lng), Number(pin.lat)],
    duration: meters < 18 ? 180 : 520,
    essential: true,
    easing: (t) => 1 - (1 - t) * (1 - t),
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
  whereDidFly = false;
  whereMapVector = false;
  whereLabelSig = "";
  if (whereMap) {
    whereMap.remove();
    whereMap = null;
  }
}

async function applyWhereMapStyle() {
  if (!whereMap) return;
  const want = mapStyleUrl();
  if (whereStyleUrl === want) return;
  whereStyleUrl = want;
  whereMapReady = false;
  whereMapVector = false;
  whereLabelSig = "";
  whereMap.getContainer()?.classList.toggle("is-raster", whereMapKind !== "political");
  whereMap.getContainer()?.classList.toggle("is-political", whereMapKind === "political");
  whereMap.setStyle(quickMapStyle(), { diff: false });
  requestAnimationFrame(() => whereMap?.resize());
  const loaded = await loadMapStyle();
  if (!whereMap || whereStyleUrl !== want) return;
  whereMapVector = loaded.vector;
  if (styleHasOverlayLayers(loaded.style)) whereMap.setStyle(loaded.style, { diff: true });
  requestAnimationFrame(() => whereMap?.resize());
}

function showIndia() {
  whereFollow = false;
  followPinId = "";
  followWho = "";
  whereCenter = { ...INDIA_CENTER };
  mapZoom = INDIA_ZOOM;
  paintLocateButtons();
  if (!whereMap) return;
  whereMapMoving = true;
  whereMap.stop();
  whereMap.fitBounds(INDIA_BOUNDS, {
    padding: 28,
    duration: 700,
    essential: true,
    pitch: 0,
    bearing: 0,
  });
}

function nameTextField() {
  return [
    "coalesce",
    ["get", "name:en"],
    ["get", "name_en"],
    ["get", "name:latin"],
    ["get", "name"],
    ["get", "housenumber"],
  ];
}

function scaleLabelSize(value, factor = 1.28, extra = 1.4, cap = 24) {
  const bump = (n) => Math.min(cap, Math.round((Number(n) * factor + extra) * 10) / 10);
  if (typeof value === "number") return bump(value);
  if (Array.isArray(value) && value[0] === "interpolate") {
    const next = value.slice();
    for (let i = 4; i < next.length; i += 2) {
      if (typeof next[i] === "number") next[i] = bump(next[i]);
    }
    return next;
  }
  return value;
}

function isWhereNameLayer(layer) {
  if (!layer || layer.type !== "symbol") return false;
  const id = String(layer.id || "").toLowerCase();
  const src = String(layer["source-layer"] || "").toLowerCase();
  if (/oneway|one_way|shield|arrow/.test(id)) return false;
  return (
    /name|label|place|poi|housenum|building|highway-name|highway_name|airport|water/.test(id) ||
    /transportation_name|place|poi|housenumber|aerodrome_label|water_name|waterway/.test(src)
  );
}

function polishRasterLayers() {
  if (!whereMap) return;
  if (whereMap.getLayer("ba-raster")) {
    whereMap.setPaintProperty("ba-raster", "raster-fade-duration", 0);
    whereMap.setPaintProperty("ba-raster", "raster-contrast", 0);
    whereMap.setPaintProperty("ba-raster", "raster-saturation", 0);
  }
  if (whereMap.getLayer("ba-sat")) {
    whereMap.setPaintProperty("ba-sat", "raster-opacity", 1);
    whereMap.setPaintProperty("ba-sat", "raster-fade-duration", 0);
    whereMap.setPaintProperty("ba-sat", "raster-contrast", 0);
    whereMap.setPaintProperty("ba-sat", "raster-saturation", 0);
    whereMap.setPaintProperty("ba-sat", "raster-brightness-min", 0);
    whereMap.setPaintProperty("ba-sat", "raster-brightness-max", 1);
  }
  if (whereMap.getLayer("ba-political")) {
    whereMap.setPaintProperty("ba-political", "raster-opacity", 1);
    whereMap.setPaintProperty("ba-political", "raster-fade-duration", 0);
    whereMap.setPaintProperty("ba-political", "raster-resampling", "linear");
  }
}

function ensureWhereNameLayers() {
  if (!whereMap) return;
  if (!whereMap.getSource("openmaptiles")) {
    whereMap.addSource("openmaptiles", {
      type: "vector",
      url: `${API_BASE || ""}/api/map/ofm/planet`,
    });
  }
  const existingNames = (whereMap.getStyle()?.layers || []).filter(isWhereNameLayer);
  if (existingNames.length >= 8) return;
  const night = readTheme() !== "day";
  const textColor = night ? "#f4f7fb" : "#121826";
  const halo = night ? "rgba(8, 12, 20, 0.94)" : "rgba(255, 255, 255, 0.95)";
  const layers = [
    {
      id: "label_country",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 2,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": nameTextField(),
        "text-font": ["Noto Sans Bold"],
        "text-max-width": 8,
        "text-transform": "uppercase",
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 5, 16],
      },
    },
    {
      id: "label_city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 3,
      filter: ["match", ["get", "class"], ["city", "town"], true, false],
      layout: {
        "text-field": nameTextField(),
        "text-font": ["Noto Sans Regular"],
        "text-max-width": 8,
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 15, 12, 18],
      },
    },
    {
      id: "highway-name-major",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 12,
      filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk", "motorway"], true, false],
      layout: {
        "symbol-placement": "line",
        "text-field": nameTextField(),
        "text-font": ["Noto Sans Regular"],
        "text-rotation-alignment": "map",
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 12, 17, 16],
      },
    },
    {
      id: "highway-name-minor",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["match", ["get", "class"], ["minor", "service", "track", "path"], true, false],
      layout: {
        "symbol-placement": "line",
        "text-field": nameTextField(),
        "text-font": ["Noto Sans Regular"],
        "text-rotation-alignment": "map",
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 12, 17, 15],
      },
    },
    {
      id: "place",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 8,
      filter: ["match", ["get", "class"], ["suburb", "neighbourhood", "quarter", "hamlet", "village", "isolated_dwelling"], true, false],
      layout: {
        "text-field": nameTextField(),
        "text-font": ["Noto Sans Regular"],
        "text-max-width": 8,
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 15, 15],
      },
    },
    {
      id: "poi",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 14,
      filter: ["has", "name"],
      layout: {
        "text-field": nameTextField(),
        "text-font": ["Noto Sans Regular"],
        "text-max-width": 9,
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 12, 18, 15],
      },
    },
    {
      id: "building-name",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "housenumber",
      minzoom: 17,
      layout: {
        "text-field": ["coalesce", ["get", "housenumber"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
    },
  ];
  for (const layer of layers) {
    if (whereMap.getLayer(layer.id)) continue;
    try {
      whereMap.addLayer({
        ...layer,
        paint: {
          "text-color": textColor,
          "text-halo-color": halo,
          "text-halo-width": 1.7,
          "text-halo-blur": 0.12,
        },
      });
    } catch {
      /* source or glyphs may still be warming */
    }
  }
}

function sharpenWhereLabels(bumpSize = true) {
  if (!whereMap) return;
  const night = readTheme() !== "day";
  const layers = whereMap.getStyle()?.layers || [];
  for (const layer of layers) {
    if (!isWhereNameLayer(layer)) continue;
    const id = layer.id;
    try {
      whereMap.setLayoutProperty(id, "visibility", "visible");
      if (bumpSize) {
        const size = whereMap.getLayoutProperty(id, "text-size");
        if (size != null) whereMap.setLayoutProperty(id, "text-size", scaleLabelSize(size));
      }
      whereMap.setPaintProperty(id, "text-color", night ? "#f4f7fb" : "#121826");
      whereMap.setPaintProperty(id, "text-halo-color", night ? "rgba(8, 12, 20, 0.94)" : "rgba(255, 255, 255, 0.95)");
      whereMap.setPaintProperty(id, "text-halo-width", 1.75);
      whereMap.setPaintProperty(id, "text-halo-blur", 0.12);
    } catch {
      /* icon-only symbol layers skip text paint */
    }
  }
}

function polishWhereMapStyle() {
  polishRasterLayers();
  if (whereMapKind === "political") {
    whereLabelSig = (whereMap.getStyle()?.layers || []).map((layer) => layer.id).join("|");
    return;
  }
  ensureWhereNameLayers();
  const sig = (whereMap.getStyle()?.layers || []).map((layer) => layer.id).join("|");
  const first = whereLabelSig !== sig;
  whereLabelSig = sig;
  sharpenWhereLabels(first);
}

function bindWhereMapEvents() {
  if (!whereMap) return;
  const onReady = () => {
    whereMapReady = true;
    polishWhereMapStyle();
    addAccuracyLayers();
    syncWhereMarkers();
    if (!whereDidFly) {
      whereDidFly = true;
      if (whereFollow && followedPin()) {
        const pin = followedPin();
        flyToPin(pin, pinZoomFor(pin.lat, pin.lng));
      }
      else showIndia();
    } else {
      whereMap.jumpTo({
        center: [Number(whereCenter.lng), Number(whereCenter.lat)],
        zoom: clampZoom(mapZoom),
        pitch: 0,
      });
    }
  };
  whereMap.on("style.load", onReady);
  if (whereMap.isStyleLoaded && whereMap.isStyleLoaded()) onReady();
  whereMap.on("sourcedata", (event) => {
    if (event?.sourceId === "openmaptiles" && event.isSourceLoaded) polishWhereMapStyle();
  });
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
    prefetchDetailTiles();
  });
  whereMap.on("rotate", () => {
    syncWhereMarkers();
    paintCompass();
  });
  whereMap.on("error", () => {});
  paintCompass();
}

async function initWhereMap(stage) {
  if (whereMap || whereMapBooting) return;
  whereMapBooting = true;
  const gen = ++whereMapGen;
  try {
    await ensureMapLibre();
    if (gen !== whereMapGen || !stage.isConnected || whereMap) return;
    const startZoom = INDIA_ZOOM;
    mapZoom = startZoom;
    const MapCtor = mapLibre.Map || mapLibre.default;
    if (!MapCtor) throw new Error("Map library missing");
    mapLibre = { ...mapLibre, Map: MapCtor };
    if (gen !== whereMapGen || !stage.isConnected || whereMap) return;
    const quick = quickMapStyle();
    if (gen !== whereMapGen || !stage.isConnected || whereMap) return;
    whereMapVector = false;
    stage.classList.toggle("is-raster", whereMapKind !== "political");
    stage.classList.toggle("is-political", whereMapKind === "political");
    whereStyleUrl = mapStyleUrl();
    whereMap = new MapCtor({
      container: stage,
      style: quick,
      center: [INDIA_CENTER.lng, INDIA_CENTER.lat],
      zoom: startZoom,
      pitch: 0,
      minZoom: MAP_Z_MIN,
      maxZoom: MAP_Z_MAX,
      maxPitch: 62,
      dragPan: true,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      touchZoomRotate: true,
      scrollZoom: true,
      fadeDuration: 0,
      attributionControl: false,
      maplibreLogo: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
      canvasContextAttributes: { antialias: true, powerPreference: "high-performance" },
      refreshExpiredTiles: false,
      collectResourceTiming: false,
      maxParallelImageRequests: 32,
      trackResize: true,
      renderWorldCopies: true,
      validateStyle: false,
      cooperativeGestures: false,
      maxTileCacheZoomLevels: 16,
      transformRequest: (url) => rewriteMapRequest(url),
    });
    whereMap.dragPan.enable();
    whereMap.scrollZoom.enable();
    whereMap.touchZoomRotate.enable();
    whereMap.touchZoomRotate.enableRotation();
    whereMap.scrollZoom.setWheelZoomRate(1 / 180);
    bindWhereMapEvents();
    requestAnimationFrame(() => whereMap?.resize());
    loadMapStyle().then((loaded) => {
      if (gen !== whereMapGen || !whereMap) return;
      whereMapVector = loaded.vector;
      if (styleHasOverlayLayers(loaded.style)) whereMap.setStyle(loaded.style, { diff: true });
    });
  } catch (error) {
    console.warn("Where map failed", error);
    whereMap = null;
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
  if (force) whereMap.resize();
  if (!force && sig === whereSig) {
    syncWhereMarkers(pins);
    return;
  }
  whereSig = sig;
  syncWhereMarkers(pins);
  if (force && whereFollow) {
    const pin = followedPin(pins);
    if (pin) flyToPin(pin, pinZoomFor(pin.lat, pin.lng));
  } else if (whereFollow) {
    followLivePin(followedPin(pins));
  }
}

function mapFullIcon(full) {
  return full
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3v2H5v4H3V3h6zm12 0v6h-2V5h-4V3h6zM3 15h2v4h4v2H3v-6zm18 0v6h-6v-2h4v-4h2z"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm16 0v5h-5v-2h3v-3h2z"/></svg>`;
}

function compassIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" stroke-width="1.55"/><path fill="currentColor" d="M12 4.4l3.15 9.7-3.15-1.72-3.15 1.72z"/><circle cx="12" cy="12.15" r="1.2" fill="currentColor"/></svg>`;
}

function paintCompass() {
  const needle = document.querySelector("[data-compass-needle]");
  if (!needle) return;
  const bearing = whereMap ? whereMap.getBearing() : 0;
  needle.style.transform = `rotate(${-bearing}deg)`;
}

function resetMapNorth() {
  if (!whereMap) return;
  whereMap.stop();
  whereMap.easeTo({
    bearing: 0,
    duration: 280,
    essential: true,
    easing: (t) => 1 - (1 - t) * (1 - t),
  });
}

function mapKindCredit() {
  return whereMapKind === "political" ? "OpenStreetMap" : "Esri · OpenStreetMap";
}

function paintMapKindBtns() {
  document.querySelectorAll("[data-map-kind]").forEach((btn) => {
    const on = btn.dataset.mapKind === whereMapKind;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const credit = document.querySelector("[data-map-credit]");
  if (credit) credit.textContent = mapKindCredit();
}

function setWhereMapKind(kind) {
  const next = kind === "political" ? "political" : "natural";
  if (whereMapKind === next) return;
  whereMapKind = next;
  try {
    localStorage.setItem(MAP_KIND_KEY, next);
  } catch {
    /* ignore */
  }
  paintMapKindBtns();
  if (!whereMap) return;
  rememberMapView();
  whereMapReady = false;
  whereLabelSig = "";
  whereStyleUrl = "";
  applyWhereMapStyle();
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
      geoNote = "";
      const box = document.querySelector("[data-geo-note]");
      if (box) box.textContent = "";
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
      if (session?.token) {
        if (tab === "where") drawWhereMap();
        else render();
      }
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
      if (session?.token) {
        if (tab === "where") drawWhereMap();
        else render();
      }
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
      maximumAge: 800,
      timeout: 12000,
    });
  }
  if (!geoTick) {
    geoTick = window.setInterval(() => {
      if (!session?.token || !sharingLoc() || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(pushPlace, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 8000,
      });
    }, 8000);
  }
}

function startGeoShare() {
  if (!session?.token || !sharingLoc()) return;
  bindGeoResume();
  locReady = true;
  startGeoWatch();
  if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pushPlace, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 800,
        timeout: 8000,
      });
  }
}

function stopGeoShare() {
  if (geoWatch) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = 0;
  window.clearInterval(geoTick);
  geoTick = 0;
}

function locationView() {
  whereSig = "";
  whereFollow = false;
  followPinId = "";
  followWho = "";
  whereDidFly = false;
  whereCenter = { ...INDIA_CENTER };
  mapZoom = INDIA_ZOOM;
  const wrap = el(`
    <div class="where">
      <p class="muted tiny" data-geo-note>${escapeHtml(geoNote)}</p>
      <div class="place-stage ${whereFull ? "is-full" : ""}" data-place-stage>
        <div class="place-map" data-live-map></div>
        <p class="map-credit" data-map-credit>${mapKindCredit()}</p>
        <div class="map-locates" data-locates></div>
        <div class="map-tools">
          <button type="button" class="map-compass" data-map-compass aria-label="Reset north"><span data-compass-needle>${compassIcon()}</span></button>
          <button type="button" class="map-kind" data-map-kind="natural" aria-label="Natural map" aria-pressed="${whereMapKind !== "political"}">N</button>
          <button type="button" class="map-kind" data-map-kind="political" aria-label="Political map" aria-pressed="${whereMapKind === "political"}">P</button>
          <button type="button" data-map-full aria-label="${whereFull ? "Exit full screen" : "Full screen"}">${mapFullIcon(whereFull)}</button>
        </div>
      </div>
      <p class="muted tiny" data-place-ago></p>
    </div>
  `);
  wrap.querySelector("[data-map-full]").addEventListener("click", toggleMapFull);
  wrap.querySelector("[data-map-compass]").addEventListener("click", resetMapNorth);
  wrap.querySelectorAll("[data-map-kind]").forEach((btn) => {
    btn.addEventListener("click", () => setWhereMapKind(btn.dataset.mapKind));
  });
  paintMapKindBtns();
  wrap.querySelector("[data-locates]").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-go-pin]");
    if (!btn) return;
    goToDevice(btn.dataset.goPin);
  });
  startGeoShare();
  syncPlaces().catch(() => {});
  if (sharingLoc()) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pushPlace, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      });
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => drawWhereMap(true)));
  return wrap;
}

function pageTitle() {
  if (tab === "home") return "Ba";
  if (tab === "memories" || tab === "dates") return "Memories";
  if (tab === "today" && openDiaryDay) {
    const when = new Date(`${openDiaryDay}T12:00:00`);
    if (!Number.isNaN(when.getTime())) {
      return when.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    }
  }
  if (tab === "cycle" && cycleSettingsOpen) return "Period settings";
  if (tab === "cycle" && periodHistMonth) {
    return monthLabelForKey(periodHistMonth) || periodHistMonth;
  }
  if (tab === "cycle" && courseHistMonth) {
    return monthLabelForKey(courseHistMonth) || courseHistMonth;
  }
  const names = {
    routine: "Routine",
    where: "Where",
    today: "Overview",
    us: "Settings",
    family: "Family",
    todo: "To Do",
    daily: "Daily",
    cycle: "Periods",
    settings: "Settings",
  };
  return names[tab] || "Ba";
}

function appView() {
  if (tab === "chat") return chatView();
  const shell = el(`
    <div class="shell${tab === "home" ? " is-home" : ""}">
      ${
        tab === "home"
          ? ""
          : `<header class="topbar">
        <h1 class="wordmark">${escapeHtml(pageTitle())}</h1>
      </header>`
      }
    </div>
  `);
  const views = {
    home: homeView,
    routine: routineView,
    where: locationView,
    today: todayView,
    dates: datesView,
    us: usView,
    todo: todoView,
    daily: dailyView,
    family: familyView,
    memories: datesView,
    cycle: cycleView,
    settings: settingsView,
  };
  shell.append((views[tab] || homeView)());
  return shell;
}

function render() {
  if (!root) return;
  document.querySelectorAll("body > .app-cal-pop, body > .app-cal-scrim").forEach((node) => node.remove());
  document.body.classList.remove("is-hold-menu");
  document.body.classList.toggle("wa-open", Boolean(session?.token && session.roomId && tab === "chat"));
  document.body.classList.toggle("map-full", Boolean(whereFull && tab === "where"));
  document.body.classList.toggle("on-family", Boolean(session?.token && tab === "family"));
  if (!session?.token || !session.roomId) {
    teardownWhereMap();
    root.replaceChildren(gateView());
    return;
  }
  if (sharingLoc()) {
    locReady = true;
    startGeoShare();
  }
  if (tab === "chat" && document.querySelector(".wa-app")) return;
  if (tab === "where" && document.querySelector("[data-live-map]")) {
    drawWhereMap();
    return;
  }
  if (tab !== "where") teardownWhereMap();
  root.replaceChildren(appView());
  applyPendingScroll();
}

async function boot() {
  try {
    await Promise.race([initNative(), new Promise((resolve) => window.setTimeout(resolve, 800))]);
  } catch {
    /* continue to UI */
  }
  try {
    await hydrateLocConsent();
  } catch {
    /* ignore */
  }
  if (!session?.token) {
    render();
    return;
  }
  render();
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

let clientBuildId = "";
function watchClientBuild() {
  const tick = async () => {
    try {
      const res = await fetch(`${API_BASE || ""}/api/build`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const next = String(data?.v || "");
        if (next) {
          if (clientBuildId && clientBuildId !== next) {
            window.location.reload();
            return;
          }
          clientBuildId = next;
        }
      }
    } catch {
      /* ignore */
    }
    window.setTimeout(tick, 2500);
  };
  tick();
}

watchClientBuild();

function pressableFrom(node) {
  const el = node?.closest?.("button, [role='button'], .home-tile, .home-chat, .home-date, a.btn");
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

let downEl = null;
function setDown(el) {
  if (downEl === el) return;
  if (downEl) downEl.classList.remove("is-down");
  downEl = el || null;
  if (downEl) downEl.classList.add("is-down");
}

function clearDown() {
  setDown(null);
}

document.addEventListener(
  "pointerdown",
  (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setDown(pressableFrom(event.target));
    wakePokeTone();
  },
  { capture: true, passive: true }
);
document.addEventListener("pointerup", clearDown, { capture: true, passive: true });
document.addEventListener("pointercancel", clearDown, { capture: true, passive: true });
window.addEventListener("blur", clearDown);
