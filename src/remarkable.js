const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const UPLOAD_HOST = "https://internal.cloud.remarkable.com";
const SYNC_HOST = "https://eu.tectonic.remarkable.com";
const TIMEOUT = 15000;
const UPLOAD_TIMEOUT = 120000;

async function request(url, init, what, timeout = TIMEOUT) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    const body = await response.text();
    if (!response.ok) throw Object.assign(new Error(`${what} : HTTP ${response.status} ${body}`.trim()), { status: response.status });
    return body;
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("Le cloud reMarkable ne répond pas.");
    throw error;
  }
}

export function registerDevice(code) {
  return request(
    `${AUTH_HOST}/token/json/2/device/new`,
    {
      method: "POST",
      headers: { Authorization: "Bearer", "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceDesc: "browser-chrome", deviceID: crypto.randomUUID() }),
    },
    "Appairage refusé",
  );
}

export function userToken(deviceToken) {
  return request(
    `${AUTH_HOST}/token/json/2/user/new`,
    { method: "POST", headers: { Authorization: `Bearer ${deviceToken}` } },
    "Jeton reMarkable refusé",
  );
}

export async function uploadEpub(token, fileName, bytes, parent) {
  const meta = new TextEncoder().encode(JSON.stringify({ file_name: fileName, ...(parent && { parent }) })).toBase64();
  await request(
    `${UPLOAD_HOST}/doc/v2/files`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/epub+zip",
        "rm-meta": meta,
        "rm-source": "RoR-Browser",
      },
      body: bytes,
    },
    "Envoi refusé",
    UPLOAD_TIMEOUT,
  );
}

export function syncGet(token, path, fileName) {
  return request(
    `${SYNC_HOST}${path}`,
    { headers: { Authorization: `Bearer ${token}`, ...(fileName && { "rm-filename": fileName }) } },
    "Lecture des dossiers refusée",
  );
}
