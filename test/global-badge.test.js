import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { globalBadgeHtml, mountGlobalBadge } from "../src/ui/global-badge.js";

function state({ error = null } = {}) {
  return {
    settings: { showGlobalBadge: true, showTrainCount: true },
    rotation: { nextEmployeeId: null, orderedEligible: [], skipped: [] },
    employees: [],
    trains: 0,
    stale: true,
    lastUpdatedAt: null,
    error
  };
}

test("missing API key badge exposes an explicit Set API Key control", () => {
  const html = globalBadgeHtml(state({ error: "API key required" }));
  assert.match(html, /Set API Key/i);
  assert.match(html, /data-badge-action="settings"/i);
});

test("global badge always exposes Settings and invokes the settings handler", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.torn.com/index.php" });
  let settingsCalls = 0;
  const uiStorage = {
    async loadUi() { return { x: null, y: null, collapsed: false }; },
    async saveUi() {}
  };
  const mounted = await mountGlobalBadge({
    state: state({ error: "API key required" }),
    uiStorage,
    documentRef: dom.window.document,
    windowRef: dom.window,
    managerUrl: "https://www.torn.com/companies.php?step=your#employees",
    onOpenSettings: () => { settingsCalls += 1; }
  });
  const settingsButton = dom.window.document.querySelector('[data-badge-action="settings"]');
  assert.ok(settingsButton);
  settingsButton.click();
  assert.equal(settingsCalls, 1);
  mounted.destroy();
});
