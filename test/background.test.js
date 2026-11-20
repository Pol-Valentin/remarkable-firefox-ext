import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

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
  storage: { local: { get: async () => ({ deviceToken: state.deviceToken }), remove: async (key) => events.push(`remove ${key}`) } },
  permissions: { contains: async () => state.allSites },
  scripting: {
    executeScript: async () => [{ result: { title: "T", content: "<p>Texte</p>", url: "https://example.com/", lang: "fr" } }],
  },
  notifications: { create: async ({ message }) => events.push(`notify ${message}`) },
};

const { send } = await import("../src/background.js");

beforeEach(() => {
  events = [];
  state = { deviceToken: "device-token", allSites: true };
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
});

test("without the permission to read sites, the options page opens before anything is sent", async () => {
  state.allSites = false;
  globalThis.fetch = async () => assert.fail("nothing must be sent");

  await send({ id: 1 });
  assert.deepEqual(events, ["options"]);
});

test("a revoked pairing is forgotten and the options page asks for a new code", async () => {
  await send({ id: 1 });

  assert.deepEqual(events, [
    "remove deviceToken",
    "options",
    "notify L'appairage a expiré : saisis un nouveau code dans les options.",
  ]);
});
