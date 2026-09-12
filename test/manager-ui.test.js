import test from "node:test";
import assert from "node:assert/strict";
import * as manager from "../src/ui/company-manager.js";
import { TCM_STYLES } from "../src/ui/styles.js";
import { StorageRepo, STORAGE_KEYS } from "../src/infra/storage.js";

function ineligibleState() {
  return {
    status: "ready", stale: false, trains: 2, lastUpdatedAt: 1, error: null, action: null,
    settings: { inactivityDays: 3, maxAddiction: 3 },
    employees: [{ id: 99, name: "SkippedPlayer", wage: 1000, addictionMagnitude: 5, rawAddictionEffectiveness: -5, lastActionRelative: "4 days ago" }],
    eligibilityById: new Map([[99, { eligible: false, unverified: false, inactive: true, addictionViolation: true, inactivitySeconds: 345600, reasons: [{ code: "inactive", actual: 345600, limit: 86400 }, { code: "addiction", actual: 5, limit: 3 }] }]]),
    trainingById: new Map([[99, { totalTrains: 1, lastTrainTimestamp: 1 }]]),
    rotation: { nextEmployeeId: null, orderedEligible: [], skipped: [99] },
    payroll: { recordsByEmployeeId: {} }
  };
}

function emptyState() {
  return {
    status: "ready", stale: false, trains: 0, lastUpdatedAt: 1, error: null, action: null,
    settings: { maxAddiction: 3 }, employees: [], eligibilityById: new Map(), trainingById: new Map(),
    rotation: { nextEmployeeId: null, orderedEligible: [], skipped: [] }, payroll: { recordsByEmployeeId: {} }
  };
}

test("ineligible employee row is explicit and exposes no train control", () => {
  const html = manager.companyManagerHtml(ineligibleState());
  const row = html.match(/<tr[^>]*>[\s\S]*?SkippedPlayer[\s\S]*?<\/tr>/)?.[0] || "";
  assert.match(row, /r4-tcm-row-ineligible/);
  assert.match(row, /data-eligible="false"/);
  assert.doesNotMatch(row, /data-action="train"/);
  assert.match(row, /data-action="dock"/);
});

test("manager styles force readable high-contrast status and table text", () => {
  assert.match(TCM_STYLES, /r4-tcm-table th,.r4-tcm-table td\{[^}]*color:#f4f4f4\s*!important/i);
  assert.match(TCM_STYLES, /r4-tcm-status-ok\{[^}]*#7cff4f[^}]*!important/i);
  assert.match(TCM_STYLES, /r4-tcm-status-bad\{[^}]*#ff6b6b[^}]*!important/i);
  assert.match(TCM_STYLES, /r4-tcm-muted\{[^}]*color:#c7c7c7\s*!important/i);
});

test("manager header exposes minimize, maximize and gear-only settings controls", () => {
  const html = manager.companyManagerHtml(emptyState());
  assert.match(html, /data-window-action="minimize"/);
  assert.match(html, /data-window-action="maximize"/);
  assert.match(html, /data-action="settings"[^>]*aria-label="Settings"/);
  assert.match(html, />⚙<\/button>/);
  assert.doesNotMatch(html, />Settings<\/button>/);
});

test("storage provides separate persisted manager window geometry and mode", async () => {
  const values = new Map();
  const gm = {
    async getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    async setValue(key, value) { values.set(key, value); },
    async deleteValue(key) { values.delete(key); }
  };
  const repo = new StorageRepo(gm);
  assert.equal(typeof repo.loadManagerUi, "function");
  assert.equal(typeof repo.saveManagerUi, "function");
  await repo.saveManagerUi({ x: 120, y: 90, width: 700, height: 480, minimized: true, maximized: false });
  assert.deepEqual(await repo.loadManagerUi(), { schemaVersion: 1, x: 120, y: 90, width: 700, height: 480, minimized: true, maximized: false });
  assert.ok(STORAGE_KEYS.managerUi);
});

test("manager window behavior supports drag, resize persistence, and teardown", async () => {
  assert.equal(typeof manager.attachManagerWindow, "function");
  const listeners = new Map();
  const saved = [];
  let rect = { left: 40, top: 60, width: 640, height: 420 };
  const root = {
    style: {},
    classList: { add() {}, toggle() {} },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    getBoundingClientRect() { return rect; },
    querySelector() { return null; },
    setPointerCapture() {}, releasePointerCapture() {}
  };
  const windowListeners = new Map();
  const windowRef = { innerWidth: 1000, innerHeight: 800, addEventListener(n, fn) { windowListeners.set(n, fn); }, removeEventListener(n) { windowListeners.delete(n); } };
  class FakeResizeObserver {
    static instance;
    constructor(cb) { this.cb = cb; FakeResizeObserver.instance = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger() { this.cb([{ target: root }]); }
  }
  const handle = await manager.attachManagerWindow({
    root, windowRef, ResizeObserverImpl: FakeResizeObserver,
    uiStorage: {
      async loadManagerUi() { return { x: 40, y: 60, width: 640, height: 420, minimized: false, maximized: false }; },
      async saveManagerUi(value) { saved.push({ ...value }); }
    }
  });
  assert.equal(root.style.left, "40px");
  assert.equal(root.style.top, "60px");
  assert.equal(root.style.width, "640px");
  assert.equal(root.style.height, "420px");

  const target = { closest(selector) { if (selector === ".r4-tcm-header") return {}; if (selector.includes("button")) return null; return null; } };
  listeners.get("pointerdown")({ target, clientX: 60, clientY: 80, pointerId: 1 });
  listeners.get("pointermove")({ target, clientX: 160, clientY: 180, pointerId: 1 });
  listeners.get("pointerup")({ target, pointerId: 1 });
  assert.equal(root.style.left, "140px");
  assert.equal(root.style.top, "160px");
  assert.equal(saved.at(-1).x, 140);
  assert.equal(saved.at(-1).y, 160);

  rect = { left: 140, top: 160, width: 720, height: 500 };
  FakeResizeObserver.instance.trigger();
  await Promise.resolve();
  assert.equal(saved.at(-1).width, 720);
  assert.equal(saved.at(-1).height, 500);

  handle.destroy();
  assert.equal(listeners.size, 0);
  assert.equal(FakeResizeObserver.instance.disconnected, true);
});

test("manager window can minimize fully into launcher, maximize and restore normal geometry", async () => {
  const saved = [];
  const classes = new Set();
  const root = {
    style: {},
    classList: {
      add(name) { classes.add(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 20, top: 30, width: 700, height: 450 }; },
    setPointerCapture() {}, releasePointerCapture() {}
  };
  const handle = await manager.attachManagerWindow({
    root,
    windowRef: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    ResizeObserverImpl: null,
    uiStorage: {
      async loadManagerUi() { return { x: 20, y: 30, width: 700, height: 450, minimized: false, maximized: false }; },
      async saveManagerUi(value) { saved.push({ ...value }); }
    }
  });

  assert.equal(typeof handle.toggleMinimize, "function");
  assert.equal(typeof handle.toggleMaximize, "function");
  assert.equal(typeof handle.restore, "function");

  await handle.toggleMinimize();
  assert.equal(classes.has("r4-tcm-minimized"), true);
  assert.equal(root.style.display, "none");
  assert.equal(saved.at(-1).minimized, true);
  assert.equal(saved.at(-1).width, 700);
  assert.equal(saved.at(-1).height, 450);

  await handle.restore();
  assert.equal(root.style.display, "block");
  assert.equal(root.style.width, "700px");
  assert.equal(root.style.height, "450px");

  await handle.toggleMaximize();
  assert.equal(classes.has("r4-tcm-maximized"), true);
  assert.equal(root.style.left, "8px");
  assert.equal(root.style.top, "8px");
  assert.equal(root.style.width, "1184px");
  assert.equal(root.style.height, "784px");
  assert.equal(saved.at(-1).maximized, true);

  await handle.toggleMaximize();
  assert.equal(root.style.left, "20px");
  assert.equal(root.style.top, "30px");
  assert.equal(root.style.width, "700px");
  assert.equal(root.style.height, "450px");
});

test("manager window uses intended defaults when no geometry has been saved", async () => {
  const root = {
    style: {}, classList: { add() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    getBoundingClientRect() { return { left: 16, top: 80, width: 760, height: 560 }; }
  };
  const handle = await manager.attachManagerWindow({
    root,
    windowRef: { innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {} },
    ResizeObserverImpl: null,
    uiStorage: { async loadManagerUi() { return { x: null, y: null, width: null, height: null, minimized: false, maximized: false }; }, async saveManagerUi() {} }
  });
  assert.equal(root.style.left, "16px");
  assert.equal(root.style.top, "80px");
  assert.equal(root.style.width, "760px");
  assert.equal(root.style.height, "560px");
  handle.destroy();
});

test("unsaved manager geometry remains null in storage so UI defaults can apply", async () => {
  const gm = {
    async getValue(_key, fallback) { return fallback; },
    async setValue() {},
    async deleteValue() {}
  };
  const repo = new StorageRepo(gm);
  assert.deepEqual(await repo.loadManagerUi(), { schemaVersion: 1, x: null, y: null, width: null, height: null, minimized: false, maximized: false });
});
