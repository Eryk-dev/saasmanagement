import test from "node:test";
import assert from "node:assert/strict";
import { srcFingerprint } from "../src/build-info.js";

// A impressão é estável (cacheada) e tem cara de hash curto.
test("srcFingerprint: 12 hex estáveis", () => {
  const a = srcFingerprint();
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(srcFingerprint(), a);
});
