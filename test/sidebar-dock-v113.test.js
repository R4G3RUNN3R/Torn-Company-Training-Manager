import test from "node:test";
import assert from "node:assert/strict";
import { attachManagerWindow } from "../src/ui/company-manager.js";

async function loadDockModule() {
  try { return await import("../src/ui/manager-dock.js"); }
  catch { return {}; }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.title = "";
    this.textContent = "";
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  prepend(child) { child.parentElement = this; this.children.unshift(child); return child; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  click() { this.listeners.get("click")?.({ preventDefault() {}, stopPropagation() {} }); }
  querySelector(selector) {
    if (selector === "button") return this.children.find(child => child.tagName === "BUTTON") || null;
    if (selector === ".r4-tcm-dock-dot") return this.children.find(child => child.classList.contains("r4-tcm-dock-dot")) || null;
    return null;
  }
  getBoundingClientRect() { return { width: 26, height: 26, left: 0, top: 0 }; }
}

function fakeDocument({ statusBar = true } = {}) {
  const body = new FakeElement("body");
  const status = statusBar ? new FakeElement("ul") : null;
  return {
    body,
    documentElement: body,
    createElement(tag) { return new FakeElement(tag); },
    getElementById(id) {
      const walk = node => {
        if (node.getAttribute?.("id") === id) return node;
        for (const child of node.children || []) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(body) || (status ? walk(status) : null);
    },
    querySelector(selector) {
      if (selector === 'ul[class*="status-icons"]') return status;
      if (selector === ".r4-tcm-dock-icon") return status?.children.find(child => child.classList.contains("r4-tcm-dock-icon")) || null;
      if (selector === "#r4-tcm-dock-fallback") return body.children.find(child => child.getAttribute("id") === "r4-tcm-dock-fallback") || null;
      return null;
    },
    _status: status
  };
}

test("sidebar dock stays visible and toggles the manager", async () => {
  const mod = await loadDockModule();
  assert.equal(typeof mod.mountManagerDock, "function");
  const documentRef = fakeDocument();
  let toggles = 0;
  const dock = mod.mountManagerDock({
    documentRef,
    windowRef: { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) },
    state: { trains: 2, rotation: { nextEmployeeId: 42 }, employees: [{ id: 42, name: "NextPerson" }] },
    isManagerOpen: true,
    onToggle: () => { toggles += 1; },
    MutationObserverImpl: null
  });
  const icon = documentRef.querySelector(".r4-tcm-dock-icon");
  assert.ok(icon);
  assert.equal(icon.parentElement, documentRef._status);
  assert.match(icon.title, /Minimize Company Training Manager/);
  icon.click();
  assert.equal(toggles, 1);
  dock.destroy();
});

test("sidebar dock falls back to a tiny launcher while Torn status bar is absent", async () => {
  const mod = await loadDockModule();
  assert.equal(typeof mod.mountManagerDock, "function");
  const documentRef = fakeDocument({ statusBar: false });
  const dock = mod.mountManagerDock({ documentRef, windowRef: {}, state: {}, onToggle() {}, MutationObserverImpl: null });
  const fallback = documentRef.querySelector("#r4-tcm-dock-fallback");
  assert.ok(fallback);
  assert.equal(fallback.style.display, "block");
  dock.destroy();
});

test("minimized manager disappears instead of retaining its full width", async () => {
  const saved = [];
  const classes = new Set();
  const root = {
    style: {},
    classList: {
      add(name) { classes.add(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    getBoundingClientRect() { return { left: 20, top: 30, width: 700, height: 450 }; },
    setPointerCapture() {}, releasePointerCapture() {}
  };
  const handle = await attachManagerWindow({
    root,
    windowRef: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    ResizeObserverImpl: null,
    uiStorage: {
      async loadManagerUi() { return { x: 20, y: 30, width: 700, height: 450, minimized: false, maximized: false }; },
      async saveManagerUi(value) { saved.push({ ...value }); }
    }
  });

  await handle.toggleMinimize();
  assert.equal(classes.has("r4-tcm-minimized"), true);
  assert.equal(root.style.display, "none");
  assert.equal(saved.at(-1).minimized, true);

  await handle.toggleMinimize();
  assert.equal(root.style.display, "flex");
  assert.equal(root.style.left, "20px");
  assert.equal(root.style.top, "30px");
  assert.equal(root.style.width, "700px");
  assert.equal(root.style.height, "450px");
});