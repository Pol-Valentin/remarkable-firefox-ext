import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fakeCloud, LIBRARY } from "./fake-cloud.js";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;

let state;
let events;
let tabStates;
let pages;
const listeners = {};
const listener = (name) => ({ addListener: (fn, filter) => ((listeners[name] = fn), (listeners[`${name} filter`] = filter)), removeListener: () => delete listeners[name] });
globalThis.browser = {
  runtime: { onInstalled: listener("installed"), openOptionsPage: async () => events.push("options"), getURL: (path) => path },
  action: {
    onClicked: listener("action"),
    setBadgeText: async ({ tabId, text }) => {
      if (state.closedTabs?.includes(tabId)) throw new Error(`Invalid tab ID: ${tabId}`);
      if (text) events.push(`badge ${tabId} ${text}`);
    },
    setBadgeBackgroundColor: async () => {},
  },
  contextMenus: {
    onClicked: listener("menu"),
    create: (item) => events.push(`menu ${item.id} ${item.contexts}${item.targetUrlPatterns ? ` ${item.targetUrlPatterns}` : ""}`),
  },
  tabs: {
    create: async ({ url, active }) => {
      if (state.createError) throw new Error(state.createError);
      events.push(`open ${url} ${active ? "active" : "inactive"}`);
      return { id: 2, status: "loading", active };
    },
    get: async (id) => ({ id, active: false, ...(tabStates.length > 1 ? tabStates.shift() : tabStates[0]) }),
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
      return [{ result: pages.length > 1 ? pages.shift() : pages[0] }];
    },
  },
  notifications: { create: async ({ message }) => events.push(`notify ${message}`) },
};

const { send } = await import("../src/background.js");

const ARTICLE = { title: "T", content: "<p>Texte</p>", url: "https://example.com/", lang: "fr" };
const NO_ARTICLE = { error: "Aucun article détecté sur cette page." };
const outcome = () => events.filter((event) => !/^(badge|read) /.test(event));

let cloud;
mock.timers.enable({ apis: ["setTimeout"] });

beforeEach(() => {
  events = [];
  tabStates = [{ status: "complete", url: "https://example.com/a" }];
  pages = [ARTICLE];
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

test("the context menu offers to send the page, a selection or a web link", () => {
  listeners.installed();
  assert.deepEqual(events, ["menu send-to-remarkable page,selection", "menu send-link link http://*/*,https://*/*"]);
});

const sendLink = (url = "https://example.com/a") => drive(listeners.menu({ menuItemId: "send-link", linkUrl: url }, { id: 1 }));

test("a link opens in a background tab, its article goes to the tablet and the tab is closed", async () => {
  tabStates = [{ status: "loading" }, { status: "loading" }, { status: "complete", url: "https://example.com/a" }];
  await sendLink();

  assert.deepEqual(cloud.uploads.map((u) => u.meta), [{ file_name: "T" }]);
  assert.deepEqual(events, ["open https://example.com/a inactive", "badge 1 …", "read 2", "badge 1 ✓", "close 2"]);
});

test("the blank page a new tab starts on is not taken for the loaded link", async () => {
  tabStates = [{ status: "complete" }, { status: "loading" }, { status: "complete", url: "https://example.com/a" }];
  await sendLink();

  assert.equal(cloud.uploads.length, 1);
  assert.equal(events.filter((event) => event === "read 2").length, 1);
});

test("an article that shows up late, after a redirect or once scripts have run, is waited for", async () => {
  pages = [NO_ARTICLE, NO_ARTICLE, ARTICLE];
  await sendLink();

  assert.equal(cloud.uploads.length, 1);
  assert.equal(events.filter((event) => event === "read 2").length, 3);
  assert.deepEqual(outcome(), ["open https://example.com/a inactive", "close 2"]);
});

test("a page that never shows an article is reported after a few tries", async () => {
  pages = [NO_ARTICLE];
  await sendLink();

  assert.equal(cloud.uploads.length, 0);
  assert.ok(events.includes("badge 1 !"));
  assert.deepEqual(outcome(), ["open https://example.com/a inactive", "notify Aucun article détecté sur cette page.", "close 2"]);
});

test("a link that never finishes loading is given up after 30 s and its tab is closed", async () => {
  tabStates = [{ status: "loading" }];
  await sendLink("https://example.com/lent");

  assert.equal(cloud.uploads.length, 0);
  assert.ok(events.includes("badge 1 !"));
  assert.deepEqual(outcome(), [
    "open https://example.com/lent inactive",
    "notify La page du lien ne s'est pas chargée à temps.",
    "close 2",
  ]);
});

test("a link Firefox refuses to open is reported instead of failing silently", async () => {
  state.createError = "Illegal URL: file:///etc/hosts";
  await sendLink("file:///etc/hosts");

  assert.deepEqual(outcome(), ["notify Illegal URL: file:///etc/hosts"]);
});

test("closing the tab the link was sent from still lets the notification through", async () => {
  state.folder = { id: "f-sous-jete", path: "Jeté / Sous jeté" };
  state.closedTabs = [1];
  await sendLink();

  assert.equal(cloud.uploads.length, 1);
  assert.deepEqual(outcome(), [
    "open https://example.com/a inactive",
    "notify Le dossier « Jeté / Sous jeté » n'existe plus : l'article est à la racine.",
    "close 2",
  ]);
});

test("the link's tab is left open once the reader has switched to it", async () => {
  tabStates = [{ status: "complete", url: "https://example.com/a", active: true }];
  await sendLink();

  assert.equal(cloud.uploads.length, 1);
  assert.ok(!events.includes("close 2"));
});

async function drive(promise) {
  let settled = false;
  const result = promise.finally(() => (settled = true));
  for (let i = 0; i < 2000 && !settled; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(250);
  }
  assert.ok(settled, "never settled");
  return result;
}
