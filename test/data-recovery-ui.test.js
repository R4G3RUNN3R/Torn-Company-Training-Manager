import test from "node:test";
import assert from "node:assert/strict";
import { dataRecoveryHtml, backupDownloadName, parseImportText } from "../src/ui/data-recovery.js";

test("Data & Recovery exposes export import rebuild and reset without API-key export option", () => {
  const html = dataRecoveryHtml();
  assert.match(html, /Export Training Manager Data/i);
  assert.match(html, /Import Training Manager Data/i);
  assert.match(html, /Rebuild Training History/i);
  assert.match(html, /Reset Local Data/i);
  assert.doesNotMatch(html, /include.*api.*key/i);
});

test("backup filename is deterministic and clearly identifies the product", () => {
  assert.match(backupDownloadName(1_789_000_000_000), /^voidsmith-training-manager-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test("import text must contain valid JSON object with supported backup schema", () => {
  assert.throws(() => parseImportText("not-json"), /valid JSON/i);
  assert.throws(() => parseImportText("[]"), /object/i);
  assert.throws(() => parseImportText(JSON.stringify({ schemaVersion: 999, domains: {} })), /schema/i);
  assert.deepEqual(parseImportText(JSON.stringify({ schemaVersion: 1, domains: { settings: { schemaVersion: 1 } } })), { schemaVersion: 1, domains: { settings: { schemaVersion: 1 } } });
});
