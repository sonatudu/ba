function bytesToB64(bytes) {
  const chunk = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(""));
}

function b64ToBytes(value) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveSpaceKey(invite, saltHex) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(invite), "PBKDF2", false, [
    "deriveKey",
  ]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((hex) => Number.parseInt(hex, 16)));
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPayload(key, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return { iv: bytesToB64(iv), blob: bytesToB64(sealed) };
}

export async function decryptPayload(key, iv, blob) {
  if (!iv || !blob) return null;
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(iv) }, key, b64ToBytes(blob));
  return JSON.parse(new TextDecoder().decode(opened));
}
