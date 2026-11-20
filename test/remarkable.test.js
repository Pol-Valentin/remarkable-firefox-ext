import { test } from "node:test";
import assert from "node:assert/strict";
import { registerDevice, syncGet, userToken, uploadEpub } from "../src/remarkable.js";

function serve(status, body) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init });
    return new Response(body, { status });
  };
  return requests;
}

test("pairing posts the code with a fresh device id and returns the device token", async () => {
  const requests = serve(200, "device-token");

  assert.equal(await registerDevice("abcdefgh"), "device-token");
  const [{ url, method, headers, body }] = requests;
  assert.equal(url, "https://webapp-prod.cloud.remarkable.engineering/token/json/2/device/new");
  assert.equal(method, "POST");
  assert.equal(headers.Authorization, "Bearer");
  const sent = JSON.parse(body);
  assert.equal(sent.code, "abcdefgh");
  assert.equal(sent.deviceDesc, "browser-chrome");
  assert.match(sent.deviceID, /^[0-9a-f-]{36}$/);
});

test("the user token is requested with the device token", async () => {
  const requests = serve(200, "user-token");

  assert.equal(await userToken("device-token"), "user-token");
  assert.equal(requests[0].headers.Authorization, "Bearer device-token");
});

test("the upload sends the book with its name encoded as UTF-8 JSON in base64", async () => {
  const requests = serve(200, '{"docID":"1","hash":"h"}');
  const bytes = new Uint8Array([1, 2, 3]);

  await uploadEpub("user-token", "Été « 2026 »", bytes);
  const [{ url, headers, body }] = requests;
  assert.equal(url, "https://internal.cloud.remarkable.com/doc/v2/files");
  assert.equal(headers.Authorization, "Bearer user-token");
  assert.equal(headers["Content-Type"], "application/epub+zip");
  assert.equal(headers["rm-source"], "RoR-Browser");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(headers["rm-meta"]))), { file_name: "Été « 2026 »" });
  assert.equal(body, bytes);
});

test("the upload names the destination folder when there is one", async () => {
  const requests = serve(200, '{"docID":"1","hash":"h"}');

  await uploadEpub("user-token", "Titre", new Uint8Array(), "f-alire");
  const meta = JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(requests[0].headers["rm-meta"])));
  assert.deepEqual(meta, { file_name: "Titre", parent: "f-alire" });
});

test("a refused request fails with its HTTP status", async () => {
  serve(401, "unauthorized");

  await assert.rejects(userToken("revoked"), { status: 401, message: "Jeton reMarkable refusé : HTTP 401 unauthorized" });
});

test("a sync read that gets no answer within 15 s gives up with a clear error", async (t) => {
  const delays = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    delays.push(ms);
    return AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  });
  globalThis.fetch = async (url, { signal }) => {
    signal.throwIfAborted();
    return new Response("{}");
  };

  await assert.rejects(syncGet("user-token", "/sync/v4/root"), { message: "Le cloud reMarkable ne répond pas." });
  assert.deepEqual(delays, [15000]);
});
