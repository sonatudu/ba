import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

let messaging = null;

function initFirebase() {
  if (messaging) return messaging;
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) {
    console.log("[push] FIREBASE_SERVICE_ACCOUNT is not set; push send is off");
    return null;
  }
  try {
    const cred = JSON.parse(raw);
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

export async function notifyPartner(room, fromWho, { title, body, kind }) {
  const to = fromWho === "ba" ? "ma" : "ba";
  const tokens = tokensFor(room, to);
  if (!tokens.length) return;
  const msg = initFirebase();
  if (!msg) return;
  try {
    const result = await msg.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: {
        title,
        body,
        kind: String(kind || "chat"),
      },
      android: {
        priority: "high",
        notification: { channelId: "ba_push" },
      },
    });
    result.responses.forEach((row, i) => {
      if (row.success) return;
      const code = String(row.error?.code || "");
      if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
        dropToken(room, to, tokens[i]);
      }
    });
  } catch (err) {
    console.error("[push] send failed:", err.message);
  }
}
