import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { toXhtml } from "../src/article.js";
import { buildEpub } from "../src/epub.js";

const readability = readFileSync(new URL("../vendor/Readability.js", import.meta.url), "utf8");
const extractor = readFileSync(new URL("../src/extract.js", import.meta.url), "utf8");

const paragraph = (n) =>
  `<p>Paragraphe ${n} : la reMarkable affiche un EPUB reflowable, avec une police lisible et des marges confortables pour annoter.</p>`;

const PAGE = `<!doctype html><html lang="fr"><head><title>Un article | Le Site</title></head><body>
<nav><a href="/">Accueil</a><a href="/blog">Blog</a></nav>
<script>window.tracker = 1</script>
<article>
  <h1>Un article</h1>
  ${[1, 2, 3].map(paragraph).join("")}
  <p>Voir <a href="/autre-page">la suite</a> ou <a href="javascript:alert(1)">ceci</a>.</p>
  <figure><img data-src="/img/lazy.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Paresseuse"><figcaption>Légende</figcaption></figure>
  <picture><source srcset="/img/pic.webp 1x, /img/pic@2x.webp 2x"><img alt="Picture"></picture>
  <img src="https://cdn.example.org/broken.png" alt="Cassée">
  <p>Un <my-widget class="x">élément inconnu</my-widget> et un caractère \u0007 de contrôle.</p>
  <svg><circle r="4"/></svg>
  <iframe src="https://youtube.com/embed/x"></iframe>
  ${[4, 5, 6].map(paragraph).join("")}
</article>
<footer>© Le Site</footer>
</body></html>`;

function extractFrom(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  dom.window.eval(readability);
  return { article: dom.window.eval(extractor), window: dom.window };
}

async function convert() {
  const { article, window } = extractFrom(PAGE, "https://blog.example.com/posts/un-article");
  globalThis.DOMParser = window.DOMParser;
  globalThis.XMLSerializer = window.XMLSerializer;
  const fetched = [];
  const fetchImage = async (url) => {
    fetched.push(url);
    if (url.includes("broken")) throw new Error("404");
    return { mediaType: "image/jpeg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
  };
  const result = await toXhtml(article.content, fetchImage);
  return { article, fetched, ...result };
}

test("extraction keeps the article and resolves lazy and picture images to absolute URLs", async () => {
  const { article, fetched } = await convert();

  assert.equal(article.lang, "fr");
  assert.equal(article.url, "https://blog.example.com/posts/un-article");
  assert.deepEqual(fetched, [
    "https://blog.example.com/img/lazy.jpg",
    "https://blog.example.com/img/pic@2x.webp",
    "https://cdn.example.org/broken.png",
  ]);
});

test("conversion keeps text and safe links, embeds images and drops the rest", async () => {
  const { bodyXhtml, images } = await convert();

  assert.deepEqual(images.map((i) => i.href), ["images/img-0.jpg", "images/img-1.jpg"]);
  assert.match(bodyXhtml, /<img src="images\/img-0.jpg" alt="Paresseuse" \/>/);
  assert.doesNotMatch(bodyXhtml, /broken|Cassée/);
  assert.match(bodyXhtml, /<a href="https:\/\/blog.example.com\/autre-page">la suite<\/a>/);
  assert.match(bodyXhtml, /ou ceci\./);
  assert.match(bodyXhtml, /Un élément inconnu et/);
  assert.doesNotMatch(bodyXhtml, /javascript|my-widget|<svg|<iframe|<script|tracker|class=|\u0007/);
});

test("the resulting book page is well formed XHTML", async () => {
  const { article, bodyXhtml, images } = await convert();
  const epub = buildEpub({
    id: "urn:uuid:1",
    title: article.title,
    author: article.byline,
    lang: article.lang,
    source: article.url,
    modified: new Date(),
    bodyXhtml,
    images,
  });
  const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
  writeFileSync(join(dir, "b.epub"), epub);
  execFileSync("unzip", ["-q", join(dir, "b.epub"), "-d", join(dir, "x")]);
  execFileSync("xmllint", ["--noout", join(dir, "x/OEBPS/article.xhtml")]);
});

test("a page without an article returns an explicit error", () => {
  const { article } = extractFrom("<html><body><a href='/'>x</a></body></html>", "https://example.com/");
  assert.equal(article.error, "Aucun article détecté sur cette page.");
});
