import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { existsSync, readFileSync } from "fs";

let messaging = null;
let initAttempted = false;

function repairJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const candidates = [text];
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 80 && !text.startsWith("{")) {
    try {
      candidates.push(Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8"));
    } catch {
      /* not base64 */
    }
  }
  for (const candidate of candidates) {
    const stripped = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^['"]/, "")
      .replace(/['"]$/, "");
    try {
      return JSON.parse(stripped);
    } catch {
      /* try escaped newlines inside strings */
    }
    let out = "";
    let inStr = false;
    let esc = false;
    for (const ch of stripped) {
      if (inStr) {
        if (esc) {
          out += ch;
          esc = false;
          continue;
        }
        if (ch === "\\") {
          out += ch;
          esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = false;
          out += ch;
          continue;
        }
        if (ch === "\n") {
          out += "\\n";
          continue;
        }
        if (ch === "\r") continue;
        out += ch;
        continue;
      }
      if (ch === '"') inStr = true;
      out += ch;
    }
    try {
      return JSON.parse(out);
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function readSecretFile() {
  const paths = [
    String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || "").trim(),
    "/etc/secrets/firebase.json",
    "/etc/secrets/FIREBASE_SERVICE_ACCOUNT",
  ].filter(Boolean);
  for (const file of paths) {
    if (!existsSync(file)) continue;
    try {
      const parsed = repairJson(readFileSync(file, "utf8"));
      if (parsed) return parsed;
    } catch {
      /* next path */
    }
  }
  return null;
}

function parseServiceAccount() {
  const fromEnv = repairJson(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_B64 || "");
  if (fromEnv) return fromEnv;
  const fromFile = readSecretFile();
  if (fromFile) return fromFile;
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "ba-app-4147a").trim();
  if (clientEmail && privateKey.includes("BEGIN PRIVATE KEY")) {
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  }
  return null;
}

export function pushConfigured() {
  return Boolean(parseServiceAccount());
}

function initFirebase() {
  if (messaging) return messaging;
  if (initAttempted) return null;
  initAttempted = true;
  const cred = parseServiceAccount();
  if (!cred) {
    console.log("[push] Firebase credentials missing; set FIREBASE_SERVICE_ACCOUNT or secret file firebase.json");
    return null;
  }
  try {
    if (!getApps().length) initializeApp({ credential: cert(cred) });
    messaging = getMessaging();
    console.log("[push] Firebase messaging ready");
    return messaging;
  } catch (err) {
    console.error("[push] could not init Firebase:", err.message);
    return null;
  }
}

export function withPushTokens(room) {
  if (!room.pushTokens || typeof room.pushTokens !== "object") room.pushTokens = { ba: {}, ma: {} };
  if (!room.pushTokens.ba || typeof room.pushTokens.ba !== "object") room.pushTokens.ba = {};
  if (!room.pushTokens.ma || typeof room.pushTokens.ma !== "object") room.pushTokens.ma = {};
  return room;
}

export function savePushToken(room, who, deviceId, token) {
  withPushTokens(room);
  if (who !== "ba" && who !== "ma") return false;
  const id = String(deviceId || "").slice(0, 80);
  const value = String(token || "").trim();
  if (id.length < 8 || value.length < 20 || value.length > 4096) return false;
  room.pushTokens[who][id] = value;
  return true;
}

export function tokenCount(room, who) {
  withPushTokens(room);
  return Object.values(room.pushTokens[who] || {}).filter(Boolean).length;
}

function tokensFor(room, who) {
  withPushTokens(room);
  return [...new Set(Object.values(room.pushTokens[who] || {}).filter(Boolean))];
}

function dropToken(room, who, token) {
  withPushTokens(room);
  const bag = room.pushTokens[who] || {};
  for (const [id, value] of Object.entries(bag)) {
    if (value === token) delete bag[id];
  }
}

export async function notifyPartner(room, fromWho, { title, body, kind, silent }) {
  const to = fromWho === "ba" ? "ma" : "ba";
  const tokens = tokensFor(room, to);
  if (!tokens.length) {
    console.log(`[push] no tokens for ${to}`);
    return;
  }
  const msg = initFirebase();
  if (!msg) return;
  const type = String(kind || "chat");
  const hideBanner = Boolean(silent) || type === "poke";
  try {
    const message = {
      tokens,
      data: {
        title: String(title || "Ba"),
        body: String(body || ""),
        kind: type,
      },
      android: {
        priority: "high",
      },
    };
    if (!hideBanner) {
      message.notification = { title, body };
      message.android.notification = {
        channelId: "ba_push",
        sound: "default",
      };
    }
    const result = await msg.sendEachForMulticast(message);
    console.log(`[push] sent ${kind} to ${to}: ${result.successCount}/${tokens.length}`);
    result.responses.forEach((row, i) => {
      if (row.success) return;
      console.error("[push] token failed:", row.error?.code, row.error?.message);
      const code = String(row.error?.code || "");
      if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
        dropToken(room, to, tokens[i]);
      }
    });
  } catch (err) {
    console.error("[push] send failed:", err.message);
  }
}
