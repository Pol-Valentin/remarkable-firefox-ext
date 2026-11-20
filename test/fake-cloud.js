import { createHash } from "node:crypto";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function fakeCloud(items, { rootVersion = 4 } = {}) {
  const files = new Map();
  const store = (name, text) => {
    const hash = sha256(name + text);
    files.set(hash, { name, text });
    return hash;
  };

  const rootLines = items.map(({ id, schema = 4, withoutMetadata, ...metadata }) => {
    const meta = store(`${id}.metadata`, JSON.stringify({ pinned: false, ...metadata }));
    const content = store(`${id}.content`, "{}");
    const subfiles = [...(withoutMetadata ? [] : [`${meta}:0:${id}.metadata:0:100`]), `${content}:0:${id}.content:0:2`];
    const index = schema === 3 ? `3\n${subfiles.join("\n")}\n` : `4\n0:${id}:2:102\n${subfiles.join("\n")}\n`;
    return `${store(`${id}.docSchema`, index)}:0:${id}:2:102`;
  });
  const rootHash = store("root.docSchema", `${rootVersion}\n0:.:${rootLines.length}:0\n${rootLines.join("\n")}\n`);

  const uploads = [];
  const requests = [];
  const fetch = async (url, { method = "GET", headers = {}, body } = {}) => {
    const { pathname } = new URL(url);
    requests.push(pathname);
    if (pathname === "/token/json/2/user/new") return new Response("user-token");
    if (headers.Authorization !== "Bearer user-token") return new Response("unauthorized", { status: 401 });
    if (method === "GET" && pathname === "/sync/v4/root") {
      return Response.json({ hash: rootHash, generation: 1, schemaVersion: 3 });
    }
    const file = method === "GET" && files.get(pathname.match(/^\/sync\/v3\/files\/(\w+)$/)?.[1]);
    if (file) {
      if (headers["rm-filename"] !== file.name) return new Response('{"message":"invalid filename"}', { status: 400 });
      return new Response(file.text);
    }
    if (method === "POST" && pathname === "/doc/v2/files") {
      const meta = JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(headers["rm-meta"])));
      uploads.push({ meta, body });
      return Response.json({ docID: "doc", hash: "hash" }, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, uploads, requests };
}

export const LIBRARY = [
  { id: "f-perso", type: "CollectionType", visibleName: "Perso", parent: "" },
  { id: "f-recettes", type: "CollectionType", visibleName: "Recettes", parent: "f-perso", schema: 3 },
  { id: "f-alire", type: "CollectionType", visibleName: "À lire", parent: "" },
  { id: "f-alire-arch", type: "CollectionType", visibleName: "Archivés", parent: "f-alire" },
  { id: "f-mngt", type: "CollectionType", visibleName: "Management", parent: "" },
  { id: "f-mngt-arch", type: "CollectionType", visibleName: "Archivés", parent: "f-mngt" },
  { id: "f-jete", type: "CollectionType", visibleName: "Jeté", parent: "trash" },
  { id: "f-sous-jete", type: "CollectionType", visibleName: "Sous jeté", parent: "f-jete" },
  { id: "f-supprime", type: "CollectionType", visibleName: "Supprimé", parent: "", deleted: true },
  { id: "f-orphelin", type: "CollectionType", visibleName: "Orphelin", parent: "disparu" },
  { id: "d-todo", type: "DocumentType", visibleName: "Todo", parent: "" },
  { id: "d-article", type: "DocumentType", visibleName: "Un article", parent: "f-alire" },
  { id: "d-incomplet", withoutMetadata: true },
];
