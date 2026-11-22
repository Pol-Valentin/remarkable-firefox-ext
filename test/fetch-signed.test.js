import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fetchSigned } from "../scripts/fetch-signed.mjs";

const NOW = 1_800_000_000_000;
const options = (fetch) => ({ guid: "send-to-remarkable@polvalentin", version: "1.2.0", key: "user:1:2", secret: "s3cret", fetch, now: () => NOW });

function amo(version, { fileHost = "https://addons.mozilla.org" } = {}) {
  const requests = [];
  const fetch = async (url, { headers = {} } = {}) => {
    requests.push({ url, authorization: headers.Authorization });
    if (url.includes("/versions/")) {
      return version ? Response.json(version(fileHost)) : new Response('{"detail":"Not found."}', { status: 404 });
    }
    return new Response(new Uint8Array([1, 2, 3]));
  };
  return { fetch, requests };
}

const approved = (host) => ({ version: "1.2.0", file: { status: "public", url: `${host}/firefox/downloads/file/42/signed.xpi` } });

function decode(authorization) {
  const [scheme, token] = authorization.split(" ");
  const [header, payload, signature] = token.split(".");
  const expected = createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest("base64url");
  return { scheme, header: JSON.parse(Buffer.from(header, "base64url")), payload: JSON.parse(Buffer.from(payload, "base64url")), valid: signature === expected };
}

test("downloads the signed file of an approved version, authenticated with a short-lived JWT", async () => {
  const { fetch, requests } = amo(approved);

  assert.deepEqual([...(await fetchSigned(options(fetch)))], [1, 2, 3]);
  assert.equal(requests[0].url, "https://addons.mozilla.org/api/v5/addons/addon/send-to-remarkable%40polvalentin/versions/v1.2.0/");
  assert.equal(requests[1].url, "https://addons.mozilla.org/firefox/downloads/file/42/signed.xpi");
  const { scheme, header, payload, valid } = decode(requests[0].authorization);
  assert.equal(scheme, "JWT");
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.equal(payload.iss, "user:1:2");
  assert.equal(payload.iat, NOW / 1000);
  assert.equal(payload.exp, NOW / 1000 + 60);
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.ok(valid);
  assert.equal(requests[1].authorization, requests[0].authorization);
});

test("refuses a version that is still awaiting review", async () => {
  const { fetch } = amo(() => ({ version: "1.2.0", file: { status: "unreviewed", url: "https://addons.mozilla.org/x.xpi" } }));

  await assert.rejects(fetchSigned(options(fetch)), { message: "La version 1.2.0 n'est pas encore approuvée sur AMO (unreviewed) : relance le job plus tard." });
});

test("says when the version was never submitted", async () => {
  const { fetch } = amo(null);

  await assert.rejects(fetchSigned(options(fetch)), { message: "La version 1.2.0 est introuvable sur AMO : HTTP 404" });
});

test("does not send the API credentials to a download host other than AMO", async () => {
  const { fetch, requests } = amo(approved, { fileHost: "https://cdn.example.net" });

  await fetchSigned(options(fetch));
  assert.equal(requests[1].authorization, undefined);
});
