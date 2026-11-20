const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const UPLOAD_HOST = "https://internal.cloud.remarkable.com";

async function expectOk(response, what) {
  const body = await response.text();
  if (!response.ok) throw new Error(`${what} : HTTP ${response.status} ${body}`.trim());
  return body;
}

export async function registerDevice(code) {
  const response = await fetch(`${AUTH_HOST}/token/json/2/device/new`, {
    method: "POST",
    headers: { Authorization: "Bearer", "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceDesc: "browser-chrome", deviceID: crypto.randomUUID() }),
  });
  return expectOk(response, "Appairage refusé");
}

async function userToken(deviceToken) {
  const response = await fetch(`${AUTH_HOST}/token/json/2/user/new`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  return expectOk(response, "Jeton reMarkable refusé");
}

export async function uploadEpub(deviceToken, fileName, bytes) {
  const token = await userToken(deviceToken);
  const meta = new TextEncoder().encode(JSON.stringify({ file_name: fileName })).toBase64();
  const response = await fetch(`${UPLOAD_HOST}/doc/v2/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/epub+zip",
      "rm-meta": meta,
      "rm-source": "RoR-Browser",
    },
    body: bytes,
  });
  return JSON.parse(await expectOk(response, "Envoi refusé"));
}
