import { test } from "node:test";
import assert from "node:assert/strict";
import { folderPath, listFolders } from "../src/folders.js";
import { fakeCloud, LIBRARY } from "./fake-cloud.js";

globalThis.fetch = fakeCloud(LIBRARY).fetch;

test("lists the live folders with their full path, sorted, leaving out documents, the trash and orphans", async () => {
  assert.deepEqual(await listFolders("user-token"), [
    { id: "f-alire", path: "À lire" },
    { id: "f-alire-arch", path: "À lire / Archivés" },
    { id: "f-mngt", path: "Management" },
    { id: "f-mngt-arch", path: "Management / Archivés" },
    { id: "f-perso", path: "Perso" },
    { id: "f-recettes", path: "Perso / Recettes" },
  ]);
});

test("gives the current path of a live folder", async () => {
  assert.equal(await folderPath("user-token", "f-recettes"), "Perso / Recettes");
});

test("finds no path for a folder that is gone, trashed, deleted, orphaned or not a folder", async () => {
  for (const id of ["disparu", "f-sous-jete", "f-supprime", "f-orphelin", "d-todo"]) {
    assert.equal(await folderPath("user-token", id), null, id);
  }
});
