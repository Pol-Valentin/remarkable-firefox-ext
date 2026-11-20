import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip } from "../src/zip.js";

function writeTmp(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
  const file = join(dir, "out.zip");
  writeFileSync(file, bytes);
  return { dir, file };
}

test("produces an archive that unzip validates and extracts byte for byte", () => {
  const binary = new Uint8Array(1000).map((_, i) => (i * 37) % 256);
  const zip = createZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "dir/été.txt", data: "accentué ✓" },
    { name: "dir/bin.dat", data: binary },
  ]);
  const { dir, file } = writeTmp(zip);

  execFileSync("unzip", ["-tq", file]);
  execFileSync("python3", ["-I", "-m", "zipfile", "-e", file, join(dir, "x")]);

  assert.equal(readFileSync(join(dir, "x", "mimetype"), "utf8"), "application/epub+zip");
  assert.equal(readFileSync(join(dir, "x", "dir", "été.txt"), "utf8"), "accentué ✓");
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, "x", "dir", "bin.dat"))), binary);
});

test("stores the first entry uncompressed with its name at offset 30 and no extra field", () => {
  const zip = createZip([{ name: "mimetype", data: "application/epub+zip" }]);
  const view = new DataView(zip.buffer);

  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(28, true), 0);
  assert.equal(new TextDecoder().decode(zip.subarray(30, 38)), "mimetype");
  assert.equal(new TextDecoder().decode(zip.subarray(38, 58)), "application/epub+zip");
});
