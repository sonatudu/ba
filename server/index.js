import cors from "cors";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import express from "express";
import { spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import http from "node:http";
import https from "node:https";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ? String(process.env.DATA_DIR) : join(root, "data");
const usersDir = join(dataDir, "users");
const roomsDir = join(dataDir, "rooms");
const sessionsDir = join(dataDir, "sessions");
const requestsDir = join(dataDir, "requests");
const tileDiskDir = join(dataDir, "tiles");
mkdirSync(usersDir, { recursive: true });
mkdirSync(roomsDir, { recursive: true });
mkdirSync(sessionsDir, { recursive: true });
mkdirSync(requestsDir, { recursive: true });
mkdirSync(tileDiskDir, { recursive: true });
console.log(`[ba] data directory: ${dataDir}`);

const PORT = Number(process.env.PORT || 8787);
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;
const PAIR_CODE = "192746";
const COUPLE_ROOM_ID = "BA-OURS";
const COUPLE_MEMBERS = ["ba", "ma"];
function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function scrypt(secret, salt) {
  return scryptSync(secret, salt, 32).toString("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeUser(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function validUser(value) {
  return /^[a-z0-9_]{3,24}$/.test(value);
}

function makeRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

function userPath(username) {
  return join(usersDir, `${hashHex(username)}.json`);
}

function roomPath(roomId) {
  return join(roomsDir, `${hashHex(roomId)}.json`);
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  if (existsSync(file)) {
    try {
      const prev = readFileSync(file, "utf8").trim();
      if (prev) copyFileSync(file, `${file}.bak`);
    } catch {
      /* keep going — write still proceeds */
    }
  }
  renameSync(tmp, file);
}

function readUser(username) {
  return readJson(userPath(username));
}

function writeUser(user) {
  writeJson(userPath(user.username), user);
}

function deleteUserFile(username) {
  const file = userPath(username);
  if (existsSync(file)) unlinkSync(file);
}

function deleteRoomFile(roomId) {
  const file = roomPath(roomId);
  if (existsSync(file)) unlinkSync(file);
  const bak = `${file}.bak`;
  if (existsSync(bak)) unlinkSync(bak);
}

function deleteSessionsFor(username) {
  for (const name of readdirSync(sessionsDir)) {
    try {
      const session = JSON.parse(readFileSync(join(sessionsDir, name), "utf8"));
      if (session.username === username) unlinkSync(join(sessionsDir, name));
    } catch {
      /* ignore */
    }
  }
}

function wipeAccount(user) {
  for (const item of allRequests()) {
    if (item.from === user.username || item.to === user.username) deleteRequest(item.id);
  }
  if (user.roomId) {
    const room = readRoom(user.roomId);
    if (room?.members) {
      for (const member of room.members) {
        if (member === user.username) continue;
        const partner = readUser(member);
        if (partner) {
          partner.roomId = null;
          writeUser(partner);
        }
      }
    }
    deleteRoomFile(user.roomId);
  }
  deleteSessionsFor(user.username);
  deleteUserFile(user.username);
}

function readRoom(roomId) {
  const file = roomPath(roomId);
  const room = readJson(file);
  if (room) return room;
  // Recover from last good backup if the live file was truncated/corrupt.
  const bak = readJson(`${file}.bak`);
  if (bak) {
    writeJson(file, bak);
    return bak;
  }
  return null;
}

function writeRoom(room) {
  const file = roomPath(room.id);
  const existing = readJson(file) || readJson(`${file}.bak`);
  // Never silently erase an existing encrypted room blob.
  if (existing && String(existing.blob || "").trim() && !String(room.blob || "").trim()) {
    room.blob = existing.blob;
    if (!room.iv) room.iv = existing.iv;
    if (!room.kdfSalt) room.kdfSalt = existing.kdfSalt;
  }
  writeJson(file, room);
}

function roomExists(roomId) {
  return existsSync(roomPath(roomId));
}

function requestPath(id) {
  return join(requestsDir, `${id}.json`);
}

function readRequest(id) {
  return readJson(requestPath(id));
}

function writeRequest(req) {
  writeJson(requestPath(req.id), req);
}

function deleteRequest(id) {
  const file = requestPath(id);
  if (existsSync(file)) unlinkSync(file);
}

function allRequests() {
  return readdirSync(requestsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(join(requestsDir, name)))
    .filter(Boolean);
}

function roomIdReserved(roomId) {
  if (roomExists(roomId)) return true;
  return allRequests().some((item) => item.roomId === roomId);
}

function publicRequest(item) {
  return {
    id: item.id,
    from: item.from,
    to: item.to,
    roomId: item.roomId,
    message: item.message,
    createdAt: item.createdAt,
  };
}

function finishRoom(creator, partner, roomId) {
  const room = {
    id: roomId,
    members: [creator.username, partner.username],
    startedOn: "",
    kdfSalt: randomBytes(16).toString("hex"),
    blob: "",
    iv: "",
    chat: [],
    readAt: {},
    deliveredAt: {},
    typing: {},
    presence: {},
    signals: [],
    statuses: [],
    disappearMs: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeRoom(room);
  creator.roomId = room.id;
  partner.roomId = room.id;
  writeUser(creator);
  writeUser(partner);
  for (const item of allRequests()) {
    if (item.from === creator.username || item.to === creator.username || item.from === partner.username || item.to === partner.username) {
      deleteRequest(item.id);
    }
  }
  return room;
}

function uniqueRoomId() {
  for (let i = 0; i < 20; i += 1) {
    const id = makeRoomId();
    if (!roomIdReserved(id)) return id;
  }
  throw new Error("Could not allocate a room id.");
}

function readSession(tokenHash) {
  const session = readJson(join(sessionsDir, `${tokenHash}.json`));
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    unlinkSync(join(sessionsDir, `${tokenHash}.json`));
    return null;
  }
  return session;
}

function writeSession(session) {
  writeJson(join(sessionsDir, `${session.tokenHash}.json`), session);
}

function pruneSessions() {
  for (const name of readdirSync(sessionsDir)) {
    try {
      const session = JSON.parse(readFileSync(join(sessionsDir, name), "utf8"));
      if (session.expiresAt < Date.now()) unlinkSync(join(sessionsDir, name));
    } catch {
      /* ignore */
    }
  }
}

const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const row = hits.get(key) || [];
  const recent = row.filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function issueToken(username, roomId, deviceId) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  writeSession({
    tokenHash: hashHex(token),
    username,
    deviceId: deviceId || "",
    roomId: roomId || null,
    issuedAt: now,
    expiresAt: now + SESSION_MS,
  });
  return token;
}

function sessionDeviceId(session) {
  const id = String(session?.deviceId || "").slice(0, 80);
  return id.length >= 8 ? id : "";
}

function liveLogins() {
  pruneSessions();
  const now = Date.now();
  const byWho = { ba: null, ma: null };
  const ids = new Set();
  for (const name of readdirSync(sessionsDir)) {
    try {
      const sess = JSON.parse(readFileSync(join(sessionsDir, name), "utf8"));
      if (!COUPLE_MEMBERS.includes(sess.username)) continue;
      if (!Number.isFinite(Number(sess.expiresAt)) || Number(sess.expiresAt) < now) continue;
      const deviceId = sessionDeviceId(sess);
      if (!deviceId) continue;
      ids.add(deviceId);
      const issued = Number(sess.issuedAt || 0) || Number(sess.expiresAt) || 0;
      const prev = byWho[sess.username];
      if (!prev || issued >= prev.issued) {
        byWho[sess.username] = { deviceId, issued };
      }
    } catch {
      /* ignore */
    }
  }
  return { byWho, ids };
}

const GATE_SU = "mo";
const GATE_RIN = "do";

function lettersOf(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 2);
}

function assignWho(room, deviceId, requested) {
  if (!room.devices || typeof room.devices !== "object") room.devices = {};
  const known = COUPLE_MEMBERS.includes(room.devices[deviceId]) ? room.devices[deviceId] : "";
  if (known) return known;
  const who = COUPLE_MEMBERS.includes(requested) ? requested : "";
  if (!who) return null;
  room.devices[deviceId] = who;
  return who;
}

function publicRoom(room, username) {
  const who = room.members[0] === username ? "you" : "them";
  return {
    roomId: room.id,
    who,
    you: room.members[0],
    them: room.members[1],
    startedOn: room.startedOn,
    kdfSalt: room.kdfSalt,
    blob: room.blob,
    iv: room.iv,
    updatedAt: Number(room.updatedAt || 0),
  };
}

function pairCodeOk(value) {
  const code = String(value || "").replace(/\D/g, "");
  if (!code) return false;
  return safeEqual(hashHex(code), hashHex(PAIR_CODE));
}

function ensureCoupleRoom() {
  let room = readRoom(COUPLE_ROOM_ID);
  if (!room) {
    room = {
      id: COUPLE_ROOM_ID,
      members: [...COUPLE_MEMBERS],
      startedOn: "",
      kdfSalt: randomBytes(16).toString("hex"),
      blob: "",
      iv: "",
      chat: [],
      readAt: {},
      deliveredAt: {},
      typing: {},
      presence: {},
      locations: {},
      signals: [],
      statuses: [],
      disappearMs: 0,
      devices: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeRoom(room);
  }
  room.members = [...COUPLE_MEMBERS];
  if (!room.devices || typeof room.devices !== "object") room.devices = {};
  return withChat(room);
}

function requireAuth(req, res) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Please enter the private code." });
    return null;
  }
  const session = readSession(hashHex(token));
  if (!session || !COUPLE_MEMBERS.includes(session.username)) {
    res.status(401).json({ error: "Please enter the private code." });
    return null;
  }
  const room = ensureCoupleRoom();
  return { session, user: { username: session.username }, room };
}

function withChat(room) {
  if (!Array.isArray(room.chat)) room.chat = [];
  if (!room.readAt || typeof room.readAt !== "object") room.readAt = {};
  if (!room.deliveredAt || typeof room.deliveredAt !== "object") room.deliveredAt = {};
  if (!room.typing || typeof room.typing !== "object") room.typing = {};
  if (!room.presence || typeof room.presence !== "object") room.presence = {};
  if (!room.locations || typeof room.locations !== "object") room.locations = {};
  if (!Array.isArray(room.signals)) room.signals = [];
  if (!Array.isArray(room.statuses)) room.statuses = [];
  if (!Number.isFinite(room.disappearMs)) room.disappearMs = 0;
  return room;
}

function purgeDeletedChat(room) {
  withChat(room);
  const before = room.chat.length;
  room.chat = room.chat.filter(
    (row) => row && !row.deleted && String(row.iv || "").trim() && String(row.blob || "").trim()
  );
  if (room.chat.length !== before) {
    room.updatedAt = Date.now();
    writeRoom(room);
  }
  return room;
}

function publicChat(room, username) {
  const now = Date.now();
  const other = (room.members || []).find((name) => name !== username);
  const typingUntil = other ? Number(room.typing?.[other] || 0) : 0;
  const seen = other ? Number(room.presence?.[other] || 0) : 0;
  const incoming = (room.signals || []).find((item) => item.to === username && item.kind === "offer");
  return {
    messages: room.chat || [],
    readAt: room.readAt || {},
    deliveredAt: room.deliveredAt || {},
    typing: typingUntil > now,
    online: Boolean(other && now - seen < 15000),
    lastSeen: seen || 0,
    disappearMs: room.disappearMs || 0,
    incomingCall: incoming ? { from: incoming.from, video: Boolean(incoming.video), data: incoming.data } : null,
    statuses: (room.statuses || []).filter((item) => now - Number(item.at || 0) < 86400000),
  };
}

ensureCoupleRoom();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "3mb" }));

app.post("/api/enter", (req, res) => {
  const code = String(req.body?.code || "").replace(/\D/g, "");
  const deviceId = String(req.body?.deviceId || "").slice(0, 80);
  if (!pairCodeOk(code)) {
    return res.status(401).json({ error: "That code is wrong." });
  }
  if (deviceId.length < 8) {
    return res.status(400).json({ error: "Could not open this phone." });
  }
  const room = ensureCoupleRoom();
  const requested = String(req.body?.who || "").trim().toLowerCase();
  const locked = COUPLE_MEMBERS.includes(room.devices?.[deviceId]) ? room.devices[deviceId] : "";
  if (!locked && !COUPLE_MEMBERS.includes(requested)) {
    return res.status(400).json({ error: "Pick Ba or Ma." });
  }
  if (!locked) {
    const su = lettersOf(req.body?.su);
    const rin = lettersOf(req.body?.rin);
    if (su.length !== 2 || rin.length !== 2) {
      return res.status(401).json({ error: "Answer the setup questions.", needSetup: true });
    }
    if (!safeEqual(hashHex(su), hashHex(GATE_SU)) || !safeEqual(hashHex(rin), hashHex(GATE_RIN))) {
      return res.status(401).json({ error: "Those answers are wrong.", needSetup: true });
    }
  }
  const who = assignWho(room, deviceId, requested || locked);
  if (!who) return res.status(400).json({ error: "Pick Ba or Ma." });
  writeRoom(room);
  const token = issueToken(who, room.id, deviceId);
  res.json({ token, username: who, ...publicRoom(room, who) });
});

app.post("/api/identity", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const who = String(req.body?.who || "").trim().toLowerCase();
  if (!COUPLE_MEMBERS.includes(who)) {
    return res.status(400).json({ error: "Pick Ba or Ma." });
  }
  if (!auth.room.devices || typeof auth.room.devices !== "object") auth.room.devices = {};
  if (auth.session.deviceId) auth.room.devices[auth.session.deviceId] = who;
  auth.session.username = who;
  writeSession(auth.session);
  writeRoom(auth.room);
  res.json({ username: who, ...publicRoom(auth.room, who) });
});

app.get("/api/me", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  res.json({
    username: auth.user.username,
    ...publicRoom(auth.room, auth.user.username),
  });
});

app.get("/api/data", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  res.json({
    username: auth.user.username,
    ...publicRoom(auth.room, auth.user.username),
  });
});

app.put("/api/data", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  const { blob, iv } = req.body || {};
  if (typeof blob !== "string" || typeof iv !== "string") {
    return res.status(400).json({ error: "Invalid payload." });
  }
  if (blob.length > 1_500_000) return res.status(413).json({ error: "Too much data." });
  if (!blob.trim() && String(auth.room.blob || "").trim()) {
    return res.status(400).json({ error: "Refusing to erase room data." });
  }
  auth.room.blob = blob;
  auth.room.iv = iv;
  auth.room.updatedAt = Date.now();
  writeRoom(auth.room);
  res.json({ ok: true, updatedAt: auth.room.updatedAt });
});

app.get("/api/chat", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  purgeDeletedChat(auth.room);
  const newest = (auth.room.chat || []).reduce((max, item) => Math.max(max, Number(item.at) || 0), 0);
  const stamp = Math.max(Date.now(), newest);
  const newestFromOther = (auth.room.chat || [])
    .filter((item) => item.from !== auth.user.username)
    .reduce((max, item) => Math.max(max, Number(item.at) || 0), 0);
  if (newestFromOther && stamp > Number(auth.room.deliveredAt[auth.user.username] || 0)) {
    auth.room.deliveredAt[auth.user.username] = stamp;
    writeRoom(auth.room);
  }
  res.json(publicChat(auth.room, auth.user.username));
});

app.post("/api/chat", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  if (!rateLimit(`chat:${auth.user.username}`, 90, 60 * 1000)) {
    return res.status(429).json({ error: "Slow down a little." });
  }
  const { id, iv, blob, at } = req.body || {};
  if (typeof id !== "string" || id.length < 8 || id.length > 80) {
    return res.status(400).json({ error: "Invalid message." });
  }
  if (typeof iv !== "string" || typeof blob !== "string") {
    return res.status(400).json({ error: "Invalid message." });
  }
  if (blob.length > 1_200_000) return res.status(413).json({ error: "Message is too long." });
  withChat(auth.room);
  if (auth.room.chat.some((item) => item.id === id)) {
    return res.json(publicChat(auth.room, auth.user.username));
  }
  auth.room.chat.push({
    id,
    from: auth.user.username,
    at: Number(at) || Date.now(),
    iv,
    blob,
  });
  if (auth.room.chat.length > 800) auth.room.chat = auth.room.chat.slice(-800);
  auth.room.typing[auth.user.username] = 0;
  auth.room.updatedAt = Date.now();
  writeRoom(auth.room);
  res.json(publicChat(auth.room, auth.user.username));
});

app.put("/api/chat/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  const { iv, blob } = req.body || {};
  if (typeof iv !== "string" || typeof blob !== "string") {
    return res.status(400).json({ error: "Invalid message." });
  }
  if (blob.length > 1_200_000) return res.status(413).json({ error: "Message is too long." });
  withChat(auth.room);
  const item = auth.room.chat.find((row) => row.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Message not found." });
  item.iv = iv;
  item.blob = blob;
  auth.room.updatedAt = Date.now();
  writeRoom(auth.room);
  res.json(publicChat(auth.room, auth.user.username));
});

app.delete("/api/chat", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  if (!req.body?.confirm) {
    return res.status(400).json({ error: "Clear chat needs an explicit confirm." });
  }
  withChat(auth.room);
  auth.room.chat = [];
  auth.room.updatedAt = Date.now();
  writeRoom(auth.room);
  res.json(publicChat(auth.room, auth.user.username));
});

app.delete("/api/chat/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  const item = auth.room.chat.find((row) => row.id === req.params.id);
  if (!item) return res.json(publicChat(auth.room, auth.user.username));
  const from = String(item.from || "").trim().toLowerCase();
  const who = String(auth.user.username || "").trim().toLowerCase();
  if (from !== who) return res.status(403).json({ error: "Cannot delete that message." });
  auth.room.chat = auth.room.chat.filter((row) => row.id !== req.params.id);
  auth.room.updatedAt = Date.now();
  writeRoom(auth.room);
  res.json(publicChat(auth.room, auth.user.username));
});

app.post("/api/chat/read", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  const newest = (auth.room.chat || []).reduce((max, item) => Math.max(max, Number(item.at) || 0), 0);
  auth.room.readAt[auth.user.username] = Math.max(Date.now(), newest);
  writeRoom(auth.room);
  res.json(publicChat(auth.room, auth.user.username));
});

app.post("/api/chat/typing", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  auth.room.typing[auth.user.username] = req.body?.on ? Date.now() + 3000 : 0;
  auth.room.presence[auth.user.username] = Date.now();
  writeRoom(auth.room);
  res.json({ ok: true });
});

app.post("/api/presence", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  auth.room.presence[auth.user.username] = Date.now();
  writeRoom(auth.room);
  res.json({ ok: true });
});

app.post("/api/signal", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  const other = auth.room.members.find((name) => name !== auth.user.username);
  if (!other) return res.status(400).json({ error: "No partner in this room." });
  const kind = String(req.body?.kind || "");
  if (!["offer", "answer", "ice", "hangup", "poke"].includes(kind)) {
    return res.status(400).json({ error: "Invalid signal." });
  }
  auth.room.signals.push({
    id: randomBytes(6).toString("hex"),
    from: auth.user.username,
    to: other,
    kind,
    video: Boolean(req.body?.video),
    data: req.body?.data ?? null,
    at: Date.now(),
  });
  auth.room.signals = auth.room.signals.slice(-40);
  writeRoom(auth.room);
  res.json({ ok: true });
});

app.get("/api/signal", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  const mine = auth.room.signals.filter((item) => item.to === auth.user.username);
  auth.room.signals = auth.room.signals.filter((item) => item.to !== auth.user.username);
  if (mine.length) writeRoom(auth.room);
  res.json({ signals: mine });
});

app.post("/api/status", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  const { id, iv, blob, at } = req.body || {};
  if (typeof id !== "string" || id.length < 8 || id.length > 80) {
    return res.status(400).json({ error: "Invalid status." });
  }
  if (typeof iv !== "string" || typeof blob !== "string") {
    return res.status(400).json({ error: "Invalid status." });
  }
  if (blob.length > 1_200_000) return res.status(413).json({ error: "Status is too long." });
  withChat(auth.room);
  const now = Date.now();
  auth.room.statuses = (auth.room.statuses || []).filter((item) => now - Number(item.at || 0) < 86400000);
  auth.room.statuses.push({
    id,
    from: auth.user.username,
    at: Number(at) || now,
    iv,
    blob,
  });
  auth.room.statuses = auth.room.statuses.slice(-20);
  writeRoom(auth.room);
  res.json(publicChat(auth.room, auth.user.username));
});

app.post("/api/disappear", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) return res.status(404).json({ error: "Create a room with your partner first." });
  withChat(auth.room);
  const ms = Number(req.body?.ms || 0);
  auth.room.disappearMs = [0, 86400000, 604800000, 7776000000].includes(ms) ? ms : 0;
  writeRoom(auth.room);
  res.json({ disappearMs: auth.room.disappearMs });
});

function publicPin(pin) {
  if (!pin || !Number.isFinite(Number(pin.lat)) || !Number.isFinite(Number(pin.lng))) return null;
  const heading = Number(pin.heading);
  return {
    lat: Number(pin.lat),
    lng: Number(pin.lng),
    acc: Number(pin.acc || 0),
    heading: Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : null,
    at: Number(pin.at || 0),
  };
}

function pruneOrphanLocations(room, liveIds) {
  withChat(room);
  let dirty = false;
  for (const key of Object.keys(room.locations || {})) {
    if (!liveIds.has(key)) {
      delete room.locations[key];
      dirty = true;
    }
  }
  return dirty;
}

function locationPins(room) {
  withChat(room);
  const { byWho, ids } = liveLogins();
  if (pruneOrphanLocations(room, ids)) writeRoom(room);
  const locs = room.locations || {};
  const pins = [];
  for (const who of COUPLE_MEMBERS) {
    const live = byWho[who];
    if (!live) continue;
    let raw = locs[live.deviceId];
    if (!publicPin(raw)) {
      let newest = null;
      for (const row of Object.values(locs)) {
        if (!row || row.who !== who) continue;
        if (!newest || Number(row.at || 0) >= Number(newest.at || 0)) newest = row;
      }
      raw = newest;
    }
    const pub = publicPin(raw);
    if (!pub) continue;
    pins.push({ ...pub, id: live.deviceId, who });
  }
  return {
    pins,
    present: {
      ba: byWho.ba?.deviceId || null,
      ma: byWho.ma?.deviceId || null,
    },
  };
}

function placePayload(room) {
  const { pins, present } = locationPins(room);
  const ba = pins.find((pin) => pin.who === "ba") || null;
  const ma = pins.find((pin) => pin.who === "ma") || null;
  return {
    ba: ba ? publicPin(ba) : null,
    ma: ma ? publicPin(ma) : null,
    pins,
    present,
  };
}

app.get("/api/location", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  res.json(placePayload(auth.room));
});

app.post("/api/location", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  withChat(auth.room);
  const who = auth.user.username;
  const deviceId = sessionDeviceId(auth.session) || String(req.body?.deviceId || "").slice(0, 80);
  if (deviceId.length < 8) {
    return res.status(400).json({ error: "Location missing." });
  }
  if (req.body?.share === false) {
    delete auth.room.locations[deviceId];
    writeRoom(auth.room);
    return res.json(placePayload(auth.room));
  }
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Location missing." });
  }
  delete auth.room.locations[who];
  const heading = Number(req.body?.heading);
  for (const key of Object.keys(auth.room.locations || {})) {
    if (auth.room.locations[key]?.who === who && key !== deviceId) {
      delete auth.room.locations[key];
    }
  }
  auth.room.locations[deviceId] = {
    lat: Math.round(lat * 1e7) / 1e7,
    lng: Math.round(lng * 1e7) / 1e7,
    acc: Math.max(0, Number(req.body?.acc) || 0),
    heading: Number.isFinite(heading) && heading >= 0 && heading <= 360 ? Math.round(heading * 10) / 10 : null,
    at: Date.now(),
    who,
  };
  writeRoom(auth.room);
  res.json(placePayload(auth.room));
});

const OFM_ORIGIN = "https://tiles.openfreemap.org";
const MAP_UA = "Ba/1.0 (private couple map)";
const mapStyleCache = new Map();
const TILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const TILE_CACHE_MAX_ITEMS = 1600;
const DETAIL_REGIONS = [
  {
    id: "kanke",
    west: 85.25,
    south: 23.36,
    east: 85.4,
    north: 23.5,
    zooms: [12, 13, 14, 15, 16, 17],
  },
  {
    id: "nitk",
    west: 74.778,
    south: 12.992,
    east: 74.822,
    north: 13.038,
    zooms: [13, 14, 15, 16, 17, 18],
  },
  {
    id: "agri-college",
    west: 85.3,
    south: 23.432,
    east: 85.33,
    north: 23.458,
    zooms: [17, 18, 19],
    priority: true,
  },
];
const MISS_TTL_MS = 20 * 60 * 1000;
const MISS_MAX = 20000;
const NATGEO_MAX_Z = 12;
const GRAY_MAX_Z = 16;
const keepAliveHttps = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 20000,
  maxSockets: 48,
  maxFreeSockets: 24,
  scheduling: "lifo",
});
const keepAliveHttp = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 20000,
  maxSockets: 8,
  maxFreeSockets: 4,
  scheduling: "lifo",
});
const tileLru = new Map();
let tileLruBytes = 0;
const tileMissUntil = new Map();
const tileInflight = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tileDiskPath(key) {
  const parts = String(key).split(":");
  if (parts.length !== 4) return null;
  const [kind, z, x, y] = parts;
  if (!/^(sat|pol)$/.test(kind) || ![z, x, y].every((n) => /^\d+$/.test(n))) return null;
  const dir = join(tileDiskDir, kind, z, x);
  return { dir, file: join(dir, `${y}.bin`) };
}

function tileDiskRead(key) {
  const dest = tileDiskPath(key);
  if (!dest || !existsSync(dest.file)) return null;
  try {
    const buf = readFileSync(dest.file);
    if (buf.length < 80) return null;
    const type = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : "image/jpeg";
    return { buf, type, bytes: buf.length, maxAge: 86400 };
  } catch {
    return null;
  }
}

function tileDiskWrite(key, buf) {
  const dest = tileDiskPath(key);
  if (!dest || !buf) return;
  try {
    mkdirSync(dest.dir, { recursive: true });
    writeFileSync(dest.file, buf);
  } catch {
    /* ignore */
  }
}

function tileCacheGet(key) {
  const hit = tileLru.get(key);
  if (hit) {
    tileLru.delete(key);
    tileLru.set(key, hit);
    return hit;
  }
  const disk = tileDiskRead(key);
  if (!disk) return null;
  tileCacheSet(key, disk.buf, disk.type, disk.maxAge, false);
  return tileLru.get(key) || disk;
}

function tileCacheSet(key, buf, type, maxAge = 86400, persist = true) {
  const bytes = buf.length;
  const old = tileLru.get(key);
  if (old) {
    tileLruBytes -= old.bytes;
    tileLru.delete(key);
  }
  while (tileLru.size && (tileLruBytes + bytes > TILE_CACHE_MAX_BYTES || tileLru.size >= TILE_CACHE_MAX_ITEMS)) {
    const first = tileLru.keys().next().value;
    const evicted = tileLru.get(first);
    tileLru.delete(first);
    if (evicted) tileLruBytes -= evicted.bytes;
  }
  tileLru.set(key, { buf, type, bytes, maxAge });
  tileLruBytes += bytes;
  if (persist) setImmediate(() => tileDiskWrite(key, buf));
}

function isKnownMiss(source, z, x, y) {
  const key = `${source}:${z}:${x}:${y}`;
  const exp = tileMissUntil.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    tileMissUntil.delete(key);
    return false;
  }
  return true;
}

function rememberMiss(source, z, x, y) {
  if (tileMissUntil.size >= MISS_MAX) {
    const now = Date.now();
    for (const [key, exp] of tileMissUntil) {
      if (exp <= now) tileMissUntil.delete(key);
      if (tileMissUntil.size < MISS_MAX * 0.75) break;
    }
    if (tileMissUntil.size >= MISS_MAX) tileMissUntil.delete(tileMissUntil.keys().next().value);
  }
  tileMissUntil.set(`${source}:${z}:${x}:${y}`, Date.now() + MISS_TTL_MS);
}

function shareWork(key, fn) {
  const hit = tileInflight.get(key);
  if (hit) return hit;
  const pending = Promise.resolve()
    .then(fn)
    .finally(() => tileInflight.delete(key));
  tileInflight.set(key, pending);
  return pending;
}

function rewriteOfmUrls(value) {
  if (typeof value === "string") {
    return value.replace(/https?:\/\/tiles\.openfreemap\.org/gi, "/api/map/ofm");
  }
  if (Array.isArray(value)) return value.map(rewriteOfmUrls);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, next] of Object.entries(value)) out[key] = rewriteOfmUrls(next);
    return out;
  }
  return value;
}

function publicApiBase(req) {
  const fromEnv = String(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

/** MapLibre resolves root-relative tile URLs against the app origin, not this API. */
function withAbsoluteApiPaths(value, base) {
  if (!base) return value;
  if (typeof value === "string") {
    if (value.startsWith("/api/map")) return `${base}${value}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => withAbsoluteApiPaths(item, base));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, next] of Object.entries(value)) out[key] = withAbsoluteApiPaths(next, base);
    return out;
  }
  return value;
}

function fetchUpstream(url, accept, timeoutMs = 8000, hops = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("url"));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const agent = parsed.protocol === "http:" ? keepAliveHttp : keepAliveHttps;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        agent,
        headers: {
          "User-Agent": MAP_UA,
          Accept: accept || "*/*",
          Connection: "keep-alive",
        },
      },
      (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && hops < 3) {
          resp.resume();
          const next = new URL(resp.headers.location, url).href;
          fetchUpstream(next, accept, timeoutMs, hops + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        resp.on("data", (chunk) => chunks.push(chunk));
        resp.on("error", reject);
        resp.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: resp.statusCode >= 200 && resp.statusCode < 300,
            status: resp.statusCode,
            headers: {
              get(name) {
                const value = resp.headers[String(name).toLowerCase()];
                return Array.isArray(value) ? value[0] : value || null;
              },
            },
            arrayBuffer: async () => buf,
            json: async () => JSON.parse(buf.toString("utf8")),
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchOfmOrNull(key, ms = 700) {
  try {
    return await Promise.race([
      fetchOfmStyle(key),
      sleep(ms).then(() => Promise.reject(new Error("ofm-timeout"))),
    ]);
  } catch {
    return null;
  }
}

function warmMapStyle(key, loader) {
  loader()
    .then((style) => mapStyleCache.set(key, { at: Date.now(), style }))
    .catch(() => {});
}

async function proxyImage(res, urls) {
  for (const url of urls) {
    try {
      const img = await fetchUpstream(url, "image/png,image/jpeg,image/*");
      if (!img.ok) continue;
      const type = String(img.headers.get("content-type") || "");
      if (type && !type.startsWith("image/") && !type.includes("octet-stream")) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length < 80) continue;
      res.setHeader("Content-Type", type.startsWith("image/") ? type : "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buf);
    } catch {
      /* try next */
    }
  }
  res.status(502).end();
}

function isOfmNameLayer(layer) {
  if (!layer || layer.type !== "symbol") return false;
  const id = String(layer.id || "").toLowerCase();
  const src = String(layer["source-layer"] || "").toLowerCase();
  if (/oneway|one_way|shield|arrow/.test(id)) return false;
  return (
    /^(place|poi|transportation_name|aerodrome_label|water_name|waterway)$/.test(src) ||
    /name|label|place|poi|highway-name|highway_name|airport|water/.test(id)
  );
}

function ofmNameLayers(style) {
  return (Array.isArray(style?.layers) ? style.layers : []).filter(isOfmNameLayer);
}

function mergeOfmNameLayers(primary, extra) {
  const out = [];
  const haveId = new Set();
  const haveSrc = new Set();
  for (const layer of ofmNameLayers(primary)) {
    out.push(layer);
    haveId.add(layer.id);
    haveSrc.add(String(layer["source-layer"] || "").toLowerCase());
  }
  for (const layer of ofmNameLayers(extra)) {
    if (haveId.has(layer.id)) continue;
    const src = String(layer["source-layer"] || "").toLowerCase();
    if (haveSrc.has(src) && src !== "poi" && src !== "aerodrome_label") continue;
    out.push(layer);
    haveId.add(layer.id);
    haveSrc.add(src);
  }
  return out;
}

function enhanceMapStyle(style, _dark, extraStyle) {
  const next = rewriteOfmUrls(style);
  const extra = extraStyle ? rewriteOfmUrls(extraStyle) : null;
  const names = mergeOfmNameLayers(next, extra);
  const openmaptiles = next.sources?.openmaptiles;
  next.sources = {
    baRaster: {
      type: "raster",
      tiles: ["/api/map/{z}/{x}/{y}?v=9"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap",
    },
    baSat: {
      type: "raster",
      tiles: ["/api/map/sat/{z}/{x}/{y}?v=2"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri",
    },
  };
  if (openmaptiles) next.sources.openmaptiles = openmaptiles;
  next.layers = [
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
    ...names,
  ];
  return next;
}

async function fetchOfmStyle(key) {
  const upstream = await fetchUpstream(`${OFM_ORIGIN}/styles/${key}`, "application/json");
  if (!upstream.ok) throw new Error("style");
  return upstream.json();
}

function politicalNameField() {
  return [
    "coalesce",
    ["get", "name:en"],
    ["get", "name_en"],
    ["get", "name:latin"],
    ["get", "name"],
  ];
}

function politicalMapStyle(ofm) {
  const next = ofm ? rewriteOfmUrls(ofm) : {};
  const style = {
    version: 8,
    glyphs: next.glyphs || "/api/map/ofm/fonts/{fontstack}/{range}.pbf",
    sources: {
      baPolitical: {
        type: "raster",
        tiles: ["/api/map/political/{z}/{x}/{y}?v=6"],
        tileSize: 256,
        maxzoom: 17,
        attribution: "© OpenStreetMap",
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
  if (next.sources?.openmaptiles) {
    style.sources.openmaptiles = next.sources.openmaptiles;
    const text = "#2a1f16";
    const halo = "rgba(255, 255, 255, 0.92)";
    style.layers.push(
      {
        id: "boundary-state",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        minzoom: 3,
        filter: ["match", ["to-string", ["coalesce", ["get", "admin_level"], ""]], ["3", "4"], true, false],
        paint: {
          "line-color": "#8d6240",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 8, 1.6],
        },
      },
      {
        id: "boundary-country",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["==", ["to-string", ["coalesce", ["get", "admin_level"], ""]], "2"],
        paint: {
          "line-color": "#5a3a28",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.2, 6, 2.4],
        },
      },
      {
        id: "label-country",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 1,
        maxzoom: 8,
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": politicalNameField(),
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 12, 5, 18],
          "text-transform": "uppercase",
          "text-max-width": 8,
        },
        paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.6 },
      },
      {
        id: "label-state",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 3,
        maxzoom: 10,
        filter: ["==", ["get", "class"], "state"],
        layout: {
          "text-field": politicalNameField(),
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 7, 15],
          "text-max-width": 8,
        },
        paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.5 },
      },
      {
        id: "label-city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 4,
        filter: ["match", ["get", "class"], ["city", "town"], true, false],
        layout: {
          "text-field": politicalNameField(),
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 10, 14],
          "text-max-width": 8,
        },
        paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.4 },
      }
    );
  }
  return style;
}

app.get("/api/map/style", async (req, res) => {
  const dark = String(req.query.t || "") !== "day";
  const apiBase = publicApiBase(req);
  if (String(req.query.k || "") === "political") {
    const style = withAbsoluteApiPaths(politicalMapStyle(null), apiBase);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json(style);
  }
  const key = dark ? "dark-labels" : "liberty-labels";
  const hit = mapStyleCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json(withAbsoluteApiPaths(hit.style, apiBase));
  }
  const raw = await fetchOfmOrNull(dark ? "dark" : "liberty", 700);
  if (!raw) {
    warmMapStyle(key, async () => {
      const next = await fetchOfmStyle(dark ? "dark" : "liberty");
      let extra = null;
      if (dark) {
        try {
          extra = await fetchOfmStyle("liberty");
        } catch {
          extra = null;
        }
      }
      return enhanceMapStyle(next, dark, extra);
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(withAbsoluteApiPaths(enhanceMapStyle({ version: 8, sources: {}, layers: [] }, dark, null), apiBase));
  }
  let extra = null;
  if (dark) extra = await fetchOfmOrNull("liberty", 400);
  const style = enhanceMapStyle(raw, dark, extra);
  mapStyleCache.set(key, { at: Date.now(), style });
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(withAbsoluteApiPaths(style, apiBase));
});

const SAT_MAX_Z = 19;
const SAT_PLACEHOLDER_MAX = 4000;
const SAT_PLACEHOLDER_HASHES = new Set([
  "9eafd300d61393184a4abc1d458564cfd1cd9b6f9c4e9c74687045c0a0e5b858",
]);
const SAT_CROP_PY = [
  "import io,sys",
  "from PIL import Image",
  "data=sys.stdin.buffer.read()",
  "im=Image.open(io.BytesIO(data)).convert('RGB')",
  "w,h=im.size",
  "dz=int(sys.argv[1]); fx=float(sys.argv[2]); fy=float(sys.argv[3])",
  "span=1.0/(2**dz)",
  "box=(fx*w, fy*h, (fx+span)*w, (fy+span)*h)",
  "out=io.BytesIO()",
  "im.crop((int(box[0]),int(box[1]),int(box[2]),int(box[3]))).resize((256,256), Image.LANCZOS).save(out, format='JPEG', quality=86, optimize=True)",
  "sys.stdout.buffer.write(out.getvalue())",
].join(";");

function satHash(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function isUnavailableSat(buf) {
  if (!buf || buf.length < 80) return true;
  if (SAT_PLACEHOLDER_HASHES.has(satHash(buf))) return true;
  return buf.length <= SAT_PLACEHOLDER_MAX;
}

function isUnavailableOsm(buf) {
  return !buf || buf.length < 80;
}

function isUnavailableStreet(buf) {
  if (!buf || buf.length < 80) return true;
  if (SAT_PLACEHOLDER_HASHES.has(satHash(buf))) return true;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  return jpeg && buf.length <= SAT_PLACEHOLDER_MAX;
}

function tileLooksUnavailable(source, buf) {
  if (source === "osm") return isUnavailableOsm(buf);
  if (source === "esri-street") return isUnavailableStreet(buf);
  return isUnavailableSat(buf);
}

function esriSatUrl(z, x, y) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

function osmTileUrl(z, x, y) {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function osmTileUrls(z, x, y) {
  return [
    `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  ];
}

function esriStreetUrl(z, x, y) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
}

async function fetchTileBuf(url) {
  const img = await fetchUpstream(url, "image/png,image/jpeg,image/*", 7000);
  if (!img.ok) return null;
  const type = String(img.headers.get("content-type") || "");
  if (type && !type.startsWith("image/") && !type.includes("octet-stream")) return null;
  const buf = Buffer.from(await img.arrayBuffer());
  if (buf.length < 80) return null;
  return { buf, type: type.startsWith("image/") ? type : "image/jpeg" };
}

async function fetchSourcedTile(source, z, x, y, url) {
  if (isKnownMiss(source, z, x, y)) return null;
  return shareWork(`fetch:${source}:${z}:${x}:${y}`, async () => {
    if (isKnownMiss(source, z, x, y)) return null;
    try {
      const tile = await fetchTileBuf(url);
      if (!tile) return null;
      if (tileLooksUnavailable(source, tile.buf)) {
        rememberMiss(source, z, x, y);
        return null;
      }
      return tile;
    } catch {
      return null;
    }
  });
}

function cropSatParent(parentBuf, dz, fx, fy) {
  return new Promise((resolve) => {
    const proc = spawn("python3", ["-c", SAT_CROP_PY, String(dz), String(fx), String(fy)], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve(null);
    }, 4000);
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const out = Buffer.concat(chunks);
      resolve(out.length > 200 ? out : null);
    });
    proc.stdin.end(parentBuf);
  });
}

function sendTile(req, res, buf, type, maxAge = 86400) {
  const etag = `"${satHash(buf).slice(0, 16)}"`;
  res.setHeader("Content-Type", type || "image/jpeg");
  res.setHeader("Cache-Control", `public, max-age=${maxAge}, immutable`);
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  return res.send(buf);
}

function natgeoUrl(z, x, y) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/${z}/${y}/${x}`;
}

function grayUrl(z, x, y) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
}

function ancestorOf(z, x, y, dz) {
  const scale = 2 ** dz;
  const ax = Math.floor(x / scale);
  const ay = Math.floor(y / scale);
  return { az: z - dz, ax, ay, fx: x / scale - ax, fy: y / scale - ay, dz };
}

async function cropFromParent(parentBuf, dz, fx, fy, opts = {}) {
  const cropped = await cropSatParent(parentBuf, dz, fx, fy);
  if (!cropped) return null;
  if (opts.allowSmall ? cropped.length < 80 : isUnavailableSat(cropped)) return null;
  return { buf: cropped, type: "image/jpeg", maxAge: 86400 };
}

function politicalSources(z, x, y) {
  const out = [];
  if (z <= NATGEO_MAX_Z) out.push({ source: "natgeo", url: natgeoUrl(z, x, y) });
  if (z <= GRAY_MAX_Z) out.push({ source: "gray", url: grayUrl(z, x, y) });
  return out;
}

function satParentZooms(z) {
  const order = [];
  const add = (az) => {
    if (az >= 0 && az < z && z - az <= 6 && !order.includes(az)) order.push(az);
  };
  if (z > 16) add(16);
  for (let dz = 1; dz <= 6 && z - dz >= 0; dz += 1) add(z - dz);
  return order;
}

function politicalParentZooms(z) {
  const order = [];
  const add = (az) => {
    if (az >= 0 && az < z && z - az <= 6 && !order.includes(az)) order.push(az);
  };
  for (let dz = 1; dz <= 6 && z - dz >= 0; dz += 1) add(z - dz);
  if (z > GRAY_MAX_Z) add(GRAY_MAX_Z);
  if (z > NATGEO_MAX_Z) add(NATGEO_MAX_Z);
  return order;
}

async function replyCachedOrResolved(req, res, key, resolver) {
  const cached = tileCacheGet(key);
  if (cached) return sendTile(req, res, cached.buf, cached.type, cached.maxAge);
  try {
    const tile = await shareWork(key, async () => {
      const again = tileCacheGet(key);
      if (again) return again;
      const resolved = await resolver();
      if (resolved) tileCacheSet(key, resolved.buf, resolved.type, resolved.maxAge || 86400);
      return resolved;
    });
    if (tile) return sendTile(req, res, tile.buf, tile.type, tile.maxAge || 86400);
  } catch {
    /* fall through */
  }
  res.status(204).end();
}

async function fetchOsmFromUrl(url) {
  try {
    const img = await fetchUpstream(url, "image/png,image/jpeg,image/*", 1600);
    if (img.status === 429 || img.status === 503) return { tile: null, limited: true };
    if (!img.ok) return { tile: null, limited: false };
    const type = String(img.headers.get("content-type") || "");
    if (type && !type.startsWith("image/") && !type.includes("octet-stream")) {
      return { tile: null, limited: false };
    }
    const buf = Buffer.from(await img.arrayBuffer());
    if (isUnavailableOsm(buf)) return { tile: null, limited: false };
    return {
      tile: { buf, type: type.startsWith("image/") ? type : "image/png", maxAge: 3600 },
      limited: false,
    };
  } catch {
    return { tile: null, limited: true };
  }
}

async function fetchOsmTileOnce(z, x, y) {
  if (isKnownMiss("osm", z, x, y)) return { tile: null, limited: false };
  return shareWork(`fetch:osm:${z}:${x}:${y}`, async () => {
    if (isKnownMiss("osm", z, x, y)) return { tile: null, limited: false };
    const urls = osmTileUrls(z, x, y);
    try {
      return await Promise.any(
        urls.map(async (url) => {
          const next = await fetchOsmFromUrl(url);
          if (next.tile) return next;
          return Promise.reject(new Error(next.limited ? "limited" : "empty"));
        })
      );
    } catch (error) {
      const limited = String(error?.message || "").includes("limited") || Boolean(error?.errors?.some?.((err) => String(err?.message || "").includes("limited")));
      return { tile: null, limited };
    }
  });
}

async function fetchOsmTile(z, x, y) {
  const first = await fetchOsmTileOnce(z, x, y);
  if (first.tile) return first.tile;
  return null;
}

async function cropPoliticalFromCachedOsm(z, x, y) {
  for (const az of politicalParentZooms(z)) {
    const a = ancestorOf(z, x, y, z - az);
    const hit = tileCacheGet(`pol:${a.az}:${a.ax}:${a.ay}`);
    if (!hit || isUnavailableOsm(hit.buf)) continue;
    const cropped = await cropFromParent(hit.buf, a.dz, a.fx, a.fy, { allowSmall: true });
    if (cropped) return cropped;
  }
  return null;
}

async function firstGoodTile(primaryPromise, fallbackFn, waitMs) {
  let settled = false;
  const primary = primaryPromise.then((tile) => {
    settled = true;
    return tile;
  });
  const raced = await Promise.race([primary, sleep(waitMs).then(() => "slow")]);
  if (raced && raced !== "slow") return raced;
  if (settled) return fallbackFn();
  try {
    return await Promise.any([
      primary.then((tile) => tile || Promise.reject(new Error("empty"))),
      fallbackFn().then((tile) => tile || Promise.reject(new Error("empty"))),
    ]);
  } catch {
    return null;
  }
}

async function resolvePoliticalTile(z, x, y) {
  const osmP = fetchOsmTile(z, x, y);
  const cropped = await cropPoliticalFromCachedOsm(z, x, y);
  const waitMs = cropped ? 90 : 1600;
  const osm = await Promise.race([osmP, sleep(waitMs).then(() => null)]);
  if (osm) return osm;
  if (cropped) {
    osmP.then((tile) => {
      if (tile) tileCacheSet(`pol:${z}:${x}:${y}`, tile.buf, tile.type, tile.maxAge || 3600);
    });
    return cropped;
  }
  const late = await osmP;
  if (late) return late;
  const esri = await fetchSourcedTile("esri-street", z, x, y, esriStreetUrl(z, x, y));
  if (esri) return { ...esri, maxAge: 86400 };
  return null;
}

async function resolveSatTile(z, x, y) {
  const native = await fetchSourcedTile("esri-sat", z, x, y, esriSatUrl(z, x, y));
  if (native) {
    tileCacheSet(`sat:${z}:${x}:${y}`, native.buf, native.type);
    return { ...native, maxAge: 86400 };
  }

  const cropCached = async () => {
    for (const az of satParentZooms(z)) {
      const a = ancestorOf(z, x, y, z - az);
      const hit = tileCacheGet(`sat:${a.az}:${a.ax}:${a.ay}`);
      if (!hit || isUnavailableSat(hit.buf)) continue;
      const cropped = await cropFromParent(hit.buf, a.dz, a.fx, a.fy);
      if (cropped) return cropped;
    }
    return null;
  };

  const cachedParent = await cropCached();
  if (cachedParent) return cachedParent;

  const fetchParents = async () => {
    for (const az of satParentZooms(z)) {
      const a = ancestorOf(z, x, y, z - az);
      const parentKey = `sat:${a.az}:${a.ax}:${a.ay}`;
      const hit = tileCacheGet(parentKey);
      if (hit && !isUnavailableSat(hit.buf)) {
        const cropped = await cropFromParent(hit.buf, a.dz, a.fx, a.fy);
        if (cropped) return cropped;
      }
      if (isKnownMiss("esri-sat", a.az, a.ax, a.ay)) continue;
      const parent = await fetchSourcedTile("esri-sat", a.az, a.ax, a.ay, esriSatUrl(a.az, a.ax, a.ay));
      if (!parent) continue;
      tileCacheSet(parentKey, parent.buf, parent.type);
      const cropped = await cropFromParent(parent.buf, a.dz, a.fx, a.fy);
      if (cropped) return cropped;
    }
    return null;
  };

  return firstGoodTile(fetchParents(), () => fetchOsmTile(z, x, y), 700);
}

app.get("/api/map/political/:z/:x/:y", async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 19) {
    return res.status(400).end();
  }
  return replyCachedOrResolved(req, res, `pol:${z}:${x}:${y}`, () => resolvePoliticalTile(z, x, y));
});

app.get("/api/map/sat/:z/:x/:y", async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > SAT_MAX_Z) {
    return res.status(400).end();
  }
  return replyCachedOrResolved(req, res, `sat:${z}:${x}:${y}`, () => resolveSatTile(z, x, y));
});

function lngToTileX(lng, z) {
  return Math.floor(((Number(lng) + 180) / 360) * 2 ** z);
}

function latToTileY(lat, z) {
  const r = (Number(lat) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tilesInBbox(region, z) {
  const x0 = lngToTileX(region.west, z);
  const x1 = lngToTileX(region.east, z);
  const y0 = latToTileY(region.north, z);
  const y1 = latToTileY(region.south, z);
  const out = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
      out.push({ z, x, y });
    }
  }
  return out;
}

function detailWarmJobs() {
  const jobs = [];
  const seen = new Set();
  const regions = [...DETAIL_REGIONS].sort((a, b) => Number(!!b.priority) - Number(!!a.priority));
  for (const region of regions) {
    for (const z of region.zooms) {
      for (const tile of tilesInBbox(region, z)) {
        const id = `${tile.z}:${tile.x}:${tile.y}`;
        if (seen.has(id) && !region.priority) continue;
        seen.add(id);
        jobs.push({ ...tile, priority: Boolean(region.priority) });
      }
    }
  }
  return jobs;
}

function tileDiskHas(key) {
  const dest = tileDiskPath(key);
  return Boolean(dest && existsSync(dest.file));
}

async function warmOneCell(tile) {
  const satKey = `sat:${tile.z}:${tile.x}:${tile.y}`;
  const polKey = `pol:${tile.z}:${tile.x}:${tile.y}`;
  if (!tileDiskHas(satKey)) {
    const sat = await resolveSatTile(tile.z, tile.x, tile.y);
    if (sat) tileDiskWrite(satKey, sat.buf);
  }
  if (!tileDiskHas(polKey)) {
    const pol = await resolvePoliticalTile(tile.z, tile.x, tile.y);
    if (pol) tileDiskWrite(polKey, pol.buf);
  }
}

async function warmDetailPacks() {
  const jobs = detailWarmJobs();
  let i = 0;
  const workers = 2;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (i < jobs.length) {
        const tile = jobs[i];
        i += 1;
        try {
          await warmOneCell(tile);
        } catch {
          /* skip */
        }
      }
    })
  );
  console.log(`Ba map packs ready (${jobs.length} cells)`);
}

app.get("/api/map/ofm/*", async (req, res) => {
  const sub = decodeURIComponent(String(req.params[0] || "").replace(/^\/+/, ""));
  if (!sub || sub.includes("..") || !/^[a-zA-Z0-9._/\- ]+$/.test(sub)) {
    return res.status(400).end();
  }
  try {
    const upstream = await fetchUpstream(`${OFM_ORIGIN}/${sub}`, req.headers.accept || "*/*");
    if (!upstream.ok) return res.status(upstream.status).end();
    const type = String(upstream.headers.get("content-type") || "application/octet-stream");
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (type.includes("json") || sub === "planet" || sub.endsWith(".json")) {
      try {
        const parsed = rewriteOfmUrls(JSON.parse(buf.toString("utf8")));
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.json(parsed);
      } catch {
        /* binary fallback */
      }
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

app.get("/api/map/:z/:x/:y", async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 19) {
    return res.status(400).end();
  }
  const urls = [
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  ];
  await proxyImage(res, urls);
});

app.delete("/api/account", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const ip = req.ip || "local";
  if (!rateLimit(`delete:${ip}`, 8, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many tries. Wait a bit." });
  }
  const code = String(req.body?.code ?? req.body?.pin ?? "");
  if (!pairCodeOk(code)) {
    return res.status(401).json({ error: "That code is wrong." });
  }
  wipeAccount({
    username: auth.user.username,
    roomId: auth.session.roomId || auth.room?.id || COUPLE_ROOM_ID,
  });
  const room = ensureCoupleRoom();
  if (!room.devices || typeof room.devices !== "object") room.devices = {};
  for (const name of readdirSync(sessionsDir)) {
    try {
      const sess = JSON.parse(readFileSync(join(sessionsDir, name), "utf8"));
      if (COUPLE_MEMBERS.includes(sess.username) && sess.deviceId) {
        room.devices[sess.deviceId] = sess.username;
      }
    } catch {
      /* ignore */
    }
  }
  writeRoom(room);
  res.json({ ok: true });
});

function forgetDevice(deviceId) {
  const id = String(deviceId || "").slice(0, 80);
  if (id.length < 8) return;
  const room = ensureCoupleRoom();
  if (!room.devices || typeof room.devices !== "object") room.devices = {};
  delete room.devices[id];
  if (room.locations && typeof room.locations === "object") delete room.locations[id];
  writeRoom(room);
  for (const name of readdirSync(sessionsDir)) {
    try {
      const sess = JSON.parse(readFileSync(join(sessionsDir, name), "utf8"));
      if (sess.deviceId === id) unlinkSync(join(sessionsDir, name));
    } catch {
      /* ignore */
    }
  }
}

app.post("/api/logout", (req, res) => {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let deviceId = "";
  if (token) {
    const session = readSession(hashHex(token));
    if (session?.deviceId) deviceId = String(session.deviceId).slice(0, 80);
    const file = join(sessionsDir, `${hashHex(token)}.json`);
    if (existsSync(file)) unlinkSync(file);
  }
  if (deviceId.length < 8) deviceId = String(req.body?.deviceId || "").slice(0, 80);
  forgetDevice(deviceId);
  res.json({ ok: true });
});

const dist = join(root, "..", "dist");

function clientBuildId() {
  try {
    return createHash("sha1").update(readFileSync(join(dist, "index.html"))).digest("hex").slice(0, 16);
  } catch {
    return "0";
  }
}

app.get("/api/build", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ v: clientBuildId() });
});

if (existsSync(dist)) {
  app.use(
    express.static(dist, {
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-store");
        else if (/\.[a-zA-Z0-9_-]{8}\.(js|css)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(join(dist, "index.html"));
  });
}

pruneSessions();
setInterval(pruneSessions, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ba server on http://127.0.0.1:${PORT}`);
});
