import assert from "node:assert/strict";
import { test } from "node:test";
import { credsFile, looksLikeJwk } from "./setup-beads.mjs";

test("the key file is named after the key id under ~/.dolt/creds", () => {
  assert.equal(credsFile("/home/me", "m43m5420e9pd"), "/home/me/.dolt/creds/m43m5420e9pd.jwk");
});

test("a missing or odd key id is refused", () => {
  assert.throws(() => credsFile("/home/me", ""));
  assert.throws(() => credsFile("/home/me", undefined));
  assert.throws(() => credsFile("/home/me", "../../etc/passwd"));
});

test("only a JWK with a private part counts as a Dolt key", () => {
  assert.equal(looksLikeJwk('{"kty":"OKP","crv":"Ed25519","x":"a","d":"b"}'), true);
  assert.equal(looksLikeJwk('{"kty":"OKP","x":"a"}'), false);
  assert.equal(looksLikeJwk("dhat.v1.abcdef"), false);
  assert.equal(looksLikeJwk(""), false);
});

test("Beads syncs with the Takewon database on DoltHub", async () => {
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(new URL("../.beads/config.yaml", import.meta.url), "utf8");
  assert.match(config, /^ {4}remote: "https:\/\/doltremoteapi\.dolthub\.com\/chowderr\/takewon"$/m);
});
