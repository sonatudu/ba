import cors from "cors";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import express from "express";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const usersDir = join(dataDir, "users");
const roomsDir = join(dataDir, "rooms");
const sessionsDir = join(dataDir, "sessions");
const requestsDir = join(dataDir, "requests");
mkdirSync(usersDir, { recursive: true });
mkdirSync(roomsDir, { recursive: true });
mkdirSync(sessionsDir, { recursive: true });
mkdirSync(requestsDir, { recursive: true });

const PORT = Number(process.env.PORT || 8787);
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

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
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value));
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
  return readJson(roomPath(roomId));
}

function writeRoom(room) {
  writeJson(roomPath(room.id), room);
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

function issueToken(username, roomId) {
  const token = randomBytes(32).toString("hex");
  writeSession({
    tokenHash: hashHex(token),
    username,
    roomId: roomId || null,
    expiresAt: Date.now() + SESSION_MS,
  });
  return token;
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
  };
}

function requireAuth(req, res) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Please log in." });
    return null;
  }
  const session = readSession(hashHex(token));
  if (!session) {
    res.status(401).json({ error: "Please log in." });
    return null;
  }
  const user = readUser(session.username);
  if (!user) {
    res.status(401).json({ error: "Please log in." });
    return null;
  }
  const room = user.roomId ? readRoom(user.roomId) : null;
  return { session, user, room };
}

function withChat(room) {
  if (!Array.isArray(room.chat)) room.chat = [];
  if (!room.readAt || typeof room.readAt !== "object") room.readAt = {};
  if (!room.deliveredAt || typeof room.deliveredAt !== "object") room.deliveredAt = {};
  if (!room.typing || typeof room.typing !== "object") room.typing = {};
  if (!room.presence || typeof room.presence !== "object") room.presence = {};
  if (!Array.isArray(room.signals)) room.signals = [];
  if (!Array.isArray(room.statuses)) room.statuses = [];
  if (!Number.isFinite(room.disappearMs)) room.disappearMs = 0;
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

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "3mb" }));

app.post("/api/register", (req, res) => {
  const ip = req.ip || "local";
  if (!rateLimit(`register:${ip}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many accounts. Try later." });
  }
  const username = normalizeUser(req.body?.username);
  const password = String(req.body?.password || "");
  if (!validUser(username)) {
    return res.status(400).json({ error: "Username must be 3–24 letters, numbers, or _." });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Password needs at least 4 characters." });
  }
  if (readUser(username)) {
    return res.status(409).json({ error: "That username is already taken." });
  }
  const passSalt = randomBytes(16).toString("hex");
  writeUser({
    username,
    passSalt,
    passHash: scrypt(password, passSalt),
    roomId: null,
    createdAt: Date.now(),
  });
  res.json({ token: issueToken(username, null), username, roomId: null });
});

app.post("/api/login", (req, res) => {
  const ip = req.ip || "local";
  if (!rateLimit(`login:${ip}`, 20, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many login tries. Wait a bit." });
  }
  const username = normalizeUser(req.body?.username);
  const password = String(req.body?.password || "");
  const user = readUser(username);
  if (!user || !safeEqual(user.passHash, scrypt(password, user.passSalt))) {
    return res.status(401).json({ error: "Username or password is wrong." });
  }
  if (!user.roomId) {
    return res.json({ token: issueToken(username, null), username, roomId: null });
  }
  const room = readRoom(user.roomId);
  if (!room || !room.members.includes(username)) {
    return res.json({ token: issueToken(username, null), username, roomId: null });
  }
  const token = issueToken(username, room.id);
  res.json({ token, username, ...publicRoom(room, username) });
});

app.post("/api/requests", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (auth.user.roomId) {
    return res.status(409).json({ error: "You already have a room." });
  }
  const partnerName = normalizeUser(req.body?.partner);
  const message = String(req.body?.message || "").trim().slice(0, 500);
  const wantedId = String(req.body?.roomId || "")
    .trim()
    .toUpperCase();
  if (!partnerName) {
    return res.status(400).json({ error: "Add your partner’s username." });
  }
  if (partnerName === auth.user.username) {
    return res.status(400).json({ error: "Add your partner, not yourself." });
  }
  const partner = readUser(partnerName);
  if (!partner) {
    return res.status(404).json({ error: "That username does not exist yet." });
  }
  const duplicate = allRequests().find(
    (item) =>
      (item.from === auth.user.username && item.to === partnerName) ||
      (item.from === partnerName && item.to === auth.user.username)
  );
  if (duplicate) {
    return res.status(409).json({ error: "A request is already waiting between you two." });
  }
  let roomId = wantedId;
  if (roomId) {
    if (!/^[A-Z0-9-]{6,24}$/.test(roomId)) {
      return res.status(400).json({ error: "Room id can be letters, numbers, and dashes." });
    }
    if (roomIdReserved(roomId)) {
      return res.status(409).json({ error: "That room id is already taken." });
    }
  } else {
    roomId = uniqueRoomId();
  }
  const item = {
    id: randomBytes(8).toString("hex"),
    from: auth.user.username,
    to: partnerName,
    roomId,
    message,
    createdAt: Date.now(),
  };
  writeRequest(item);
  res.json(publicRequest(item));
});

app.get("/api/requests", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const mine = allRequests().filter((item) => item.from === auth.user.username || item.to === auth.user.username);
  const incoming = auth.user.roomId
    ? []
    : mine.filter((item) => item.to === auth.user.username).map(publicRequest);
  res.json({
    incoming,
    outgoing: mine.filter((item) => item.from === auth.user.username).map(publicRequest),
  });
});

app.post("/api/requests/:id/accept", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (auth.user.roomId) {
    return res.status(409).json({ error: "You already have a room." });
  }
  const item = readRequest(req.params.id);
  if (!item || item.to !== auth.user.username) {
    return res.status(404).json({ error: "Request not found." });
  }
  const fromUser = readUser(item.from);
  if (!fromUser || fromUser.roomId) {
    deleteRequest(item.id);
    return res.status(409).json({ error: "That request is no longer valid." });
  }
  if (roomExists(item.roomId)) {
    return res.status(409).json({ error: "That room id is already taken." });
  }
  const room = finishRoom(fromUser, auth.user, item.roomId);
  const token = issueToken(auth.user.username, room.id);
  res.json({ token, username: auth.user.username, ...publicRoom(room, auth.user.username) });
});

app.post("/api/requests/:id/decline", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const item = readRequest(req.params.id);
  if (!item || (item.to !== auth.user.username && item.from !== auth.user.username)) {
    return res.status(404).json({ error: "Request not found." });
  }
  deleteRequest(item.id);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!auth.room) {
    return res.json({ tokenNeeded: false, username: auth.user.username, roomId: null });
  }
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
  withChat(auth.room);
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
  if (!["offer", "answer", "ice", "hangup"].includes(kind)) {
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

app.delete("/api/account", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const ip = req.ip || "local";
  if (!rateLimit(`delete:${ip}`, 8, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many tries. Wait a bit." });
  }
  const password = String(req.body?.password || "");
  if (!safeEqual(auth.user.passHash, scrypt(password, auth.user.passSalt))) {
    return res.status(401).json({ error: "Password is wrong." });
  }
  wipeAccount(auth.user);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    const file = join(sessionsDir, `${hashHex(token)}.json`);
    if (existsSync(file)) unlinkSync(file);
  }
  res.json({ ok: true });
});

const dist = join(root, "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(dist, "index.html"));
  });
}

pruneSessions();
setInterval(pruneSessions, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ba server on http://127.0.0.1:${PORT}`);
});
