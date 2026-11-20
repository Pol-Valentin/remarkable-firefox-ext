import { syncGet } from "./remarkable.js";

const collator = new Intl.Collator("fr");

function parseIndex(text) {
  const [version, ...lines] = text.trimEnd().split("\n");
  if (version !== "3" && version !== "4") throw new Error(`Format d'index inconnu : ${version}`);
  return (version === "4" ? lines.slice(1) : lines).map((line) => {
    const [hash, , id] = line.split(":");
    return { hash, id };
  });
}

async function rootHash(token) {
  return JSON.parse(await syncGet(token, "/sync/v4/root")).hash;
}

async function readIndex(token, hash) {
  return parseIndex(await syncGet(token, `/sync/v3/files/${hash}`, "root.docSchema"));
}

async function readMetadata(token, { id, hash }) {
  const files = parseIndex(await syncGet(token, `/sync/v3/files/${hash}`, `${id}.docSchema`));
  const metadata = files.find((file) => file.id === `${id}.metadata`);
  if (!metadata) return null;
  return JSON.parse(await syncGet(token, `/sync/v3/files/${metadata.hash}`, metadata.id));
}

async function pathOf(id, metadataOf) {
  const names = [];
  const seen = new Set();
  for (let current = id; current !== ""; ) {
    if (seen.has(current)) return null;
    seen.add(current);
    const metadata = await metadataOf(current);
    if (metadata?.type !== "CollectionType" || metadata.deleted) return null;
    names.unshift(metadata.visibleName);
    current = metadata.parent;
  }
  return names.join(" / ");
}

export async function listFolders(token, previous) {
  const hash = await rootHash(token);
  if (previous?.hash === hash) return previous;
  const entries = await readIndex(token, hash);
  const metadata = new Map(await Promise.all(entries.map(async (entry) => [entry.id, await readMetadata(token, entry)])));
  const folderIds = [...metadata].filter(([, meta]) => meta?.type === "CollectionType").map(([id]) => id);
  const folders = await Promise.all(folderIds.map(async (id) => ({ id, path: await pathOf(id, async (key) => metadata.get(key)) })));
  return { hash, folders: folders.filter((folder) => folder.path).sort((a, b) => collator.compare(a.path, b.path)) };
}

export async function folderPath(token, id) {
  const entries = new Map((await readIndex(token, await rootHash(token))).map((entry) => [entry.id, entry]));
  return pathOf(id, async (key) => (entries.has(key) ? readMetadata(token, entries.get(key)) : null));
}

export async function resolveParent(token, folder) {
  return folder && (await folderPath(token, folder.id)) ? folder.id : "";
}
