import { StorageRepo } from "./infra/storage.js";
import { TornApiClient, createGmTransport } from "./infra/torn-api.js";
import { CompanyPageActions } from "./infra/company-page-actions.js";
import { TrainingManagerController } from "./app/controller.js";
import { renderCompanyManager } from "./ui/company-manager.js";
import { mountGlobalBadge } from "./ui/global-badge.js";
import { renderSettingsModal } from "./ui/settings.js";
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

export function isCompanyEmployeesPage(windowRef, documentRef) {
  let url;
  try { url = new URL(hrefOf(windowRef)); } catch { return false; }
  if (!/\/companies\.php$/i.test(url.pathname)) return false;
  if (url.searchParams.get("step") !== "your") return false;

  const hash = String(url.hash || "").toLowerCase();
  const explicitEmployeeRoute = hash.includes("employee") || url.searchParams.get("tab") === "employees";
  if (explicitEmployeeRoute) return true;

  return Boolean(documentRef?.querySelector?.('a[href*="step=trainemp2"], a[href*="step=kickemp"]'));
}

function defaultMountCompanyUi({ documentRef, state, actions }) {
  if (!documentRef?.createElement || !documentRef?.body) return { update() {}, destroy() {} };
  let root = documentRef.getElementById?.("r4-tcm-company-root");
  if (!root) {
    root = documentRef.createElement("div");
    root.id = "r4-tcm-company-root";
    const nativeLink = documentRef.querySelector?.('a[href*="step=trainemp2"], a[href*="step=kickemp"]');
    const form = nativeLink?.closest?.("form") || documentRef.querySelector?.("form");
    const preferred = documentRef.querySelector?.("#companyroot, .company-wrap, .content-wrapper");
    if (form?.parentNode?.insertBefore) form.parentNode.insertBefore(root, form);
    else if (preferred?.prepend) preferred.prepend(root);
    else documentRef.body.prepend?.(root);
  }
  renderCompanyManager(root, state, actions);
  return {
    update(nextState) { renderCompanyManager(root, nextState, actions); },
    destroy() { root.remove?.(); }
  };
}

function managerUrlFor(windowRef) {
  try {
    const current = new URL(hrefOf(windowRef));
    const type = current.searchParams.get("type");
    return type
      ? `https://www.torn.com/companies.php?step=your&type=${encodeURIComponent(type)}#employees`
      : "https://www.torn.com/companies.php?step=your#employees";
  } catch {
    return "https://www.torn.com/companies.php?step=your#employees";
  }
}

export async function bootstrap(deps = {}) {
  const windowRef = deps.windowRef ?? globalThis.window;
  const documentRef = deps.documentRef ?? globalThis.document;
  const setIntervalImpl = deps.setIntervalImpl ?? globalThis.setInterval?.bind(globalThis);
  const clearIntervalImpl = deps.clearIntervalImpl ?? globalThis.clearInterval?.bind(globalThis);
  const setTimeoutImpl = deps.setTimeoutImpl ?? globalThis.setTimeout?.bind(globalThis);
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? globalThis.clearTimeout?.bind(globalThis);
  const MutationObserverImpl = deps.MutationObserverImpl ?? globalThis.MutationObserver;
  const injectStylesImpl = deps.injectStylesImpl ?? injectStyles;
  const mountCompanyUi = deps.mountCompanyUi ?? defaultMountCompanyUi;
  const mountGlobalBadgeImpl = deps.mountGlobalBadgeImpl ?? mountGlobalBadge;
  const registerMenuCommandImpl = deps.registerMenuCommandImpl ?? resolveUserscriptGrant("GM_registerMenuCommand");
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  injectStylesImpl(documentRef);

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

  const settingsFacade = {
    updateSettings: (patch) => controller.updateSettings?.(patch),
    rebuildHistory: () => controller.rebuildHistory?.(),
    refresh: () => controller.refresh?.(),
    getApiKey: () => storage?.getApiKey?.() ?? "",
    setApiKey: async (key) => {
      await storage?.setApiKey?.(key);
      mutableApi?.setApiKey?.(key);
    },
    clearApiKey: async () => {
      await storage?.clearApiKey?.();
      mutableApi?.setApiKey?.("");
      await controller.refresh?.();
    },
    resetNonKeyData: async () => {
      await storage?.resetNonKeyData?.();
      try { windowRef?.location?.reload?.(); } catch {}
    }
  };

  const actions = {
    refresh: () => controller.refresh?.(),
    trainEmployee: (id) => controller.trainEmployee?.(id),
    dockPay: (id, wage) => controller.dockPay?.(id, wage),
    restorePay: (id, options) => controller.restorePay?.(id, options),
    getRestoreStateFor: (id) => controller.getRestoreStateFor?.(id),
    openSettings: () => renderSettingsModal(controller.getState(), settingsFacade, { documentRef }),
    onError: (error) => {
      const message = String(error?.message || error || "Training Manager action failed");
      try { windowRef?.alert?.(`Training Manager: ${message}`); } catch {}
    }
  };

  try {
    registerMenuCommandImpl?.("Company Training Manager: Settings", actions.openSettings);
  } catch {}

  let mounted = null;
  let mode = "none";
  let destroyed = false;
  let routeTimer = null;
  let intervalId = null;
  let intervalMinutes = null;

  const destroyMounted = () => {
    mounted?.destroy?.();
    mounted = null;
    mode = "none";
  };

  const desiredMode = (state) => {
    if (isCompanyEmployeesPage(windowRef, documentRef)) return "company";
    if (state?.settings?.showGlobalBadge !== false) return "badge";
    return "none";
  };

  const evaluateRoute = async (state = controller.getState()) => {
    if (destroyed) return;
    const desired = desiredMode(state);
    if (desired === mode) {
      mounted?.update?.(state);
      return;
    }
    destroyMounted();
    mode = desired;
    if (desired === "company") {
      mounted = await mountCompanyUi({ documentRef, windowRef, state, controller, actions });
    } else if (desired === "badge") {
      mounted = await mountGlobalBadgeImpl({
        state,
        controller,
        uiStorage: storage,
        documentRef,
        windowRef,
        managerUrl: managerUrlFor(windowRef),
        onOpenSettings: actions.openSettings
      });
    }
  };

  const ensureInterval = (state = controller.getState()) => {
    const minutes = Number(state?.settings?.refreshMinutes) || 5;
    if (intervalId && intervalMinutes === minutes) return;
    if (intervalId) clearIntervalImpl?.(intervalId);
    intervalMinutes = minutes;
    intervalId = setIntervalImpl?.(() => controller.refresh?.(), minutes * 60_000) ?? null;
  };

  const unsubscribe = controller.subscribe?.((state) => {
    ensureInterval(state);
    void evaluateRoute(state);
  }) ?? (() => {});

  ensureInterval(controller.getState());
  await evaluateRoute(controller.getState());

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
      destroyMounted();
      windowRef?.removeEventListener?.("beforeunload", onUnload);
    }
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrap().catch((error) => {
    console.error("[TCM] Failed to start:", error?.message || "Unknown error");
  });
}
