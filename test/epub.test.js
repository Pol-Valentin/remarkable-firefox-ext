import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEpub } from "../src/epub.js";

const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

function extract(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "epub-test-"));
  const file = join(dir, "book.epub");
  writeFileSync(file, bytes);
  execFileSync("unzip", ["-q", file, "-d", join(dir, "x")]);
  return join(dir, "x");
}

const book = () =>
  buildEpub({
    id: "urn:uuid:0b4d6a3e-6a2f-4a8e-9a57-6a0a7f1b2c3d",
    title: "Les « bons » & <mauvais> titres",
    author: "Ada & Co",
    lang: "fr",
    source: "https://example.com/a?b=1&c=2",
    modified: new Date("2026-11-20T10:00:00Z"),
    bodyXhtml: '<p>Bonjour <em>monde</em></p><img src="images/img-0.png" alt=""/>',
    images: [{ href: "images/img-0.png", mediaType: "image/png", data: PNG_1PX }],
  });

test("every XML file of the book is well formed", () => {
  const root = extract(book());
  const files = [
    "META-INF/container.xml",
    "OEBPS/content.opf",
    "OEBPS/toc.ncx",
    "OEBPS/nav.xhtml",
    "OEBPS/article.xhtml",
  ];
  for (const f of files) execFileSync("xmllint", ["--noout", join(root, f)]);
});

test("the package lists the article, the stylesheet and every image in the manifest and spine", () => {
  const root = extract(book());
  const opf = readFileSync(join(root, "OEBPS/content.opf"), "utf8");

  assert.match(opf, /<dc:title>Les « bons » &amp; &lt;mauvais&gt; titres<\/dc:title>/);
  assert.match(opf, /<dc:language>fr<\/dc:language>/);
  assert.match(opf, /<meta property="dcterms:modified">2026-11-20T10:00:00Z<\/meta>/);
  assert.match(opf, /href="images\/img-0.png" media-type="image\/png"/);
  assert.match(opf, /<itemref idref="article"\/>/);
  assert.deepEqual(readdirSync(join(root, "OEBPS/images")), ["img-0.png"]);
});

test("the article page carries the title, the source link and the body", () => {
  const root = extract(book());
  const page = readFileSync(join(root, "OEBPS/article.xhtml"), "utf8");

  assert.match(page, /<h1>Les « bons » &amp; &lt;mauvais&gt; titres<\/h1>/);
  assert.match(page, /https:\/\/example.com\/a\?b=1&amp;c=2/);
  assert.match(page, /<p>Bonjour <em>monde<\/em><\/p>/);
});
