import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const RAW = "https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Company-Training-Manager/main/dist/Torn%20Company%20Training%20Manager.user.js";
const SUPPORT = "https://github.com/R4G3RUNN3R/Torn-Company-Training-Manager/issues";

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}

test("package version is the v1.1.2 release source", async () => {
  const pkg = JSON.parse(await text("package.json"));
  assert.equal(pkg.version, "1.1.2");
});

test("source header uses build-time version placeholder and explicit update metadata", async () => {
  const header = await text("src/userscript-header.txt");
  assert.match(header, /@version\s+__VERSION__/);
  assert.match(header, new RegExp(`@updateURL\\s+${RAW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(header, new RegExp(`@downloadURL\\s+${RAW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(header, new RegExp(`@supportURL\\s+${SUPPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("built userscript version and metadata match package version", async () => {
  const pkg = JSON.parse(await text("package.json"));
  const dist = await text("dist/Torn Company Training Manager.user.js");
  assert.match(dist, new RegExp(`@version\\s+${pkg.version.replaceAll(".", "\\.")}`));
  assert.equal(dist.includes("__VERSION__"), false);
  assert.match(dist, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/Torn-Company-Training-Manager\/main\/dist\/Torn%20Company%20Training%20Manager\.user\.js/);
  assert.match(dist, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/Torn-Company-Training-Manager\/main\/dist\/Torn%20Company%20Training%20Manager\.user\.js/);
  assert.match(dist, /@supportURL\s+https:\/\/github\.com\/R4G3RUNN3R\/Torn-Company-Training-Manager\/issues/);
});

test("README and changelog identify the same current v1.1.2 release", async () => {
  const readme = await text("README.md");
  const changelog = await text("CHANGELOG.md");
  assert.match(readme, /Current release:\s*v1\.1\.2/i);
  assert.match(changelog, /\[1\.1\.2\]/);
  assert.match(changelog, /\.pay input|employee row|row-based/i);
  assert.match(changelog, /dirty wage|unsaved wage|unrelated.*wage/i);
  assert.match(changelog, /payroll.*diagnostic|diagnostic.*payroll/i);
});
