import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { fakeCloud, LIBRARY } from "./fake-cloud.js";

const html = (await readFile(new URL("../options/options.html", import.meta.url), "utf8")).replace(/<script[^>]*><\/script>/, "");

let state;
globalThis.browser = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, state[key]])),
      set: async (values) => Object.assign(state, values),
      remove: async (keys) => [keys].flat().forEach((key) => delete state[key]),
    },
  },
  permissions: { contains: async () => true, request: async () => true },
};

let opened = 0;
async function openOptions() {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.Option = window.Option;
  await import(`../options/options.js?page=${++opened}`);
  return window.document;
}

async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(condition(), "the page never reached the expected state");
}

const loaded = (page) => () => !page.getElementById("destination").hidden && !page.getElementById("folder").disabled;
const choices = (page) => [...page.getElementById("folder").options].map((option) => [option.value, option.text, option.selected]);

let cloud;
beforeEach(() => {
  state = { deviceToken: "device-token" };
  cloud = fakeCloud(LIBRARY);
  globalThis.fetch = cloud.fetch;
});

test("lists the folders with the remembered one selected", async () => {
  state.folder = { id: "f-alire-arch", path: "À lire / Archivés" };
  const page = await openOptions();

  await until(loaded(page));
  assert.deepEqual(choices(page).slice(0, 3), [
    ["", "Racine", false],
    ["f-alire", "À lire", false],
    ["f-alire-arch", "À lire / Archivés", true],
  ]);
  assert.equal(choices(page).length, 7);
});

test("choosing a folder remembers it, choosing the root forgets it", async () => {
  const page = await openOptions();
  await until(loaded(page));
  const select = page.getElementById("folder");

  select.value = "f-recettes";
  select.dispatchEvent(new page.defaultView.Event("change"));
  await until(() => state.folder);
  assert.deepEqual(state.folder, { id: "f-recettes", path: "Perso / Recettes" });
  assert.equal(page.getElementById("status").textContent, "Les articles iront dans « Perso / Recettes ».");

  select.value = "";
  select.dispatchEvent(new page.defaultView.Event("change"));
  await until(() => !state.folder);
});

test("a renamed folder is remembered under its new path", async () => {
  state.folder = { id: "f-recettes", path: "Perso / Cuisine" };
  const page = await openOptions();

  await until(() => state.folder.path === "Perso / Recettes");
  assert.equal(page.getElementById("status").textContent, "");
});

test("a folder that is gone is reported", async () => {
  state.folder = { id: "f-sous-jete", path: "Jeté / Sous jeté" };
  const page = await openOptions();

  await until(loaded(page));
  assert.equal(page.getElementById("status").textContent, "Le dossier « Jeté / Sous jeté » n'existe plus : les articles iront à la racine.");
  assert.deepEqual(choices(page)[0], ["", "Racine", true]);
});

test("the next opening reuses the list while the library has not changed", async () => {
  await until(loaded(await openOptions()));
  cloud.requests.length = 0;

  const page = await openOptions();
  await until(loaded(page));
  assert.deepEqual(cloud.requests, ["/token/json/2/user/new", "/sync/v4/root"]);
  assert.equal(choices(page).length, 7);
});

test("a revoked pairing is forgotten and the page asks for a new code", async () => {
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
  const page = await openOptions();

  await until(() => !page.getElementById("pairing").hidden);
  assert.equal(state.deviceToken, undefined);
  assert.equal(page.getElementById("destination").hidden, true);
  assert.equal(page.getElementById("status").textContent, "L'appairage a expiré : saisis un nouveau code ci-dessous.");
});

test("a list that arrives after unpairing is ignored", async () => {
  state.folder = { id: "f-sous-jete", path: "Jeté / Sous jeté" };
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === "/sync/v4/root") await gate;
    return cloud.fetch(url, init);
  };
  const page = await openOptions();
  await until(() => page.getElementById("folder").disabled);

  page.getElementById("unpair").click();
  await until(() => page.getElementById("status").textContent === "Extension désappairée.");
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(page.getElementById("status").textContent, "Extension désappairée.");
  assert.equal(page.getElementById("destination").hidden, true);
});
