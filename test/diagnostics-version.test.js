import test from "node:test";
import assert from "node:assert/strict";
import { resolveScriptVersion } from "../src/main.js";

test("diagnostics script version resolves from Tampermonkey GM_info", () => {
  assert.equal(resolveScriptVersion({ directInfo: { script: { version: "1.1.0" } }, globalRef: {} }), "1.1.0");
});

test("diagnostics script version falls back safely when GM_info is unavailable", () => {
  assert.equal(resolveScriptVersion({ directInfo: null, globalRef: {} }), "unknown");
});
