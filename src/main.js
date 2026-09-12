import { StorageRepo } from "./infra/storage.js";
import { TornApiClient, createGmTransport } from "./infra/torn-api.js";
import { CompanyPageActions } from "./infra/company-page-actions.js";
import { TrainingManagerController } from "./app/controller.js";
import { exportNonSecretState, previewImport, applyImport } from "./core/backup.js";
import { deriveAttentionItems, filterAttentionItems } from "./core/notifications.js";
import { renderCompanyManager, attachManagerWindow } from "./ui/company-manager.js";
import { mountManagerDock } from "./ui/manager-dock.js";
import { renderSettingsModal } from "./ui/settings.js";
import { renderAuditLogModal } from "./ui/audit-log.js";
import { renderAttentionModal } from "./ui/attention.js";
import { renderEmployeeMenu } from "./ui/employee-menu.js";
import { mountNativeTrainingIndicators, injectNativeIndicatorStyles } from "./ui/native-indicators.js";
import { backupDownloadName, parseImportText, importPreviewHtml } from "./ui/data-recovery.js";
import { injectStyles } from "./ui/styles.js";

class MutableApiClient {
  constructor({ transport, apiKey = "", nowSeconds }) {
    this.transport = transport;
    this.nowSeconds = nowSeconds;
    this.setApiKey(apiKey);
  }

  setApiKey(key) {
    this.apiKey = String(key || "").trim();
    this.client = this.apiKey ? new TornApiClient({ transport: this.transport, apiKey: this.apiKey, nowSeconds: this.nowSeconds }) : null;
  }

  #needClient() {
    if (!this.client) throw new Error("API key required");
    return this.client;
  }

  getEmployees(...args) { return this.#needClient().getEmployees(...args); }
  getProfile(...args) { return this.#needClient().getProfile(...args); }
  getTrainingNewsSince(...args) { return this.#needClient().getTrainingNewsSince(...args); }
  rebuildTrainingNews(...args) { return this.#needClient().rebuildTrainingNews(...args); }
  validateCapabilities(...args) { return this.#needClient().validateCapabilities(...args); }
}

function directUserscriptGrants() {
  return {
    GM_getValue: typeof GM_getValue === "function" ? GM_getValue : null,
    GM_setValue: typeof GM_setValue === "function" ? GM_setValue : null,
    GM_deleteValue: typeof GM_deleteValue === "function" ? GM_deleteValue : null,
    GM_xmlhttpRequest: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null,
    GM_registerMenuCommand: typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : null
  };
}

function directUserscriptInfo() {
  try { return typeof GM_info === "object" && GM_info ? GM_info : null; } catch { return null; }
}

export function resolveUserscriptGrant(name, { globalRef = globalThis, directGrants = directUserscriptGrants() } = {}) {
  const direct = directGrants?.[name];
  if (typeof direct === "function") return direct;
  try {
    const value = globalRef?.[name];
    return typeof value === "function" ? value : null;
  } catch {
    return null;
  }
}

export function resolveScriptVersion({ globalRef = globalThis, directInfo = directUserscriptInfo() } = {}) {
  let info = directInfo;
  if (!info) {
    try { info = globalRef?.GM_info ?? null; } catch { info = null; }
  }
  const version = info?.script?.version;
  return typeof version === "string" && version.trim() ? version.trim() : "unknown";
}

function makeDefaultGmAdapter() {
  const getValue = resolveUserscriptGrant("GM_getValue");
  const setValue = resolveUserscriptGrant("GM_setValue");
  const deleteValue = resolveUserscriptGrant("GM_deleteValue");
  if (!getValue || !setValue || !deleteValue) throw new Error("Userscript storage APIs are unavailable");
  return {
    getValue: (key, fallback) => getValue(key, fallback),
    setValue: (key, value) => setValue(key, value),
    deleteValue: (key) => deleteValue(key)
  };
}

function hrefOf(windowRef) {
  const loc = windowRef?.location;
  if (!loc) return "https://www.torn.com/";
  return loc.href || String(loc);
}

function isEmployeesTabActive(windowRef, documentRef) {
  try {
    const panel = documentRef?.getElementById?.("employees");
    if (panel) {
      const rects = panel.getClientRects?.();
      const hasVisibleRects = !rects || typeof rects.length !== "number" || rects.length > 0;
      const style = windowRef?.getComputedStyle?.(panel);
      if (hasVisibleRects && (!style || style.display !== "none")) return true;
    }
    const anchor = documentRef?.querySelector?.('a[href="#employees"], a.ui-tabs-anchor[href="#employees"], li[aria-controls="employees"] a');
    const item = anchor?.closest?.('li,[role="tab"]') || documentRef?.querySelector?.('li[aria-controls="employees"], [role="tab"][aria-controls="employees"]');
    if (!item) return false;
    return item.getAttribute?.("aria-selected") === "true" || /\b(ui-tabs-active|ui-state-active)\b/.test(String(item.className || ""));
  } catch {
    return false;
  }
}

export function isJobCompanyArea(windowRef, _documentRef) {
  let url;
  try { url = new URL(hrefOf(windowRef)); } catch { return false; }
  if (!/\/companies\.php$/i.test(url.pathname)) return false;
  const step = url.searchParams.get("step");
  return !step || step === "your";
}

export function isCompanyEmployeesPage(windowRef, documentRef) {
  let url;
  try { url = new URL(hrefOf(windowRef)); } catch { return false; }
  if (!/\/companies\.php$/i.test(url.pathname)) return false;
  const step = url.searchParams.get("step");
  if (step && step !== "your") return false;
  const hash = String(url.hash || "").toLowerCase();
  const explicitEmployeeRoute = hash.includes("employee") || url.searchParams.get("tab") === "employees";
  if (explicitEmployeeRoute) return true;
  if (isEmployeesTabActive(windowRef, documentRef)) return true;
  return Boolean(documentRef?.querySelector?.('ul.employee-list li[data-user] .train button.torn-btn, ul.employee-list li[data-user] .train .train-action, a[href*="step=trainemp2"], a[href*="step=kickemp"]'));
}

function exactEmployeeRow(documentRef, employeeId) {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) return null;
  for (const selector of [
    `ul.employee-list li[data-user="${id}"]`,
    `li[data-user="${id}"]`,
    `tr[data-user="${id}"]`,
    `[data-employee-id="${id}"]`
  ]) {
    try {
      const row = documentRef?.querySelector?.(selector);
      if (row) return row;
    } catch {
      // Torn changes DOM often; try the next exact-ID selector.
    }
  }
  return null;
}

function employeeTabControl(documentRef) {
  const selectors = [
    'a[href="#employees"]',
    'a.ui-tabs-anchor[href="#employees"]',
    'li[aria-controls="employees"] a',
    'a[href*="#/option=employees"]',
    'a[href*="option=employees"]',
    '[role="tab"][aria-controls="employees"]'
  ];
  for (const selector of selectors) {
    try {
      const node = documentRef?.querySelector?.(selector);
      if (node?.click) return node;
    } catch {
      // Try the next known Torn tab selector.
    }
  }
  return null;
}

async function prepareEmployeeTabForTraining({ employeeId, documentRef, windowRef, sleep, maxAttempts = 50 }) {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid employee ID");
  if (!isJobCompanyArea(windowRef, documentRef)) throw new Error("Open Job / Company before training an employee");
  if (exactEmployeeRow(documentRef, id)) return;

  const tab = employeeTabControl(documentRef);
  if (!tab) throw new Error("Could not open Torn's Employees tab automatically");
  tab.click();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (exactEmployeeRow(documentRef, id)) return;
    await sleep(100);
  }
  throw new Error("Torn's Employees tab did not render the selected employee in time");
}

async function defaultMountCompanyUi({ documentRef, windowRef, state, actions, uiStorage, ResizeObserverImpl }) {
  if (!documentRef?.createElement || !documentRef?.body) return { update() {}, destroy() {}, toggleMinimize: async () => {}, restore: async () => {}, isMinimized: () => false };
  let root = documentRef.getElementById?.("r4-tcm-company-root");
  if (!root) {
    root = documentRef.createElement("div");
    root.id = "r4-tcm-company-root";
    documentRef.body.appendChild(root);
  }
  renderCompanyManager(root, state, actions);
  const windowHandle = await attachManagerWindow({ root, uiStorage, windowRef, ResizeObserverImpl });
  return {
    update(nextState) { renderCompanyManager(root, nextState, actions); windowHandle?.sync?.(); },
    toggleMinimize: () => windowHandle?.toggleMinimize?.(),
    restore: () => windowHandle?.restore?.(),
    isMinimized: () => windowHandle?.isMinimized?.() === true,
    destroy() { windowHandle?.destroy?.(); root.remove?.(); }
  };
}

function managerUrlFor(windowRef) {
  try {
    const current = new URL(hrefOf(windowRef));
    const type = current.searchParams.get("type");
    return type ? `https://www.torn.com/companies.php?step=your&type=${encodeURIComponent(type)}#employees` : "https://www.torn.com/companies.php?step=your#employees";
  } catch {
    return "https://www.torn.com/companies.php?step=your#employees";
  }
}

async function copyText(text, { windowRef }) {
  const navigatorRef = windowRef?.navigator ?? globalThis.navigator;
  if (navigatorRef?.clipboard?.writeText) { await navigatorRef.clipboard.writeText(text); return; }
  windowRef?.prompt?.("Copy Training Manager data", text);
}

function downloadJson(payload, { documentRef, windowRef }) {
  try {
    const BlobImpl = windowRef?.Blob ?? globalThis.Blob;
    const URLImpl = windowRef?.URL ?? globalThis.URL;
    if (!BlobImpl || !URLImpl?.createObjectURL || !documentRef?.createElement) return false;
    const blob = new BlobImpl([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URLImpl.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = backupDownloadName(Date.now());
    link.style.display = "none";
    documentRef.body?.appendChild?.(link);
    link.click?.();
    link.remove?.();
    URLImpl.revokeObjectURL?.(url);
    return true;
  } catch {
    return false;
  }
}

function showDiagnosticsModal(diagnostics, { documentRef, windowRef }) {
  if (!documentRef?.createElement || !documentRef?.body) return null;
  const backdrop = documentRef.createElement("div");
  backdrop.className = "r4-tcm-modal-backdrop";
  const modal = documentRef.createElement("div");
  modal.className = "r4-tcm-modal";
  const heading = documentRef.createElement("h3"); heading.textContent = "Diagnostics / Self-Test";
  const pre = documentRef.createElement("pre"); pre.className = "r4-tcm-diagnostics-pre"; pre.textContent = JSON.stringify(diagnostics, null, 2);
  const actions = documentRef.createElement("div"); actions.className = "r4-tcm-actions";
  const copy = documentRef.createElement("button"); copy.className = "r4-tcm-btn"; copy.textContent = "Copy Diagnostics";
  const close = documentRef.createElement("button"); close.className = "r4-tcm-btn"; close.textContent = "Close";
  copy.addEventListener?.("click", () => void copyText(pre.textContent, { windowRef }));
  close.addEventListener?.("click", () => backdrop.remove?.());
  actions.appendChild(copy); actions.appendChild(close); modal.appendChild(heading); modal.appendChild(pre); modal.appendChild(actions); backdrop.appendChild(modal); documentRef.body.appendChild(backdrop);
  return backdrop;
}

async function chooseImportFile({ documentRef, windowRef }) {
  if (!documentRef?.createElement) return null;
  return new Promise((resolve) => {
    const input = documentRef.createElement("input");
    input.type = "file"; input.accept = ".json,application/json"; input.style.display = "none";
    input.addEventListener?.("change", async () => {
      try { resolve(input.files?.[0] ? await input.files[0].text() : null); } catch { resolve(null); }
      input.remove?.();
    });
    documentRef.body?.appendChild?.(input);
    input.click?.();
    if (!input.addEventListener) resolve(windowRef?.prompt?.("Paste Training Manager backup JSON") ?? null);
  });
}

function tomorrowStartSeconds(nowSeconds) {
  const date = new Date(Number(nowSeconds) * 1000);
  date.setHours(24, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

export async function bootstrap(deps = {}) {
  const windowRef = deps.windowRef ?? globalThis.window;
  const documentRef = deps.documentRef ?? globalThis.document;
  const setIntervalImpl = deps.setIntervalImpl ?? globalThis.setInterval?.bind(globalThis);
  const clearIntervalImpl = deps.clearIntervalImpl ?? globalThis.clearInterval?.bind(globalThis);
  const setTimeoutImpl = deps.setTimeoutImpl ?? globalThis.setTimeout?.bind(globalThis);
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? globalThis.clearTimeout?.bind(globalThis);
  const MutationObserverImpl = deps.MutationObserverImpl ?? globalThis.MutationObserver;
  const ResizeObserverImpl = deps.ResizeObserverImpl ?? globalThis.ResizeObserver;
  const injectStylesImpl = deps.injectStylesImpl ?? injectStyles;
  const mountCompanyUi = deps.mountCompanyUi ?? defaultMountCompanyUi;
  const mountManagerDockImpl = deps.mountManagerDockImpl ?? mountManagerDock;
  const registerMenuCommandImpl = deps.registerMenuCommandImpl ?? resolveUserscriptGrant("GM_registerMenuCommand");
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const trainPreparationSleep = deps.trainPreparationSleep ?? ((ms) => new Promise((resolve) => {
    const handle = setTimeoutImpl?.(resolve, ms);
    if (handle == null) resolve();
  }));

  injectStylesImpl(documentRef);
  injectNativeIndicatorStyles(documentRef);
  let storage = deps.storage;
  let mutableApi = deps.mutableApi;
  let controller = deps.controller;
  let pageActions = deps.pageActions;

  if (!controller) {
    storage = storage ?? new StorageRepo(deps.gmAdapter ?? makeDefaultGmAdapter());
    const apiKey = await storage.getApiKey();
    const transport = deps.transport ?? createGmTransport(deps.gmXmlhttpRequest ?? resolveUserscriptGrant("GM_xmlhttpRequest"));
    mutableApi = mutableApi ?? new MutableApiClient({ transport, apiKey, nowSeconds });
    pageActions = pageActions ?? new CompanyPageActions({ document: documentRef, fetchImpl: deps.fetchImpl ?? globalThis.fetch?.bind(globalThis) });
    controller = new TrainingManagerController({ api: mutableApi, storage, pageActions, nowSeconds });
  }

  await controller.initialize();

  const present = (raw = controller.getState()) => ({
    ...raw,
    attention: filterAttentionItems(deriveAttentionItems(raw), raw?.settings || {})
  });
  const diagnosticsSnapshot = () => ({ scriptVersion: resolveScriptVersion(), ...(controller.getDiagnostics?.() ?? {}) });
  const openAuditLog = async () => {
    const audit = await controller.getAudit?.() ?? { entries: [] };
    return renderAuditLogModal({ entries: audit?.entries || [], documentRef, onClear: () => controller.clearAudit?.() ?? { entries: [] } });
  };

  const settingsFacade = {
    updateSettings: (patch) => controller.updateSettings?.(patch),
    rebuildHistory: () => controller.rebuildHistory?.(),
    refresh: () => controller.refresh?.(),
    getState: () => present(controller.getState?.()),
    getApiKey: () => storage?.getApiKey?.() ?? "",
    setApiKey: async (key) => { await storage?.setApiKey?.(key); mutableApi?.setApiKey?.(key); },
    clearApiKey: async () => { await storage?.clearApiKey?.(); mutableApi?.setApiKey?.(""); await controller.refresh?.(); },
    resetNonKeyData: async () => { await storage?.resetNonKeyData?.(); try { windowRef?.location?.reload?.(); } catch {} },
    createPaidAgreement: (...args) => controller.createPaidAgreement?.(...args),
    amendPaidAgreement: (...args) => controller.amendPaidAgreement?.(...args),
    pausePaidAgreement: (...args) => controller.pausePaidAgreement?.(...args),
    resumePaidAgreement: (...args) => controller.resumePaidAgreement?.(...args),
    reorderPaidAgreements: (...args) => controller.reorderPaidAgreements?.(...args),
    closePaidAgreement: (...args) => controller.closePaidAgreement?.(...args)
  };

  const exportData = async () => {
    const payload = await exportNonSecretState(storage, { includeAudit: true, nowSeconds: nowSeconds() });
    if (!downloadJson(payload, { documentRef, windowRef })) await copyText(JSON.stringify(payload, null, 2), { windowRef });
  };
  const importData = async () => {
    const text = await chooseImportFile({ documentRef, windowRef });
    if (!text) return;
    const payload = parseImportText(text);
    const preview = previewImport(payload);
    const summary = importPreviewHtml(preview).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const ok = windowRef?.confirm ? windowRef.confirm(`${summary}\n\nImport this backup?`) : false;
    if (!ok) return;
    await applyImport(storage, payload);
    try { windowRef?.location?.reload?.(); } catch {}
  };

  let actions;
  const openSettings = (activeSection = "general") => renderSettingsModal(present(controller.getState()), settingsFacade, {
    documentRef,
    activeSection,
    openAuditLog,
    openDiagnostics: () => showDiagnosticsModal(diagnosticsSnapshot(), { documentRef, windowRef }),
    exportData,
    importData
  });

  const createPaidForEmployee = async (employee) => {
    const raw = windowRef?.prompt?.(`How many paid trains did ${employee.name} purchase?`, "10");
    if (raw == null) return;
    const trainsPurchased = Number(raw);
    if (!Number.isInteger(trainsPurchased) || trainsPurchased <= 0) throw new TypeError("Paid trains must be a positive whole number");
    await controller.createPaidAgreement?.({ employeeId: Number(employee.id), employeeName: employee.name, trainsPurchased });
  };
  const skipEmployee = async (employeeId) => {
    const choice = String(windowRef?.prompt?.("Skip employee: next, tomorrow, hours, or manual", "next") ?? "").trim().toLowerCase();
    if (!choice) return;
    if (choice === "next") return controller.skipEmployee?.(employeeId, { mode: "next_rotation" });
    if (choice === "tomorrow") return controller.skipEmployee?.(employeeId, { mode: "until_tomorrow", until: tomorrowStartSeconds(nowSeconds()) });
    if (choice === "manual") return controller.skipEmployee?.(employeeId, { mode: "manual" });
    const hours = Number(choice.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(hours) || hours <= 0) throw new TypeError("Custom skip must be a positive number of hours");
    return controller.skipEmployee?.(employeeId, { mode: "timed", until: nowSeconds() + Math.round(hours * 3600) });
  };

  const trainingPreparationLocks = new Set();
  const prepareAndTrain = async (id, options) => {
    const employeeId = Number(id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) throw new Error("Invalid employee ID");
    if (trainingPreparationLocks.has(employeeId)) throw new Error("Training preparation is already in progress for this employee");
    trainingPreparationLocks.add(employeeId);
    try {
      await prepareEmployeeTabForTraining({
        employeeId,
        documentRef,
        windowRef,
        sleep: trainPreparationSleep
      });
      return await controller.trainEmployee?.(employeeId, options);
    } finally {
      trainingPreparationLocks.delete(employeeId);
    }
  };

  actions = {
    refresh: () => controller.refresh?.(),
    trainEmployee: (id, options) => prepareAndTrain(id, options),
    dockPay: (id, wage) => controller.dockPay?.(id, wage),
    restorePay: (id, options) => controller.restorePay?.(id, options),
    getRestoreStateFor: (id) => controller.getRestoreStateFor?.(id),
    getDiagnostics: diagnosticsSnapshot,
    copyDiagnostics: async () => copyText(JSON.stringify(diagnosticsSnapshot(), null, 2), { windowRef }),
    openAuditLog,
    openSettings: () => openSettings("general"),
    openAttention: () => renderAttentionModal(present(controller.getState()).attention, { documentRef }),
    showWhy: (_id, reason) => windowRef?.alert?.(`Training Manager: ${reason}`),
    openEmployeeMenu: (employee, state) => renderEmployeeMenu(employee, state, {
      train: (id, options) => prepareAndTrain(id, options),
      priorityOnce: (id) => controller.setPriorityOnce?.(id),
      createPaid: createPaidForEmployee,
      openPaidSettings: () => openSettings("paid"),
      skip: skipEmployee,
      copy: (text) => copyText(text, { windowRef }),
      dock: async (target) => {
        const raw = windowRef?.prompt?.(`Temporary daily pay for ${target.name}`, String(target.wage ?? 0));
        if (raw == null) return;
        const amount = Number(raw);
        if (!Number.isInteger(amount) || amount < 0) throw new TypeError("Daily pay must be zero or a positive whole number");
        return controller.dockPay?.(target.id, amount);
      },
      details: () => {},
      onError: (error) => actions.onError(error)
    }, { documentRef, windowRef }),
    onError: (error) => { const message = String(error?.message || error || "Training Manager action failed"); try { windowRef?.alert?.(`Training Manager: ${message}`); } catch {} }
  };

  try { registerMenuCommandImpl?.("Company Training Manager: Settings", actions.openSettings); } catch {}

  let mounted = null;
  let mode = "none";
  let destroyed = false;
  let routeTimer = null;
  let intervalId = null;
  let intervalMinutes = null;
  let managerDock = null;

  const destroyMounted = () => { mounted?.destroy?.(); mounted = null; mode = "none"; };
  const desiredMode = () => isJobCompanyArea(windowRef, documentRef) ? "company" : "none";

  const updateNativeIndicators = (state) => {
    if (isCompanyEmployeesPage(windowRef, documentRef)) mountNativeTrainingIndicators({ documentRef, state });
    else mountNativeTrainingIndicators({ documentRef, state: { ...state, settings: { ...(state.settings || {}), showNativeTrainingBadges: false } } });
  };

  const evaluateRoute = async (rawState = controller.getState()) => {
    if (destroyed) return;
    const state = present(rawState);
    updateNativeIndicators(state);
    const desired = desiredMode();
    if (desired === mode) {
      mounted?.update?.(state);
      managerDock?.update?.(state, { managerOpen: desired === "company" ? !mounted?.isMinimized?.() : false });
      return;
    }
    destroyMounted();
    mode = desired;
    if (desired === "company") mounted = await mountCompanyUi({ documentRef, windowRef, state, controller, actions, uiStorage: storage, ResizeObserverImpl });
    managerDock?.update?.(state, { managerOpen: desired === "company" ? !mounted?.isMinimized?.() : false });
  };

  managerDock = mountManagerDockImpl({
    documentRef,
    windowRef,
    state: present(controller.getState()),
    managerUrl: managerUrlFor(windowRef),
    MutationObserverImpl,
    onToggle: async () => {
      if (mode === "company" && mounted?.toggleMinimize) {
        await mounted.toggleMinimize();
        managerDock?.update?.(present(controller.getState()), { managerOpen: !mounted?.isMinimized?.() });
        return;
      }
      try { windowRef.location.href = managerUrlFor(windowRef); } catch {}
    }
  });

  const ensureInterval = (rawState = controller.getState()) => {
    const minutes = Number(rawState?.settings?.refreshMinutes) || 5;
    if (intervalId && intervalMinutes === minutes) return;
    if (intervalId) clearIntervalImpl?.(intervalId);
    intervalMinutes = minutes;
    intervalId = setIntervalImpl?.(() => controller.refresh?.(), minutes * 60_000) ?? null;
  };

  const unsubscribe = controller.subscribe?.((rawState) => {
    const state = present(rawState);
    updateNativeIndicators(state);
    managerDock?.update?.(state, { managerOpen: mode === "company" ? !mounted?.isMinimized?.() : false });
    ensureInterval(rawState);
    void evaluateRoute(rawState);
  }) ?? (() => {});

  ensureInterval(controller.getState());
  await evaluateRoute(controller.getState());
  managerDock?.update?.(present(controller.getState()), { managerOpen: mode === "company" ? !mounted?.isMinimized?.() : false });

  const observer = MutationObserverImpl ? new MutationObserverImpl(() => {
    if (routeTimer) clearTimeoutImpl?.(routeTimer);
    routeTimer = setTimeoutImpl?.(() => { routeTimer = null; void evaluateRoute(controller.getState()); }, 250) ?? null;
  }) : null;
  observer?.observe?.(documentRef?.body ?? documentRef?.documentElement, { childList: true, subtree: true });

  const onUnload = () => {
    if (intervalId) clearIntervalImpl?.(intervalId);
    if (routeTimer) clearTimeoutImpl?.(routeTimer);
    observer?.disconnect?.();
  };
  windowRef?.addEventListener?.("beforeunload", onUnload);

  return {
    controller,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      onUnload();
      unsubscribe();
      managerDock?.destroy?.();
      mountNativeTrainingIndicators({ documentRef, state: { settings: { showNativeTrainingBadges: false } } });
      destroyMounted();
      windowRef?.removeEventListener?.("beforeunload", onUnload);
    }
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrap().catch((error) => { console.error("[TCM] Failed to start:", error?.message || "Unknown error"); });
}
