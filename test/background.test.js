import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fakeCloud, LIBRARY } from "./fake-cloud.js";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;

let state;
let events;
const listener = { addListener() {} };
globalThis.browser = {
  runtime: { onInstalled: listener, openOptionsPage: async () => events.push("options"), getURL: (path) => path },
  action: { onClicked: listener, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  contextMenus: { onClicked: listener, create() {} },
  storage: {
    local: {
      get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, state[key]])),
      remove: async (key) => events.push(`remove ${key}`),
    },
  },
  permissions: { contains: async () => state.allSites },
  scripting: {
    executeScript: async () => [{ result: { title: "T", content: "<p>Texte</p>", url: "https://example.com/", lang: "fr" } }],
  },
  notifications: { create: async ({ message }) => events.push(`notify ${message}`) },
};

const { send } = await import("../src/background.js");

let cloud;
mock.timers.enable({ apis: ["setTimeout"] });

beforeEach(() => {
  events = [];
  state = { deviceToken: "device-token", allSites: true };
  cloud = fakeCloud(LIBRARY);
  globalThis.fetch = cloud.fetch;
});

test("without the permission to read sites, the options page opens before anything is sent", async () => {
  state.allSites = false;
  globalThis.fetch = async () => assert.fail("nothing must be sent");

  await send({ id: 1 });
  assert.deepEqual(events, ["options"]);
});

test("a revoked pairing is forgotten and the options page asks for a new code", async () => {
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });

  await send({ id: 1 });
  assert.deepEqual(events, [
    "remove deviceToken",
    "options",
    "notify L'appairage a expiré : saisis un nouveau code dans les options.",
  ]);
});

test("without a chosen folder the article goes to the root", async () => {
  await send({ id: 1 });

  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(events, []);
});

test("the article goes to the chosen folder while it still exists", async () => {
  state.folder = { id: "f-recettes", path: "Perso / Recettes" };

  await send({ id: 1 });
  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T", parent: "f-recettes" }]);
  assert.deepEqual(events, []);
});

test("a chosen folder that was trashed sends the article to the root and says so", async () => {
  state.folder = { id: "f-sous-jete", path: "Jeté / Sous jeté" };

  await send({ id: 1 });
  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(events, ["notify Le dossier « Jeté / Sous jeté » n'existe plus : l'article est à la racine."]);
});
