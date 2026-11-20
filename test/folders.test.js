import { test } from "node:test";
import assert from "node:assert/strict";
import { folderPath, listFolders } from "../src/folders.js";
import { fakeCloud, LIBRARY } from "./fake-cloud.js";

globalThis.fetch = fakeCloud(LIBRARY).fetch;

test("lists the live folders with their full path, sorted, leaving out documents, the trash, orphans and items without metadata", async () => {
  const { folders } = await listFolders("user-token");
  assert.deepEqual(folders, [
    { id: "f-alire", path: "À lire" },
    { id: "f-alire-arch", path: "À lire / Archivés" },
    { id: "f-mngt", path: "Management" },
    { id: "f-mngt-arch", path: "Management / Archivés" },
    { id: "f-perso", path: "Perso" },
    { id: "f-recettes", path: "Perso / Recettes" },
  ]);
});

test("reuses the previous list while the library has not changed", async () => {
  const cloud = fakeCloud(LIBRARY);
  globalThis.fetch = cloud.fetch;
  const previous = await listFolders("user-token");
  cloud.requests.length = 0;

  assert.equal(await listFolders("user-token", previous), previous);
  assert.deepEqual(cloud.requests, ["/sync/v4/root"]);
});

test("reads the library again once it has changed", async () => {
  globalThis.fetch = fakeCloud(LIBRARY).fetch;
  const stale = { hash: "ancien", folders: [{ id: "f-vieux", path: "Vieux" }] };

  const { folders } = await listFolders("user-token", stale);
  assert.equal(folders.length, 6);
});

test("refuses an index format it does not know", async () => {
  globalThis.fetch = fakeCloud(LIBRARY, { rootVersion: 5 }).fetch;

  await assert.rejects(listFolders("user-token"), /Format d'index inconnu : 5/);
  await assert.rejects(folderPath("user-token", "f-perso"), /Format d'index inconnu : 5/);
});

test("gives the current path of a live folder", async () => {
  globalThis.fetch = fakeCloud(LIBRARY).fetch;
  assert.equal(await folderPath("user-token", "f-recettes"), "Perso / Recettes");
});

test("finds no path for a folder that is gone, trashed, deleted, orphaned, without metadata or not a folder", async () => {
  globalThis.fetch = fakeCloud(LIBRARY).fetch;
  for (const id of ["disparu", "f-sous-jete", "f-supprime", "f-orphelin", "d-incomplet", "d-todo"]) {
    assert.equal(await folderPath("user-token", id), null, id);
  }
});
