import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { bootstrap } from "../src/main.js";
import { mountManagerDock } from "../src/ui/manager-dock.js";
import { attachManagerWindow } from "../src/ui/company-manager.js";

function state(overrides = {}) {
  return {
    settings: { showGlobalBadge: true, refreshMinutes: 5 },
    employees: [{ id: 1, name: "Alice" }],
    eligibilityById: new Map([[1, { eligible: true }]]),
    trainingById: new Map([[1, { count: 0, lastTrainTimestamp: null }]]),
    rotation: { nextEmployeeId: 1, orderedEligible: [{ id: 1, name: "Alice" }], skipped: [] },
    recommendation: { nextEmployeeId: 1, ordered: [{ id: 1, name: "Alice" }] },
    payroll: { recordsByEmployeeId: {} },
    stale: false,
    trains: 4,
    status: "ready",
    lastUpdatedAt: 1,
    error: null,
    ...overrides
  };
}

test("sidebar dock stays visible and toggles the manager", async () => {
  const dom = new JSDOM(`<!doctype html><html><body><div id="mainContainer"><div class="status-icons"></div></div></body></html>`, { url: "https://www.torn.com/companies.php?step=your#employees" });
  let toggles = 0;
  const handle = mountManagerDock({
    documentRef: dom.window.document,
    windowRef: dom.window,
    state: state(),
    onToggle: () => { toggles += 1; }
  });

  const dock = dom.window.document.getElementById("r4-tcm-manager-dock");
  assert.ok(dock);
  assert.match(dock.textContent, /🎓|Training/i);
  dock.querySelector("button")?.click();
  assert.equal(toggles, 1);

  handle.update(state({ trains: 0, recommendation: { nextEmployeeId: null, ordered: [] } }), { managerOpen: false });
  assert.ok(dom.window.document.getElementById("r4-tcm-manager-dock"));
  handle.destroy();
  assert.equal(dom.window.document.getElementById("r4-tcm-manager-dock"), null);
});

test("sidebar dock falls back to a tiny launcher while Torn status bar is absent", () => {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://www.torn.com/companies.php?step=your#employees" });
  const handle = mountManagerDock({ documentRef: dom.window.document, windowRef: dom.window, state: state() });
  const dock = dom.window.document.getElementById("r4-tcm-manager-dock");
  assert.ok(dock);
  assert.equal(dock.classList.contains("r4-tcm-manager-dock-fallback"), true);
  handle.destroy();
});

test("minimized manager shell is hidden while saved geometry remains available for restore", async () => {
  const classes = new Set();
  const root = {
    style: {},
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 20, top: 30, width: 700, height: 450 }; },
    offsetWidth: 700,
    offsetHeight: 450,
    addEventListener() {},
    removeEventListener() {}
  };
  const saved = [];
  const uiStorage = {
    async loadManagerUi() { return { x: 20, y: 30, width: 700, height: 450, minimized: false, maximized: false }; },
    async saveManagerUi(value) { saved.push({ ...value }); return value; }
  };
  const windowRef = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {}
  };

  const handle = await attachManagerWindow({ root, uiStorage, windowRef, ResizeObserverImpl: null });
  assert.equal(root.style.left, "20px");
  assert.equal(root.style.top, "30px");
  assert.equal(root.style.width, "700px");
  assert.equal(root.style.height, "450px");

  await handle.toggleMinimize();
  assert.equal(classes.has("r4-tcm-minimized"), true);
  assert.equal(saved.at(-1).minimized, true);

  await handle.toggleMinimize();
  assert.equal(classes.has("r4-tcm-minimized"), false);
  assert.equal(root.style.left, "20px");
  assert.equal(root.style.top, "30px");
  assert.equal(root.style.width, "700px");
  assert.equal(root.style.height, "450px");
});

test("bootstrap mounts the sidebar dock even when the global badge is disabled", async () => {
  const initialState = {
    settings: { showGlobalBadge: false, refreshMinutes: 5 },
    employees: [], eligibilityById: new Map(), trainingById: new Map(),
    rotation: { nextEmployeeId: null, orderedEligible: [], skipped: [] },
    payroll: { recordsByEmployeeId: {} }, stale: false, trains: 0, status: "ready", lastUpdatedAt: 1, error: null
  };
  const controller = {
    current: initialState,
    listeners: new Set(),
    async initialize() { return this.current; },
    getState() { return this.current; },
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    async refresh() { return this.current; }
  };
  const windowRef = {
    location: new URL("https://www.torn.com/index.php"),
    addEventListener() {}, removeEventListener() {},
    navigator: {}
  };
  const documentRef = { body: {}, head: {}, documentElement: {}, querySelector() { return null; } };
  const dockMounts = [];
  const dockHandle = { updates: [], destroyed: false, update(state) { this.updates.push(state); }, destroy() { this.destroyed = true; } };
  const app = await bootstrap({
    controller,
    storage: {},
    windowRef,
    documentRef,
    injectStylesImpl() {},
    mountCompanyUi() { return { update() {}, destroy() {} }; },
    mountGlobalBadgeImpl() { throw new Error("global badge must remain disabled in this test"); },
    mountManagerDockImpl(ctx) { dockMounts.push(ctx); return dockHandle; },
    registerMenuCommandImpl() {},
    setIntervalImpl() { return 1; },
    clearIntervalImpl() {},
    setTimeoutImpl(fn) { fn(); return 1; },
    clearTimeoutImpl() {},
    MutationObserverImpl: class { observe() {} disconnect() {} }
  });

  assert.equal(dockMounts.length, 1);
  assert.deepEqual(dockMounts[0].state, { ...initialState, attention: [] });
  app.destroy();
  assert.equal(dockHandle.destroyed, true);
});
