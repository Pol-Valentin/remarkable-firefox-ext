import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const AMO = "https://addons.mozilla.org";

function jwt(key, secret, now) {
  const iat = Math.floor(now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: key, jti: randomUUID(), iat, exp: iat + 60 })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

export async function fetchSigned({ guid, version, key, secret, fetch = globalThis.fetch, now = Date.now }) {
  const headers = { Authorization: `JWT ${jwt(key, secret, now)}` };
  const response = await fetch(`${AMO}/api/v5/addons/addon/${encodeURIComponent(guid)}/versions/v${version}/`, { headers });
  if (!response.ok) throw new Error(`La version ${version} est introuvable sur AMO : HTTP ${response.status}`);
  const { file } = await response.json();
  if (file.status !== "public") {
    throw new Error(`La version ${version} n'est pas encore approuvée sur AMO (${file.status}) : relance le job plus tard.`);
  }
  const download = await fetch(file.url, new URL(file.url).origin === AMO ? { headers } : {});
  if (!download.ok) throw new Error(`Téléchargement du fichier signé refusé : HTTP ${download.status}`);
  return new Uint8Array(await download.arrayBuffer());
}

if (import.meta.main) {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  const { version } = manifest;
  const bytes = await fetchSigned({
    guid: manifest.browser_specific_settings.gecko.id,
    version,
    key: process.env.WEB_EXT_API_KEY,
    secret: process.env.WEB_EXT_API_SECRET,
  });
  await mkdir("web-ext-artifacts", { recursive: true });
  await writeFile(`web-ext-artifacts/envoyer_sur_remarkable-${version}.xpi`, bytes);
}
