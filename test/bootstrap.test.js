import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap, isCompanyEmployeesPage } from "../src/main.js";

function state({ showGlobalBadge = true } = {}) {
  return {
    settings: { inactivityDays: 3, maxAddiction: 3, prioritizeNeverTrained: true, showGlobalBadge, showTrainCount: true, refreshMinutes: 5 },
    employees: [], eligibilityById: new Map(), trainingById: new Map(),
    rotation: { nextEmployeeId: null, orderedEligible: [], skipped: [], reasonById: new Map() },
    payroll: { recordsByEmployeeId: {} }, stale: false, trains: 0, status: "ready", lastUpdatedAt: 1, error: null
  };
}

function fakeController(initialState = state()) {
  return {
    current: initialState,
    refreshCalls: 0,
    trainCalls: [],
    listeners: new Set(),
    async initialize() { return this.current; },
    getState() { return this.current; },
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    async refresh() { this.refreshCalls++; return this.current; },
    async trainEmployee(id, options) { this.trainCalls.push({ id: Number(id), options }); return { status: "verified" }; },
    emit(next) { this.current = next; for (const fn of this.listeners) fn(next); }
  };
}

function fakeWindow(url = "https://www.torn.com/index.php") {
  const listeners = new Map();
  return {
    location: new URL(url), innerWidth: 1200, innerHeight: 800,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name) { for (const fn of listeners.get(name) || []) fn(); },
    reloadCalls: 0
  };
}

function fakeDocument({ nativeControls = false } = {}) {
  return {
    nativeControls,
    body: {}, head: {},
    querySelector(selector) {
      if (selector.includes("step=trainemp2") || selector.includes("step=kickemp")) return this.nativeControls ? { href: "x" } : null;
      return null;
    }
  };
}

class FakeMutationObserver {
  static instances = [];
  constructor(cb) { this.cb = cb; this.disconnected = false; FakeMutationObserver.instances.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
  trigger() { this.cb([]); }
}

function harness({ url, nativeControls = false, showGlobalBadge = true } = {}) {
  FakeMutationObserver.instances = [];
  const controller = fakeController(state({ showGlobalBadge }));
  const windowRef = fakeWindow(url);
  const documentRef = fakeDocument({ nativeControls });
  const companyMounts = [];
  const badgeMounts = [];
  const timers = [];
  const cleared = [];
  const menuCommands = [];
  const mountCompanyUi = (ctx) => { const h = { ctx, updates: [], destroyed: false, update(s) { this.updates.push(s); }, destroy() { this.destroyed = true; } }; companyMounts.push(h); return h; };
  const mountGlobalBadgeImpl = async (ctx) => { const h = { ctx, updates: [], destroyed: false, update(s) { this.updates.push(s); }, destroy() { this.destroyed = true; } }; badgeMounts.push(h); return h; };
  const setIntervalImpl = (fn, ms) => { const id = { fn, ms }; timers.push(id); return id; };
  const clearIntervalImpl = (id) => cleared.push(id);
  const setTimeoutImpl = (fn) => { fn(); return 1; };
  const registerMenuCommandImpl = (label, fn) => { menuCommands.push({ label, fn }); return menuCommands.length; };
  return { controller, windowRef, documentRef, companyMounts, badgeMounts, timers, cleared, menuCommands, mountCompanyUi, mountGlobalBadgeImpl, setIntervalImpl, clearIntervalImpl, setTimeoutImpl, registerMenuCommandImpl };
}

test("company employee page mounts full manager", async () => {
  const h = harness({ url: "https://www.torn.com/companies.php?step=your&type=3#employees", nativeControls: true });
  const app = await bootstrap({ ...h, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(h.companyMounts.length, 1);
  assert.equal(h.badgeMounts.length, 0);
  app.destroy();
});

test("company employees route is recognized even before native employee action controls exist", () => {
  const windowRef = fakeWindow("https://www.torn.com/companies.php?step=your#employees");
  const documentRef = fakeDocument({ nativeControls: false });
  assert.equal(isCompanyEmployeesPage(windowRef, documentRef), true);
});

test("active Torn Employees tab mounts the full manager even without legacy train anchors", () => {
  const windowRef = fakeWindow("https://www.torn.com/companies.php?step=your&type=3#");
  const activeTab = {
    className: "ui-tabs-active ui-state-active",
    getAttribute(name) { return name === "aria-selected" ? "true" : null; }
  };
  const documentRef = {
    getElementById() { return null; },
    querySelector(selector) {
      if (selector.includes("step=trainemp2") || selector.includes("step=kickemp")) return null;
      if (selector.includes('aria-controls="employees"')) return activeTab;
      return null;
    }
  };
  assert.equal(isCompanyEmployeesPage(windowRef, documentRef), true);
});

test("other Torn pages never mount the retired global badge", async () => {
  const h = harness({ url: "https://www.torn.com/index.php", nativeControls: false, showGlobalBadge: true });
  const app = await bootstrap({ ...h, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(h.companyMounts.length, 0);
  assert.equal(h.badgeMounts.length, 0);
  app.destroy();
});

test("settings remain reachable from Tampermonkey menu outside Company", async () => {
  const h = harness({ url: "https://www.torn.com/index.php", showGlobalBadge: false });
  const app = await bootstrap({ ...h, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(h.menuCommands.length, 1);
  assert.match(h.menuCommands[0].label, /Training Manager.*Settings/i);
  assert.equal(typeof h.menuCommands[0].fn, "function");
  app.destroy();
});

test("legacy showGlobalBadge state cannot resurrect the retired badge", async () => {
  const enabled = harness({ url: "https://www.torn.com/index.php", showGlobalBadge: true });
  const enabledApp = await bootstrap({ ...enabled, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(enabled.badgeMounts.length, 0);
  enabledApp.destroy();

  const disabled = harness({ url: "https://www.torn.com/index.php", showGlobalBadge: false });
  const disabledApp = await bootstrap({ ...disabled, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(disabled.badgeMounts.length, 0);
  disabledApp.destroy();
});

test("refresh timer uses five minutes and is cleared on beforeunload", async () => {
  const h = harness({ url: "https://www.torn.com/index.php" });
  const app = await bootstrap({ ...h, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(h.timers[0].ms, 300000);
  await h.timers[0].fn();
  assert.equal(h.controller.refreshCalls, 1);
  h.windowRef.dispatch("beforeunload");
  assert.equal(h.cleared.length >= 1, true);
  app.destroy();
});

test("route changes mount the manager only inside Job / Company", async () => {
  const h = harness({ url: "https://www.torn.com/index.php", nativeControls: false });
  const app = await bootstrap({ ...h, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver });
  assert.equal(h.badgeMounts.length, 0);
  assert.equal(h.companyMounts.length, 0);
  h.windowRef.location = new URL("https://www.torn.com/companies.php?step=your&type=3#employees");
  h.documentRef.nativeControls = true;
  FakeMutationObserver.instances[0].trigger();
  await Promise.resolve();
  assert.equal(h.companyMounts.length, 1);
  FakeMutationObserver.instances[0].trigger();
  await Promise.resolve();
  assert.equal(h.companyMounts.length, 1);
  app.destroy();
});

test("Train from another Company tab opens Employees before controller training begins", async () => {
  const h = harness({ url: "https://www.torn.com/companies.php#/option=training", nativeControls: false });
  const originalQuery = h.documentRef.querySelector.bind(h.documentRef);
  let employeeRowReady = false;
  let employeeTabClicks = 0;
  const employeeTab = {
    click() {
      employeeTabClicks++;
      employeeRowReady = true;
      h.windowRef.location = new URL("https://www.torn.com/companies.php#/option=employees");
    },
    closest() { return null; }
  };
  h.documentRef.querySelector = (selector) => {
    if (selector.includes('href="#employees"') || selector.includes('aria-controls="employees"') || selector.includes('option=employees')) return employeeTab;
    if (selector.includes('data-user="4321"') || selector.includes('data-employee-id="4321"')) return employeeRowReady ? {} : null;
    return originalQuery(selector);
  };

  const app = await bootstrap({ ...h, injectStylesImpl() {}, MutationObserverImpl: FakeMutationObserver, trainPreparationSleep: async () => {} });
  assert.equal(h.companyMounts.length, 1);

  const result = await h.companyMounts[0].ctx.actions.trainEmployee(4321);

  assert.equal(employeeTabClicks, 1);
  assert.equal(employeeRowReady, true);
  assert.deepEqual(h.controller.trainCalls, [{ id: 4321, options: undefined }]);
  assert.deepEqual(result, { status: "verified" });
  app.destroy();
});

test("userscript grant resolver prefers direct Tampermonkey bindings when page global has none", async () => {
  const { resolveUserscriptGrant } = await import("../src/main.js");
  const direct = () => "ok";
  const resolved = resolveUserscriptGrant("GM_getValue", { globalRef: {}, directGrants: { GM_getValue: direct } });
  assert.equal(resolved, direct);
});
