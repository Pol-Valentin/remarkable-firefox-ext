import { test } from "node:test";
import assert from "node:assert/strict";
import { download } from "../src/images.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function pageFetch() {
  const asked = [];
  const fromPage = async (url) => {
    asked.push(url);
    return { type: "image/jpeg", bytes: JPEG.buffer };
  };
  return { asked, fromPage };
}

test("an image served to the extension is downloaded directly", async () => {
  globalThis.fetch = async () => new Response(JPEG, { headers: { "Content-Type": "image/png" } });
  const { asked, fromPage } = pageFetch();

  const blob = await download("https://cdn.example.com/a.png", fromPage);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(asked, []);
});

test("an image refused to the extension is downloaded again from the page", async () => {
  globalThis.fetch = async () => new Response("hotlink", { status: 403 });
  const { asked, fromPage } = pageFetch();

  const blob = await download("https://cdn.example.com/a.jpg", fromPage);
  assert.equal(blob.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), JPEG);
  assert.deepEqual(asked, ["https://cdn.example.com/a.jpg"]);
});

test("a network error also falls back on the page, and a page failure gives no image", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("NetworkError");
  };

  assert.equal(await download("https://cdn.example.com/a.jpg", async () => null), null);
});
