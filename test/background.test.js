import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fakeCloud, LIBRARY } from "./fake-cloud.js";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;

let state;
let events;
let tabStatus;
const listeners = {};
const listener = (name) => ({ addListener: (fn) => (listeners[name] = fn), removeListener: () => delete listeners[name] });
globalThis.browser = {
  runtime: { onInstalled: listener("installed"), openOptionsPage: async () => events.push("options"), getURL: (path) => path },
  action: {
    onClicked: listener("action"),
    setBadgeText: async ({ tabId, text }) => text && events.push(`badge ${tabId} ${text}`),
    setBadgeBackgroundColor: async () => {},
  },
  contextMenus: { onClicked: listener("menu"), create: (item) => events.push(`menu ${item.id} ${item.contexts}`) },
  tabs: {
    onUpdated: listener("updated"),
    create: async ({ url, active }) => (events.push(`open ${url} ${active ? "active" : "inactive"}`), { id: 2, status: "loading" }),
    get: async (id) => ({ id, status: tabStatus }),
    remove: async (id) => events.push(`close ${id}`),
  },
  storage: {
    local: {
      get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, state[key]])),
      remove: async (key) => events.push(`remove ${key}`),
    },
  },
  permissions: { contains: async () => state.allSites },
  scripting: {
    executeScript: async ({ target }) => {
      events.push(`read ${target.tabId}`);
      return [{ result: { title: "T", content: "<p>Texte</p>", url: "https://example.com/", lang: "fr" } }];
    },
  },
  notifications: { create: async ({ message }) => events.push(`notify ${message}`) },
};

const { send } = await import("../src/background.js");

const outcome = () => events.filter((event) => !/^(badge|read) /.test(event));

let cloud;
mock.timers.enable({ apis: ["setTimeout"] });

beforeEach(() => {
  events = [];
  tabStatus = "loading";
  state = { deviceToken: "device-token", allSites: true };
  cloud = fakeCloud(LIBRARY);
  globalThis.fetch = cloud.fetch;
});

test("without the permission to read sites, the options page opens before anything is sent", async () => {
  state.allSites = false;
  globalThis.fetch = async () => assert.fail("nothing must be sent");

  await send({ id: 1 });
  assert.deepEqual(events, ["options"]);
  await listeners.menu({ menuItemId: "send-link", linkUrl: "https://example.com/a" }, { id: 1 });
  assert.deepEqual(events, ["options", "options"]);
});

test("a revoked pairing is forgotten and the options page asks for a new code", async () => {
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });

  await send({ id: 1 });
  assert.deepEqual(outcome(), [
    "remove deviceToken",
    "options",
    "notify L'appairage a expiré : saisis un nouveau code dans les options.",
  ]);
});

test("without a chosen folder the article goes to the root", async () => {
  await send({ id: 1 });

  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(outcome(), []);
});

test("the article goes to the chosen folder while it still exists", async () => {
  state.folder = { id: "f-recettes", path: "Perso / Recettes" };

  await send({ id: 1 });
  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T", parent: "f-recettes" }]);
  assert.deepEqual(outcome(), []);
});

test("a chosen folder that was trashed sends the article to the root and says so", async () => {
  state.folder = { id: "f-sous-jete", path: "Jeté / Sous jeté" };

  await send({ id: 1 });
  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(outcome(), ["notify Le dossier « Jeté / Sous jeté » n'existe plus : l'article est à la racine."]);
});

test("when the chosen folder cannot be checked the article still goes to the root and says so", async () => {
  state.folder = { id: "f-recettes", path: "Perso / Recettes" };
  globalThis.fetch = async (url, init) =>
    new URL(url).pathname.startsWith("/sync/") ? new Response("panne", { status: 503 }) : cloud.fetch(url, init);

  await send({ id: 1 });
  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(outcome(), ["notify Le dossier « Perso / Recettes » n'a pas pu être vérifié : l'article est à la racine."]);
});

test("the context menu offers to send the page, a selection or a link", () => {
  listeners.installed();
  assert.deepEqual(events, ["menu send-to-remarkable page,selection", "menu send-link link"]);
});

test("a link opens in a background tab, its article goes to the tablet and the tab is closed", async () => {
  const sending = listeners.menu({ menuItemId: "send-link", linkUrl: "https://example.com/a" }, { id: 1 });
  await until(() => listeners.updated);
  listeners.updated(2, { status: "complete" });
  await sending;

  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(events, ["open https://example.com/a inactive", "badge 1 …", "read 2", "badge 1 ✓", "close 2"]);
});

test("a link whose tab is already loaded is sent without waiting", async () => {
  tabStatus = "complete";
  await listeners.menu({ menuItemId: "send-link", linkUrl: "https://example.com/a" }, { id: 1 });

  assert.equal(cloud.uploads.length, 1);
  assert.equal(listeners.updated, undefined);
});

test("a link that never finishes loading is given up after 30 s and its tab is closed", async () => {
  const sending = listeners.menu({ menuItemId: "send-link", linkUrl: "https://example.com/lent" }, { id: 1 });
  await until(() => listeners.updated);
  mock.timers.tick(30000);
  await sending;

  assert.equal(cloud.uploads.length, 0);
  assert.deepEqual(outcome(), [
    "open https://example.com/lent inactive",
    "notify La page du lien ne s'est pas chargée à temps.",
    "close 2",
  ]);
  assert.equal(listeners.updated, undefined);
});

async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(condition(), "never reached the expected state");
}
