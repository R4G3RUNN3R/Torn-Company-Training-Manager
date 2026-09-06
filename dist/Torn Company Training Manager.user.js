// ==UserScript==
// @name         Torn Company Training Manager
// @namespace    r4g3runn3r.company.training.manager
// @version      1.0.4
// @description  Fair company train rotation with activity/addiction eligibility and safe pay controls.
// @author       R4G3RUNN3R
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  // src/core/constants.js
  var SECONDS_PER_DAY = 86400;
  var SCHEMA_VERSION = 1;
  var DEFAULT_SETTINGS = Object.freeze({
    inactivityDays: 1,
    maxAddiction: 3,
    prioritizeNeverTrained: true,
    showGlobalBadge: true,
    showTrainCount: true,
    refreshMinutes: 5
  });

  // src/core/history.js
  function emptyHistoryState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      eventsByNewsId: {},
      unresolvedByNewsId: {},
      newestTimestamp: 0
    };
  }
  function toText(value) {
    return typeof value === "string" ? value : "";
  }
  function decodeBasicEntities(text) {
    return text.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'").replace(/&nbsp;/gi, " ");
  }
  function stripTags(html) {
    return decodeBasicEntities(toText(html).replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  }
  function parseIdAndName(html) {
    if (typeof DOMParser !== "undefined") {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        for (const anchor of doc.querySelectorAll("a[href]")) {
          const match = anchor.getAttribute("href")?.match(/[?&]XID=(\d+)/i);
          if (match) return { id: Number(match[1]), name: anchor.textContent?.trim() || "" };
        }
      } catch {
      }
    }
    const anchorMatch = html.match(/<a\b[^>]*href=["'][^"']*[?&]XID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (anchorMatch) {
      return { id: Number(anchorMatch[1]), name: stripTags(anchorMatch[2]) };
    }
    const idMatch = html.match(/[?&]XID=(\d+)/i);
    return idMatch ? { id: Number(idMatch[1]), name: "" } : null;
  }
  function normalizeNewsId(news) {
    const value = news?.id ?? news?.ID ?? news?.newsId;
    if (value === null || value === void 0 || value === "") return null;
    return String(value);
  }
  function normalizeTimestamp(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  }
  function parseTrainingNewsItem(news = {}) {
    const newsId = normalizeNewsId(news);
    const timestamp = normalizeTimestamp(news.timestamp);
    const text = toText(news.text ?? news.news ?? news.html);
    const unresolvedBase = { newsId, timestamp, text };
    if (!/has\s+been\s+trained\s+by\s+the\s+director/i.test(stripTags(text))) {
      return { resolved: false, unresolved: { ...unresolvedBase, reason: "not_training_event" } };
    }
    const identity = parseIdAndName(text);
    if (!identity || !Number.isInteger(identity.id)) {
      return { resolved: false, unresolved: { ...unresolvedBase, reason: "missing_employee_id" } };
    }
    return {
      resolved: true,
      event: {
        newsId,
        employeeId: identity.id,
        employeeNameAtTime: identity.name,
        timestamp,
        source: "company_news"
      }
    };
  }
  function mergeTrainingNews(historyState, newsItems = []) {
    const base = historyState && typeof historyState === "object" ? historyState : emptyHistoryState();
    const next = {
      schemaVersion: SCHEMA_VERSION,
      eventsByNewsId: { ...base.eventsByNewsId || {} },
      unresolvedByNewsId: { ...base.unresolvedByNewsId || {} },
      newestTimestamp: Number(base.newestTimestamp) || 0
    };
    for (const news of Array.isArray(newsItems) ? newsItems : []) {
      const newsId = normalizeNewsId(news);
      const ts = normalizeTimestamp(news?.timestamp);
      next.newestTimestamp = Math.max(next.newestTimestamp, ts);
      if (!newsId || next.eventsByNewsId[newsId] || next.unresolvedByNewsId[newsId]) continue;
      const parsed = parseTrainingNewsItem(news);
      if (parsed.resolved) next.eventsByNewsId[newsId] = parsed.event;
      else next.unresolvedByNewsId[newsId] = parsed.unresolved;
    }
    return next;
  }
  function summarizeTrainingHistory(historyState, currentEmployees = []) {
    const byEmployee = /* @__PURE__ */ new Map();
    const currentIds = new Set((currentEmployees || []).map((employee) => Number(employee.id)).filter(Number.isFinite));
    for (const id of currentIds) {
      byEmployee.set(id, { employeeId: id, totalTrains: 0, lastTrainTimestamp: null, events: [] });
    }
    const events = Object.values(historyState?.eventsByNewsId || {}).sort((a, b) => a.timestamp - b.timestamp);
    for (const event of events) {
      if (!currentIds.has(Number(event.employeeId))) continue;
      const summary = byEmployee.get(Number(event.employeeId));
      summary.totalTrains += 1;
      summary.lastTrainTimestamp = Math.max(summary.lastTrainTimestamp ?? 0, Number(event.timestamp) || 0) || null;
      summary.events.push(event);
    }
    return byEmployee;
  }

  // src/infra/storage.js
  var STORAGE_KEYS = Object.freeze({
    apiKey: "r4_tcm_api_key",
    settings: "r4_tcm_settings",
    history: "r4_tcm_history",
    payroll: "r4_tcm_payroll",
    cache: "r4_tcm_cache",
    ui: "r4_tcm_ui",
    managerUi: "r4_tcm_manager_ui"
  });
  var DEFAULT_PAYROLL = Object.freeze({ schemaVersion: SCHEMA_VERSION, recordsByEmployeeId: {} });
  var DEFAULT_CACHE = Object.freeze({ schemaVersion: SCHEMA_VERSION, employees: [], trains: null, profile: null, lastUpdatedAt: null });
  var DEFAULT_UI = Object.freeze({ schemaVersion: SCHEMA_VERSION, x: null, y: null, collapsed: false });
  var DEFAULT_MANAGER_UI = Object.freeze({ schemaVersion: SCHEMA_VERSION, x: null, y: null, width: null, height: null, minimized: false, maximized: false });
  var SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function isRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }
  function finiteNumberOrNull(value) {
    if (value === null || value === void 0 || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function defaultSettings() {
    return { schemaVersion: SCHEMA_VERSION, ...DEFAULT_SETTINGS };
  }
  var StorageRepo = class {
    constructor(gm) {
      if (!gm?.getValue || !gm?.setValue || !gm?.deleteValue) throw new TypeError("GM storage adapter is required");
      this.gm = gm;
    }
    async #get(key, fallback) {
      try {
        return await this.gm.getValue(key, clone(fallback));
      } catch {
        return clone(fallback);
      }
    }
    async loadSettings() {
      const raw = await this.#get(STORAGE_KEYS.settings, defaultSettings());
      if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return defaultSettings();
      const out = defaultSettings();
      for (const key of SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = raw[key];
      }
      return out;
    }
    async saveSettings(settings = {}) {
      const current = await this.loadSettings();
      const out = { ...current, schemaVersion: SCHEMA_VERSION };
      for (const key of SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) out[key] = settings[key];
      }
      await this.gm.setValue(STORAGE_KEYS.settings, clone(out));
      return out;
    }
    async loadHistory() {
      const fallback = emptyHistoryState();
      const raw = await this.#get(STORAGE_KEYS.history, fallback);
      if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !isRecord(raw.eventsByNewsId) || !isRecord(raw.unresolvedByNewsId)) return fallback;
      return {
        schemaVersion: SCHEMA_VERSION,
        eventsByNewsId: clone(raw.eventsByNewsId),
        unresolvedByNewsId: clone(raw.unresolvedByNewsId),
        newestTimestamp: Number.isFinite(Number(raw.newestTimestamp)) ? Number(raw.newestTimestamp) : 0
      };
    }
    async saveHistory(state = {}) {
      const out = {
        schemaVersion: SCHEMA_VERSION,
        eventsByNewsId: isRecord(state.eventsByNewsId) ? clone(state.eventsByNewsId) : {},
        unresolvedByNewsId: isRecord(state.unresolvedByNewsId) ? clone(state.unresolvedByNewsId) : {},
        newestTimestamp: Number.isFinite(Number(state.newestTimestamp)) ? Number(state.newestTimestamp) : 0
      };
      await this.gm.setValue(STORAGE_KEYS.history, out);
      return out;
    }
    async loadPayroll() {
      const raw = await this.#get(STORAGE_KEYS.payroll, DEFAULT_PAYROLL);
      if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !isRecord(raw.recordsByEmployeeId)) return clone(DEFAULT_PAYROLL);
      return { schemaVersion: SCHEMA_VERSION, recordsByEmployeeId: clone(raw.recordsByEmployeeId) };
    }
    async savePayroll(state = {}) {
      const out = { schemaVersion: SCHEMA_VERSION, recordsByEmployeeId: isRecord(state.recordsByEmployeeId) ? clone(state.recordsByEmployeeId) : {} };
      await this.gm.setValue(STORAGE_KEYS.payroll, out);
      return out;
    }
    async loadCache() {
      const raw = await this.#get(STORAGE_KEYS.cache, DEFAULT_CACHE);
      if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.employees)) return clone(DEFAULT_CACHE);
      return {
        schemaVersion: SCHEMA_VERSION,
        employees: clone(raw.employees),
        trains: raw.trains ?? null,
        profile: isRecord(raw.profile) ? clone(raw.profile) : null,
        lastUpdatedAt: Number.isFinite(Number(raw.lastUpdatedAt)) ? Number(raw.lastUpdatedAt) : null
      };
    }
    async saveCache(state = {}) {
      const out = {
        schemaVersion: SCHEMA_VERSION,
        employees: Array.isArray(state.employees) ? clone(state.employees) : [],
        trains: state.trains ?? null,
        profile: isRecord(state.profile) ? clone(state.profile) : null,
        lastUpdatedAt: Number.isFinite(Number(state.lastUpdatedAt)) ? Number(state.lastUpdatedAt) : null
      };
      await this.gm.setValue(STORAGE_KEYS.cache, out);
      return out;
    }
    async loadUi() {
      const raw = await this.#get(STORAGE_KEYS.ui, DEFAULT_UI);
      if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return clone(DEFAULT_UI);
      return {
        schemaVersion: SCHEMA_VERSION,
        x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : null,
        y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : null,
        collapsed: Boolean(raw.collapsed)
      };
    }
    async saveUi(state = {}) {
      const out = {
        schemaVersion: SCHEMA_VERSION,
        x: Number.isFinite(Number(state.x)) ? Number(state.x) : null,
        y: Number.isFinite(Number(state.y)) ? Number(state.y) : null,
        collapsed: Boolean(state.collapsed)
      };
      await this.gm.setValue(STORAGE_KEYS.ui, out);
      return out;
    }
    async loadManagerUi() {
      const raw = await this.#get(STORAGE_KEYS.managerUi, DEFAULT_MANAGER_UI);
      if (!isRecord(raw) || raw.schemaVersion !== SCHEMA_VERSION) return clone(DEFAULT_MANAGER_UI);
      return {
        schemaVersion: SCHEMA_VERSION,
        x: finiteNumberOrNull(raw.x),
        y: finiteNumberOrNull(raw.y),
        width: finiteNumberOrNull(raw.width),
        height: finiteNumberOrNull(raw.height),
        minimized: Boolean(raw.minimized),
        maximized: Boolean(raw.maximized)
      };
    }
    async saveManagerUi(state = {}) {
      const out = {
        schemaVersion: SCHEMA_VERSION,
        x: finiteNumberOrNull(state.x),
        y: finiteNumberOrNull(state.y),
        width: finiteNumberOrNull(state.width),
        height: finiteNumberOrNull(state.height),
        minimized: Boolean(state.minimized),
        maximized: Boolean(state.maximized)
      };
      if (out.maximized) out.minimized = false;
      await this.gm.setValue(STORAGE_KEYS.managerUi, out);
      return out;
    }
    async getApiKey() {
      const value = await this.#get(STORAGE_KEYS.apiKey, "");
      return typeof value === "string" ? value : "";
    }
    async setApiKey(key) {
      const value = String(key ?? "").trim();
      await this.gm.setValue(STORAGE_KEYS.apiKey, value);
    }
    async clearApiKey() {
      await this.gm.deleteValue(STORAGE_KEYS.apiKey);
    }
    async resetNonKeyData() {
      await Promise.all([
        this.gm.deleteValue(STORAGE_KEYS.settings),
        this.gm.deleteValue(STORAGE_KEYS.history),
        this.gm.deleteValue(STORAGE_KEYS.payroll),
        this.gm.deleteValue(STORAGE_KEYS.cache),
        this.gm.deleteValue(STORAGE_KEYS.ui),
        this.gm.deleteValue(STORAGE_KEYS.managerUi)
      ]);
    }
  };

  // src/core/normalize.js
  function finiteNumber(value) {
    if (value === null || value === void 0 || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function parseUnixSeconds(value) {
    const n = finiteNumber(value);
    if (n === null || n < 0) return null;
    return Math.trunc(n);
  }
  function normalizeAddiction(rawValue) {
    const n = finiteNumber(rawValue);
    return n === null ? null : Math.abs(n);
  }
  function normalizeEmployee(raw = {}, nowSeconds = Math.floor(Date.now() / 1e3)) {
    const id = finiteNumber(raw.id ?? raw.ID ?? raw.user_id);
    const wage = finiteNumber(raw.wage);
    const joinedAt = parseUnixSeconds(raw.joined_at);
    const lastActionTimestamp = parseUnixSeconds(raw.last_action?.timestamp);
    const rawAddictionEffectiveness = finiteNumber(raw.effectiveness?.addiction);
    const rawInactivityEffectiveness = finiteNumber(raw.effectiveness?.inactivity);
    const effectivenessTotal = finiteNumber(raw.effectiveness?.total);
    const daysInCompany = finiteNumber(raw.days_in_company);
    const position = raw.position ?? null;
    const positionName = typeof position === "string" ? position : position?.name ?? null;
    const positionId = typeof position === "object" && position ? finiteNumber(position.id) : null;
    const normalizedNow = parseUnixSeconds(nowSeconds);
    const inactivitySeconds = lastActionTimestamp === null || normalizedNow === null ? null : Math.max(0, normalizedNow - lastActionTimestamp);
    return {
      id: id === null ? null : Math.trunc(id),
      name: typeof raw.name === "string" ? raw.name : "",
      positionId: positionId === null ? null : Math.trunc(positionId),
      positionName,
      daysInCompany: daysInCompany === null ? null : daysInCompany,
      joinedAt,
      wage: wage === null ? null : Math.trunc(wage),
      lastActionTimestamp,
      lastActionRelative: typeof raw.last_action?.relative === "string" ? raw.last_action.relative : null,
      lastActionStatus: typeof raw.last_action?.status === "string" ? raw.last_action.status : null,
      rawAddictionEffectiveness,
      addictionMagnitude: normalizeAddiction(rawAddictionEffectiveness),
      rawInactivityEffectiveness,
      effectivenessTotal,
      stats: raw.stats && typeof raw.stats === "object" ? { ...raw.stats } : null,
      inactivitySeconds
    };
  }

  // src/infra/torn-api.js
  var API_ORIGIN = "https://api.torn.com";
  var API_BASE = `${API_ORIGIN}/v2/company`;
  var COMMENT = "R4G3RUNN3R Training Manager";
  var COMMENT_Q = encodeURIComponent(COMMENT);
  function asEmployeeArray(response) {
    const raw = response?.employees ?? response?.company?.employees ?? [];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return Object.entries(raw).map(([id, value]) => ({ id: Number(value?.id ?? id), ...value }));
    return [];
  }
  function asProfile(response) {
    return response?.profile ?? response?.company ?? response ?? {};
  }
  function asNewsArray(response) {
    const raw = response?.news ?? response?.companynews ?? response?.company_news ?? [];
    return Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  }
  function metadataNext(response) {
    return response?._metadata?.links?.next ?? response?.metadata?.links?.next ?? null;
  }
  function safeApiUrl(value) {
    try {
      const url = new URL(value, API_ORIGIN);
      return url.protocol === "https:" && url.hostname === "api.torn.com";
    } catch {
      return false;
    }
  }
  function sanitizeMessage(message, key) {
    let text = typeof message === "string" ? message : "Torn API error";
    if (key) text = text.split(key).join("[redacted]");
    return text;
  }
  var TornApiError = class extends Error {
    constructor(message, { code = null, status = null } = {}) {
      super(message);
      this.name = "TornApiError";
      this.code = code;
      this.status = status;
    }
  };
  function validateDirectorCapabilities({ employeesResponse, profileResponse }) {
    const missing = [];
    const employees = asEmployeeArray(employeesResponse);
    const profile = asProfile(profileResponse);
    if (!("trains" in profile) || !Number.isFinite(Number(profile.trains))) missing.push("profile.trains");
    if (employees.length > 0) {
      const sample = employees[0];
      if (!("wage" in sample) || !Number.isFinite(Number(sample.wage))) missing.push("employees.wage");
      if (!("joined_at" in sample) || !Number.isFinite(Number(sample.joined_at))) missing.push("employees.joined_at");
      if (!sample.effectiveness || !Number.isFinite(Number(sample.effectiveness.addiction))) missing.push("employees.effectiveness.addiction");
      if (!sample.last_action || !Number.isFinite(Number(sample.last_action.timestamp))) missing.push("employees.last_action.timestamp");
    }
    return { ok: missing.length === 0, missing };
  }
  function createGmTransport(gmXmlhttpRequest) {
    if (typeof gmXmlhttpRequest !== "function") throw new TypeError("GM_xmlhttpRequest is required");
    return {
      requestJson({ method = "GET", url, headers = {} }) {
        return new Promise((resolve, reject) => {
          gmXmlhttpRequest({
            method,
            url,
            headers,
            timeout: 3e4,
            onload(response) {
              if (response.status < 200 || response.status >= 300) {
                reject(new TornApiError(`Torn API HTTP ${response.status}`, { status: response.status }));
                return;
              }
              try {
                resolve(JSON.parse(response.responseText));
              } catch {
                reject(new TornApiError("Torn API returned invalid JSON", { status: response.status }));
              }
            },
            onerror() {
              reject(new TornApiError("Torn API network error"));
            },
            ontimeout() {
              reject(new TornApiError("Torn API request timed out"));
            },
            onabort() {
              reject(new TornApiError("Torn API request aborted"));
            }
          });
        });
      }
    };
  }
  var TornApiClient = class {
    constructor({ transport, apiKey, nowSeconds = () => Math.floor(Date.now() / 1e3) }) {
      if (!transport?.requestJson) throw new TypeError("Transport is required");
      this.transport = transport;
      this.apiKey = String(apiKey ?? "").trim();
      this.nowSeconds = nowSeconds;
    }
    #headers() {
      return this.apiKey ? { Authorization: `ApiKey ${this.apiKey}` } : {};
    }
    async #request(url) {
      const payload = await this.transport.requestJson({ method: "GET", url, headers: this.#headers() });
      if (payload?.error) {
        const code = payload.error.code ?? null;
        const message = sanitizeMessage(payload.error.error ?? payload.error.message ?? "Torn API error", this.apiKey);
        throw new TornApiError(message, { code });
      }
      return payload;
    }
    async getEmployees({ raw = false } = {}) {
      const response = await this.#request(`${API_BASE}/employees?comment=${COMMENT_Q}`);
      if (raw) return response;
      return asEmployeeArray(response).map((item) => normalizeEmployee(item, this.nowSeconds()));
    }
    async getProfile({ raw = false } = {}) {
      const response = await this.#request(`${API_BASE}/profile?comment=${COMMENT_Q}`);
      return raw ? response : asProfile(response);
    }
    async validateCapabilities() {
      const [employeesResponse, profileResponse] = await Promise.all([this.getEmployees({ raw: true }), this.getProfile({ raw: true })]);
      return validateDirectorCapabilities({ employeesResponse, profileResponse });
    }
    async getTrainingNewsPage({ from = null, url = null } = {}) {
      let requestUrl = url;
      if (!requestUrl) {
        const params = new URLSearchParams({ cat: "training", limit: "100", sort: "DESC", comment: COMMENT });
        if (from !== null && from !== void 0 && Number.isFinite(Number(from))) params.set("from", String(Math.trunc(Number(from))));
        requestUrl = `${API_BASE}/news?${params.toString()}`;
      }
      if (!safeApiUrl(requestUrl)) throw new TornApiError("Unsafe Torn API pagination URL");
      const response = await this.#request(requestUrl);
      return { news: asNewsArray(response), next: metadataNext(response), raw: response };
    }
    async #collectNews({ from = null, onProgress = null } = {}) {
      const news = [];
      const seenUrls = /* @__PURE__ */ new Set();
      let page = 0;
      let nextUrl = null;
      while (page < 100) {
        let pageResult;
        if (page === 0) {
          pageResult = await this.getTrainingNewsPage({ from });
        } else {
          if (!safeApiUrl(nextUrl)) return { news, complete: false, reason: "unsafe_next_url" };
          if (seenUrls.has(nextUrl)) return { news, complete: false, reason: "repeated_next_url" };
          seenUrls.add(nextUrl);
          pageResult = await this.getTrainingNewsPage({ url: nextUrl });
        }
        news.push(...pageResult.news);
        page += 1;
        if (typeof onProgress === "function") onProgress({ page, count: news.length });
        nextUrl = pageResult.next;
        if (!nextUrl) return { news, complete: true, reason: null };
        if (!safeApiUrl(nextUrl)) return { news, complete: false, reason: "unsafe_next_url" };
        if (page === 1) seenUrls.delete(nextUrl);
      }
      return { news, complete: false, reason: "page_limit" };
    }
    async getTrainingNewsSince(timestamp) {
      return this.#collectNews({ from: timestamp });
    }
    async rebuildTrainingNews(onProgress) {
      return this.#collectNews({ onProgress });
    }
  };

  // src/infra/company-page-actions.js
  function parseMoney(value) {
    if (value === null || value === void 0) return null;
    const cleaned = String(value).replace(/[$,\s]/g, "");
    if (!/^-?\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isSafeInteger(n) ? n : null;
  }
  function toArray(value) {
    return Array.from(value || []);
  }
  function exactEmployeeIdFromHref(href, step) {
    try {
      const url = new URL(href, "https://www.torn.com");
      if (url.searchParams.get("step") !== step) return null;
      const id = url.searchParams.get("ID");
      return /^\d+$/.test(id || "") ? Number(id) : null;
    } catch {
      return null;
    }
  }
  function isSameOrigin(url, origin = "https://www.torn.com") {
    try {
      return new URL(url, origin).origin === origin;
    } catch {
      return false;
    }
  }
  function findForm(document2) {
    const forms = toArray(document2?.querySelectorAll?.("form"));
    const candidates = forms.filter((form) => {
      try {
        const buttons = toArray(form.querySelectorAll?.("button, input[type='submit']"));
        if (buttons.length === 0 && form.controls) return true;
        return buttons.some((button2) => /SUBMIT\s+CHANGES/i.test(button2.textContent || button2.value || ""));
      } catch {
        return false;
      }
    });
    if (candidates.length === 1) return candidates[0];
    if (forms.length === 1) return forms[0];
    return null;
  }
  function closestEmployeeRow(link) {
    if (!link?.closest) return null;
    const selectors = [
      "tr",
      "li",
      "[data-employee-id]",
      "[class*='employee']",
      "[class*='Employee']",
      "[class*='row']",
      "[class*='Row']",
      "div"
    ];
    for (const selector of selectors) {
      try {
        const row = link.closest(selector);
        if (row) return row;
      } catch {
      }
    }
    return null;
  }
  function rowControls(row) {
    if (!row?.querySelectorAll) return [];
    return toArray(row.querySelectorAll("input, select, textarea"));
  }
  function controlValue(control) {
    return parseMoney(control?.value);
  }
  var CompanyPageActions = class {
    constructor({ document: document2, fetchImpl = globalThis.fetch?.bind(globalThis), formDataFactory = (form) => new FormData(form) } = {}) {
      if (!document2) throw new TypeError("document is required");
      if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
      this.document = document2;
      this.fetchImpl = fetchImpl;
      this.formDataFactory = formDataFactory;
    }
    #origin() {
      return this.document?.location?.origin || globalThis.location?.origin || "https://www.torn.com";
    }
    #trainLinksFor(employeeId) {
      const links = toArray(this.document.querySelectorAll?.('a[href*="step=trainemp2"]'));
      return links.filter((link) => exactEmployeeIdFromHref(link.href || link.getAttribute?.("href"), "trainemp2") === Number(employeeId));
    }
    findTrainHref(employeeId) {
      const links = this.#trainLinksFor(employeeId);
      if (links.length !== 1) return null;
      const href = links[0].href || links[0].getAttribute?.("href");
      if (!isSameOrigin(href, this.#origin())) return null;
      return new URL(href, this.#origin()).href;
    }
    async submitTrain(employeeId) {
      const href = this.findTrainHref(employeeId);
      if (!href) return { status: "unsafe_dom", reason: "train_link_not_unique" };
      try {
        const response = await this.fetchImpl(href, { method: "GET", credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
        const text = typeof response.text === "function" ? await response.text() : "";
        if (!response.ok) return { status: "http_failed", httpStatus: response.status, text };
        return { status: "submitted", httpStatus: response.status, text };
      } catch (error) {
        return { status: "http_failed", reason: "network_error", error: String(error?.message || error) };
      }
    }
    #rowForEmployee(employeeId) {
      const links = this.#trainLinksFor(employeeId);
      if (links.length !== 1) return null;
      return closestEmployeeRow(links[0]);
    }
    inspectPayrollForm(apiWagesById) {
      const form = findForm(this.document);
      if (!form) return { safe: false, reason: "payroll_form_not_unique", targets: /* @__PURE__ */ new Map() };
      const targets = /* @__PURE__ */ new Map();
      const entries = apiWagesById instanceof Map ? [...apiWagesById.entries()] : Object.entries(apiWagesById || {}).map(([id, wage]) => [Number(id), wage]);
      for (const [rawId, rawWage] of entries) {
        const employeeId = Number(rawId);
        const apiWage = Number(rawWage);
        if (!Number.isInteger(employeeId) || !Number.isInteger(apiWage)) return { safe: false, reason: "invalid_api_wage", targets };
        const row = this.#rowForEmployee(employeeId);
        if (!row) return { safe: false, reason: "employee_row_not_unique", employeeId, targets };
        const controls = rowControls(row).filter((control) => control?.name && !control.disabled && controlValue(control) !== null);
        const exact = controls.filter((control) => controlValue(control) === apiWage);
        if (exact.length > 1) return { safe: false, reason: "ambiguous_target_wage_input", employeeId, targets };
        if (exact.length === 0) {
          const numeric = controls.filter((control) => /wage|pay|salary/i.test(control.name || ""));
          if (numeric.length > 0) return { safe: false, reason: "unrelated_dirty_wage", employeeId, targets };
          return { safe: false, reason: "wage_input_not_found", employeeId, targets };
        }
        targets.set(employeeId, { row, input: exact[0], apiWage });
      }
      return { safe: true, reason: null, form, targets };
    }
    async submitWageChange({ employeeId, targetWage, apiWagesById }) {
      if (!Number.isInteger(targetWage) || targetWage < 0) return { status: "unsafe_dom", reason: "invalid_target_wage" };
      const inspection = this.inspectPayrollForm(apiWagesById);
      if (!inspection.safe) return { status: "unsafe_dom", reason: inspection.reason, employeeId: inspection.employeeId };
      const target = inspection.targets.get(Number(employeeId));
      if (!target) return { status: "unsafe_dom", reason: "target_employee_not_found" };
      const form = inspection.form;
      const action = form.action || this.#origin();
      if (!isSameOrigin(action, this.#origin())) return { status: "unsafe_dom", reason: "cross_origin_form_action" };
      const method = String(form.method || "POST").toUpperCase();
      const body = this.formDataFactory(form);
      body.set(target.input.name, String(targetWage));
      try {
        const response = await this.fetchImpl(new URL(action, this.#origin()).href, {
          method,
          body,
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        const text = typeof response.text === "function" ? await response.text() : "";
        if (!response.ok) return { status: "http_failed", httpStatus: response.status, text };
        return { status: "submitted", httpStatus: response.status, text };
      } catch (error) {
        return { status: "http_failed", reason: "network_error", error: String(error?.message || error) };
      }
    }
  };

  // src/core/eligibility.js
  function validPolicy(settings) {
    return settings && Number.isFinite(Number(settings.maxAddiction)) && Number(settings.maxAddiction) >= 0;
  }
  function evaluateEligibility(employee, settings, nowSeconds = Math.floor(Date.now() / 1e3)) {
    const reasons = [];
    let unverified = false;
    let inactive = false;
    let addictionViolation = false;
    let inactivitySeconds = null;
    if (!validPolicy(settings)) {
      return {
        eligible: false,
        unverified: true,
        inactive: false,
        addictionViolation: false,
        reasons: [{ code: "unverified_policy" }],
        inactivitySeconds: null
      };
    }
    const lastAction = employee?.lastActionTimestamp;
    if (!Number.isFinite(lastAction)) {
      unverified = true;
      reasons.push({ code: "unverified_activity" });
    } else {
      inactivitySeconds = Math.max(0, Number(nowSeconds) - Number(lastAction));
      if (inactivitySeconds > SECONDS_PER_DAY) {
        inactive = true;
        reasons.push({ code: "inactive", actual: inactivitySeconds, limit: SECONDS_PER_DAY });
      }
    }
    const addiction = employee?.addictionMagnitude;
    if (!Number.isFinite(addiction)) {
      unverified = true;
      reasons.push({ code: "unverified_addiction" });
    } else if (Number(addiction) > Number(settings.maxAddiction)) {
      addictionViolation = true;
      reasons.push({ code: "addiction", actual: Number(addiction), limit: Number(settings.maxAddiction) });
    }
    return {
      eligible: !unverified && !inactive && !addictionViolation,
      unverified,
      inactive,
      addictionViolation,
      reasons,
      inactivitySeconds
    };
  }

  // src/core/rotation.js
  function getFrom(mapLike, id) {
    if (mapLike instanceof Map) return mapLike.get(id);
    return mapLike?.[id] ?? mapLike?.[String(id)];
  }
  function joinedAtValue(employee) {
    return Number.isFinite(Number(employee?.joinedAt)) ? Number(employee.joinedAt) : Number.MAX_SAFE_INTEGER;
  }
  function idValue(employee) {
    const n = Number(employee?.id);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  }
  function historyInfo(trainingById, id) {
    const summary = getFrom(trainingById, id) || {};
    const totalTrains = Number.isFinite(Number(summary.totalTrains)) ? Number(summary.totalTrains) : 0;
    const last = Number.isFinite(Number(summary.lastTrainTimestamp)) ? Number(summary.lastTrainTimestamp) : null;
    return { totalTrains, lastTrainTimestamp: last };
  }
  function rankTrainingCandidates({ employees = [], eligibilityById, trainingById, settings = {} } = {}) {
    const prioritizeNeverTrained = settings.prioritizeNeverTrained !== false;
    const eligibleRows = [];
    const skipped = [];
    const reasonById = /* @__PURE__ */ new Map();
    for (const employee of [...employees]) {
      const eligibility = getFrom(eligibilityById, employee.id);
      const history = historyInfo(trainingById, employee.id);
      const row = { ...employee, trainingSummary: { ...history } };
      if (!eligibility?.eligible) {
        skipped.push(row);
        reasonById.set(employee.id, "skipped_ineligible");
        continue;
      }
      eligibleRows.push(row);
    }
    eligibleRows.sort((a, b) => {
      const ah = a.trainingSummary;
      const bh = b.trainingSummary;
      const aNever = ah.totalTrains === 0;
      const bNever = bh.totalTrains === 0;
      if (prioritizeNeverTrained && aNever !== bNever) return aNever ? -1 : 1;
      if (prioritizeNeverTrained && aNever && bNever) {
        return joinedAtValue(a) - joinedAtValue(b) || idValue(a) - idValue(b);
      }
      const aLast = ah.lastTrainTimestamp ?? 0;
      const bLast = bh.lastTrainTimestamp ?? 0;
      return aLast - bLast || joinedAtValue(a) - joinedAtValue(b) || idValue(a) - idValue(b);
    });
    eligibleRows.forEach((employee, index) => {
      const history = employee.trainingSummary;
      if (history.totalTrains === 0) reasonById.set(employee.id, "never_trained");
      else if (index === 0) reasonById.set(employee.id, "oldest_last_train");
      else reasonById.set(employee.id, "queued");
    });
    skipped.sort((a, b) => idValue(a) - idValue(b));
    return {
      orderedEligible: eligibleRows,
      skipped,
      nextEmployeeId: eligibleRows[0]?.id ?? null,
      reasonById
    };
  }

  // src/core/payroll.js
  function assertWage(value, label = "wage") {
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  }
  function nowInt(nowSeconds) {
    const n = Number(nowSeconds);
    return Number.isFinite(n) ? Math.trunc(n) : Math.floor(Date.now() / 1e3);
  }
  function createDockRecord(employee, targetWage, eligibility, nowSeconds = Math.floor(Date.now() / 1e3)) {
    assertWage(targetWage, "Target wage");
    if (!employee || !Number.isFinite(Number(employee.id))) throw new TypeError("Employee id is required");
    if (!Number.isInteger(employee.wage) || employee.wage < 0) throw new TypeError("Current wage is required");
    return {
      employeeId: Number(employee.id),
      previousPay: employee.wage,
      requestedDockedPay: targetWage,
      dockedPay: null,
      dockedAt: nowInt(nowSeconds),
      dockVerifiedAt: null,
      reasonsAtDock: Array.isArray(eligibility?.reasons) ? eligibility.reasons.map((r) => ({ ...r })) : [],
      restoredAt: null
    };
  }
  function markDockVerified(record, currentWage, nowSeconds = Math.floor(Date.now() / 1e3)) {
    assertWage(currentWage, "Current wage");
    if (!record) throw new TypeError("Dock record is required");
    if (currentWage !== record.requestedDockedPay) throw new Error("Current wage does not match requested docked wage");
    return {
      ...record,
      dockedPay: currentWage,
      dockVerifiedAt: nowInt(nowSeconds)
    };
  }
  function employeeEligible(employee) {
    if (typeof employee?.eligible === "boolean") return employee.eligible;
    if (typeof employee?.eligibility?.eligible === "boolean") return employee.eligibility.eligible;
    return false;
  }
  function getRestoreState(record, employee) {
    const active = Boolean(record?.dockVerifiedAt) && record?.restoredAt == null && Number.isInteger(record?.dockedPay);
    const eligible = employeeEligible(employee);
    const available = active && eligible;
    let warning = null;
    if (available && Number.isInteger(employee?.wage) && employee.wage !== record.dockedPay) warning = "current_wage_changed";
    return {
      available,
      warning,
      restoreWage: available ? record.previousPay : null
    };
  }
  function markRestoreVerified(record, nowSeconds = Math.floor(Date.now() / 1e3)) {
    if (!record?.dockVerifiedAt || record.restoredAt != null) throw new Error("Dock record is not active");
    return { ...record, restoredAt: nowInt(nowSeconds) };
  }

  // src/app/controller.js
  var emptyRotation = () => ({ orderedEligible: [], skipped: [], nextEmployeeId: null, reasonById: /* @__PURE__ */ new Map() });
  function employeeMap(employees) {
    return new Map((employees || []).map((employee) => [Number(employee.id), employee]));
  }
  function wagesMap(employees) {
    return new Map((employees || []).filter((e) => Number.isInteger(e.wage)).map((e) => [Number(e.id), e.wage]));
  }
  function validSettingsPatch(patch) {
    if (Object.prototype.hasOwnProperty.call(patch, "inactivityDays")) {
      if (!Number.isFinite(Number(patch.inactivityDays)) || Number(patch.inactivityDays) < 0) return false;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "maxAddiction")) {
      if (!Number.isInteger(Number(patch.maxAddiction)) || Number(patch.maxAddiction) < 0) return false;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "refreshMinutes")) {
      if (!Number.isFinite(Number(patch.refreshMinutes)) || Number(patch.refreshMinutes) <= 0) return false;
    }
    return true;
  }
  var TrainingManagerController = class {
    constructor({ api, storage, pageActions, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), nowSeconds = () => Math.floor(Date.now() / 1e3) }) {
      if (!api || !storage || !pageActions) throw new TypeError("api, storage and pageActions are required");
      this.api = api;
      this.storage = storage;
      this.pageActions = pageActions;
      this.sleep = sleep;
      this.nowSeconds = nowSeconds;
      this.listeners = /* @__PURE__ */ new Set();
      this.refreshPromise = null;
      this.actionLocks = /* @__PURE__ */ new Set();
      this.unverifiedTrainIds = /* @__PURE__ */ new Set();
      this.state = {
        status: "idle",
        stale: true,
        lastUpdatedAt: null,
        employees: [],
        eligibilityById: /* @__PURE__ */ new Map(),
        trainingById: /* @__PURE__ */ new Map(),
        rotation: emptyRotation(),
        trains: null,
        profile: null,
        history: emptyHistoryState(),
        payroll: { schemaVersion: 1, recordsByEmployeeId: {} },
        settings: null,
        action: null,
        error: null
      };
    }
    getState() {
      return this.state;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    #emit(patch = {}) {
      this.state = { ...this.state, ...patch };
      for (const listener of this.listeners) {
        try {
          listener(this.state);
        } catch {
        }
      }
    }
    #recompute(extra = {}) {
      const employees = extra.employees ?? this.state.employees;
      const history = extra.history ?? this.state.history;
      const settings = extra.settings ?? this.state.settings;
      const eligibilityById = /* @__PURE__ */ new Map();
      if (settings) {
        for (const employee of employees) eligibilityById.set(Number(employee.id), evaluateEligibility(employee, settings, this.nowSeconds()));
      }
      const trainingById = summarizeTrainingHistory(history, employees);
      const rotation = settings ? rankTrainingCandidates({ employees, eligibilityById, trainingById, settings }) : emptyRotation();
      this.#emit({ employees, history, settings, eligibilityById, trainingById, rotation, ...extra });
    }
    async initialize() {
      const [settings, history, payroll, cache] = await Promise.all([
        this.storage.loadSettings(),
        this.storage.loadHistory(),
        this.storage.loadPayroll(),
        this.storage.loadCache()
      ]);
      this.state = {
        ...this.state,
        settings,
        history,
        payroll,
        employees: Array.isArray(cache.employees) ? cache.employees : [],
        trains: cache.trains ?? null,
        profile: cache.profile ?? null,
        lastUpdatedAt: cache.lastUpdatedAt ?? null,
        stale: true,
        status: "loading"
      };
      this.#recompute();
      await this.refresh();
      return this.state;
    }
    async refresh() {
      if (this.refreshPromise) return this.refreshPromise;
      this.refreshPromise = this.#refreshInternal().finally(() => {
        this.refreshPromise = null;
      });
      return this.refreshPromise;
    }
    async #refreshInternal() {
      this.#emit({ status: "refreshing", error: null });
      try {
        const [employees, profile] = await Promise.all([this.api.getEmployees(), this.api.getProfile()]);
        const capabilityMissing = [];
        if (!Number.isFinite(Number(profile?.trains))) capabilityMissing.push("profile.trains");
        if (employees.length > 0) {
          const sample = employees[0];
          if (!Number.isInteger(sample?.wage) || sample.wage < 0) capabilityMissing.push("employees.wage");
          if (!Number.isFinite(Number(sample?.joinedAt))) capabilityMissing.push("employees.joined_at");
          if (!Number.isFinite(Number(sample?.rawAddictionEffectiveness))) capabilityMissing.push("employees.effectiveness.addiction");
          if (!Number.isFinite(Number(sample?.lastActionTimestamp))) capabilityMissing.push("employees.last_action.timestamp");
        }
        if (capabilityMissing.length) throw new Error(`Director API capability validation failed: ${capabilityMissing.join(", ")}`);
        const newsResult = await this.api.getTrainingNewsSince(this.state.history?.newestTimestamp || 0);
        const history = mergeTrainingNews(this.state.history, newsResult?.news || []);
        await this.storage.saveHistory(history);
        const trains = Number.isFinite(Number(profile?.trains)) ? Number(profile.trains) : null;
        const lastUpdatedAt = this.nowSeconds();
        await this.storage.saveCache({ employees, trains, profile, lastUpdatedAt });
        this.unverifiedTrainIds.clear();
        this.#recompute({
          employees,
          profile,
          trains,
          history,
          stale: false,
          lastUpdatedAt,
          status: newsResult?.complete === false ? "partial" : "ready",
          error: newsResult?.complete === false ? `Training news sync incomplete: ${newsResult.reason || "unknown"}` : null,
          action: null
        });
      } catch (error) {
        this.#emit({ status: "error", stale: true, error: String(error?.message || "Unable to refresh Torn data"), action: null });
      }
      return this.state;
    }
    async rebuildHistory() {
      if (this.state.stale) throw new Error("Cannot rebuild history while current data is stale");
      this.#emit({ status: "rebuilding_history", action: { type: "history", status: "pending" } });
      const result = await this.api.rebuildTrainingNews();
      const history = mergeTrainingNews(emptyHistoryState(), result.news || []);
      await this.storage.saveHistory(history);
      this.#recompute({ history, status: result.complete ? "ready" : "partial", action: { type: "history", status: result.complete ? "verified" : "incomplete" } });
      return { status: result.complete ? "verified" : "incomplete", reason: result.reason || null };
    }
    #assertFresh() {
      if (this.state.stale) throw new Error("Current company data is stale; refresh before making changes");
    }
    #employee(id) {
      return employeeMap(this.state.employees).get(Number(id)) || null;
    }
    #eligibility(id) {
      return this.state.eligibilityById.get(Number(id)) || null;
    }
    async trainEmployee(id) {
      id = Number(id);
      this.#assertFresh();
      if (this.unverifiedTrainIds.has(id)) throw new Error("Previous train attempt is unverified; refresh before retrying");
      if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
      const employee = this.#employee(id);
      const eligibility = this.#eligibility(id);
      if (!employee) throw new Error("Employee not found");
      if (!eligibility?.eligible) throw new Error("Employee is not eligible for training");
      if (!Number.isFinite(Number(this.state.trains)) || Number(this.state.trains) <= 0) throw new Error("No company trains are available");
      this.actionLocks.add(id);
      this.#emit({ action: { type: "train", employeeId: id, status: "pending" } });
      try {
        const beforeIds = new Set(Object.keys(this.state.history.eventsByNewsId || {}));
        const submitted = await this.pageActions.submitTrain(id);
        if (submitted?.status !== "submitted") {
          this.#emit({ action: { type: "train", employeeId: id, status: "failed", reason: submitted?.reason || submitted?.status } });
          return { status: "failed", reason: submitted?.reason || submitted?.status };
        }
        let workingHistory = this.state.history;
        let verified = false;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt > 0) await this.sleep(1500);
          const newsResult = await this.api.getTrainingNewsSince(workingHistory.newestTimestamp || 0);
          workingHistory = mergeTrainingNews(workingHistory, newsResult.news || []);
          verified = Object.entries(workingHistory.eventsByNewsId || {}).some(([newsId, event]) => !beforeIds.has(newsId) && Number(event.employeeId) === id);
          if (verified) break;
        }
        await this.storage.saveHistory(workingHistory);
        if (!verified) {
          this.unverifiedTrainIds.add(id);
          this.#recompute({ history: workingHistory, action: { type: "train", employeeId: id, status: "unverified" } });
          return { status: "unverified" };
        }
        this.#recompute({ history: workingHistory });
        await this.refresh();
        this.#emit({ action: { type: "train", employeeId: id, status: "verified" } });
        return { status: "verified" };
      } catch (error) {
        this.#emit({ action: { type: "train", employeeId: id, status: "failed", reason: String(error?.message || error) } });
        throw error;
      } finally {
        this.actionLocks.delete(id);
      }
    }
    async #pollWage(employeeId, targetWage) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await this.sleep(1500);
        const employees = await this.api.getEmployees();
        const target = employeeMap(employees).get(Number(employeeId));
        if (target?.wage === targetWage) return { verified: true, employees, employee: target };
      }
      return { verified: false };
    }
    async dockPay(id, targetWage) {
      id = Number(id);
      this.#assertFresh();
      if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
      const employee = this.#employee(id);
      const eligibility = this.#eligibility(id);
      if (!employee) throw new Error("Employee not found");
      if (eligibility?.eligible) throw new Error("Eligible employees cannot have pay docked by this policy tool");
      if (eligibility?.unverified) throw new Error("Eligibility is unverified; pay docking is disabled");
      const record = createDockRecord(employee, targetWage, eligibility, this.nowSeconds());
      this.actionLocks.add(id);
      this.#emit({ action: { type: "dock", employeeId: id, status: "pending" } });
      try {
        const submitted = await this.pageActions.submitWageChange({ employeeId: id, targetWage, apiWagesById: wagesMap(this.state.employees) });
        if (submitted?.status !== "submitted") {
          this.#emit({ action: { type: "dock", employeeId: id, status: "failed", reason: submitted?.reason || submitted?.status } });
          return { status: "failed", reason: submitted?.reason || submitted?.status };
        }
        const poll = await this.#pollWage(id, targetWage);
        if (!poll.verified) {
          this.#emit({ stale: true, action: { type: "dock", employeeId: id, status: "unverified" } });
          return { status: "unverified" };
        }
        const verifiedRecord = markDockVerified(record, targetWage, this.nowSeconds());
        const payroll = {
          ...this.state.payroll,
          recordsByEmployeeId: { ...this.state.payroll.recordsByEmployeeId || {}, [id]: verifiedRecord }
        };
        await this.storage.savePayroll(payroll);
        this.#emit({ payroll });
        await this.refresh();
        this.#emit({ action: { type: "dock", employeeId: id, status: "verified" } });
        return { status: "verified", record: verifiedRecord };
      } finally {
        this.actionLocks.delete(id);
      }
    }
    getRestoreStateFor(id) {
      id = Number(id);
      const record = this.state.payroll?.recordsByEmployeeId?.[id] ?? this.state.payroll?.recordsByEmployeeId?.[String(id)];
      const employee = this.#employee(id);
      const eligibility = this.#eligibility(id);
      if (!record || !employee) return { available: false, warning: null, restoreWage: null };
      return getRestoreState(record, { ...employee, eligibility });
    }
    async restorePay(id, { confirmMismatch = false } = {}) {
      id = Number(id);
      this.#assertFresh();
      if (this.actionLocks.has(id)) throw new Error("An action is already pending for this employee");
      const record = this.state.payroll?.recordsByEmployeeId?.[id] ?? this.state.payroll?.recordsByEmployeeId?.[String(id)];
      const employee = this.#employee(id);
      if (!record || !employee) throw new Error("No active dock record exists for this employee");
      const restoreState = this.getRestoreStateFor(id);
      if (!restoreState.available) throw new Error("Employee is not yet eligible for pay restoration");
      if (restoreState.warning === "current_wage_changed" && !confirmMismatch) throw new Error("Current wage changed; explicit mismatch confirmation is required");
      this.actionLocks.add(id);
      this.#emit({ action: { type: "restore", employeeId: id, status: "pending" } });
      try {
        const targetWage = restoreState.restoreWage;
        const submitted = await this.pageActions.submitWageChange({ employeeId: id, targetWage, apiWagesById: wagesMap(this.state.employees) });
        if (submitted?.status !== "submitted") {
          this.#emit({ action: { type: "restore", employeeId: id, status: "failed", reason: submitted?.reason || submitted?.status } });
          return { status: "failed", reason: submitted?.reason || submitted?.status };
        }
        const poll = await this.#pollWage(id, targetWage);
        if (!poll.verified) {
          this.#emit({ stale: true, action: { type: "restore", employeeId: id, status: "unverified" } });
          return { status: "unverified" };
        }
        const restoredRecord = markRestoreVerified(record, this.nowSeconds());
        const payroll = {
          ...this.state.payroll,
          recordsByEmployeeId: { ...this.state.payroll.recordsByEmployeeId || {}, [id]: restoredRecord }
        };
        await this.storage.savePayroll(payroll);
        this.#emit({ payroll });
        await this.refresh();
        this.#emit({ action: { type: "restore", employeeId: id, status: "verified" } });
        return { status: "verified", record: restoredRecord };
      } finally {
        this.actionLocks.delete(id);
      }
    }
    async updateSettings(patch = {}) {
      if (!validSettingsPatch(patch)) throw new TypeError("Invalid training manager settings");
      const settings = await this.storage.saveSettings({ ...this.state.settings, ...patch });
      this.#recompute({ settings });
      return settings;
    }
  };

  // src/ui/dom.js
  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function formatMoney(value) {
    return Number.isFinite(Number(value)) ? `$${Math.trunc(Number(value)).toLocaleString("en-US")}` : "\u2014";
  }
  function formatDateTime(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return "Never";
    try {
      return new Date(Number(seconds) * 1e3).toLocaleString();
    } catch {
      return "\u2014";
    }
  }
  function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "Unknown";
    const total = Math.floor(Number(seconds));
    const d = Math.floor(total / 86400);
    const h = Math.floor(total % 86400 / 3600);
    const m = Math.floor(total % 3600 / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function byId(mapLike, id) {
    if (mapLike instanceof Map) return mapLike.get(Number(id));
    return mapLike?.[id] ?? mapLike?.[String(id)];
  }

  // src/ui/modals.js
  function makeBackdrop(documentRef, title, message) {
    const backdrop = documentRef.createElement("div");
    backdrop.className = "r4-tcm-modal-backdrop";
    backdrop.innerHTML = `<div class="r4-tcm-modal"><h3>${escapeHtml(title)}</h3><div>${message}</div><div class="r4-tcm-modal-actions"></div></div>`;
    documentRef.body.appendChild(backdrop);
    return backdrop;
  }
  function button(documentRef, text, className = "") {
    const btn = documentRef.createElement("button");
    btn.type = "button";
    btn.className = `r4-tcm-btn ${className}`.trim();
    btn.textContent = text;
    return btn;
  }
  function showConfirmModal({ title = "Confirm", message = "Are you sure?", confirmText = "Confirm", cancelText = "Cancel", danger = false, documentRef = globalThis.document } = {}) {
    if (!documentRef?.body) return Promise.resolve(false);
    return new Promise((resolve) => {
      const backdrop = makeBackdrop(documentRef, title, typeof message === "string" ? message : "");
      const actions = backdrop.querySelector(".r4-tcm-modal-actions");
      const cancel = button(documentRef, cancelText);
      const confirm = button(documentRef, confirmText, danger ? "r4-tcm-btn-danger" : "r4-tcm-btn-primary");
      const finish = (value) => {
        backdrop.remove();
        resolve(value);
      };
      cancel.addEventListener("click", () => finish(false));
      confirm.addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      actions.append(cancel, confirm);
    });
  }
  function showNumberPrompt({ title = "Enter amount", message = "", initialValue = "", min = 0, documentRef = globalThis.document } = {}) {
    if (!documentRef?.body) return Promise.resolve(null);
    return new Promise((resolve) => {
      const backdrop = makeBackdrop(documentRef, title, message);
      const modal = backdrop.querySelector(".r4-tcm-modal");
      const actions = backdrop.querySelector(".r4-tcm-modal-actions");
      const input = documentRef.createElement("input");
      input.type = "number";
      input.min = String(min);
      input.step = "1";
      input.value = String(initialValue ?? "");
      modal.insertBefore(input, actions);
      const cancel = button(documentRef, "Cancel");
      const confirm = button(documentRef, "Apply", "r4-tcm-btn-primary");
      const finish = (value) => {
        backdrop.remove();
        resolve(value);
      };
      cancel.addEventListener("click", () => finish(null));
      confirm.addEventListener("click", () => {
        const value = Number(input.value);
        if (!Number.isInteger(value) || value < min) {
          input.setCustomValidity(`Enter a whole number of at least ${min}.`);
          input.reportValidity();
          return;
        }
        finish(value);
      });
      actions.append(cancel, confirm);
      input.focus();
      input.select();
    });
  }

  // src/ui/company-manager.js
  function eligibilityLabel(eligibility, settings) {
    if (!eligibility || eligibility.unverified) return `<span class="r4-tcm-status-warn">UNVERIFIED</span>`;
    if (eligibility.eligible) return `<span class="r4-tcm-status-ok">Eligible</span>`;
    const reasons = [];
    if (eligibility.inactive) reasons.push("Inactive");
    if (eligibility.addictionViolation) reasons.push(`Addiction ${escapeHtml(eligibility.reasons.find((r) => r.code === "addiction")?.actual ?? "?")} &gt; ${escapeHtml(settings?.maxAddiction ?? "?")}`);
    return `<span class="r4-tcm-status-bad">${reasons.join(" + ") || "Ineligible"}</span>`;
  }
  function reasonDetails(eligibility) {
    if (!eligibility?.reasons?.length) return "";
    return eligibility.reasons.map((reason) => {
      if (reason.code === "inactive") return `<span class="r4-tcm-reason">Inactive: ${escapeHtml(formatDuration(reason.actual))} &gt; 24h</span>`;
      if (reason.code === "addiction") return `<span class="r4-tcm-reason">Addiction ${escapeHtml(reason.actual)} &gt; ${escapeHtml(reason.limit)}</span>`;
      if (reason.code === "unverified_activity") return `<span class="r4-tcm-reason">Activity could not be verified</span>`;
      if (reason.code === "unverified_addiction") return `<span class="r4-tcm-reason">Addiction could not be verified</span>`;
      return `<span class="r4-tcm-reason">${escapeHtml(reason.code)}</span>`;
    }).join("");
  }
  function activeDock(payroll, id) {
    const record = payroll?.recordsByEmployeeId?.[id] ?? payroll?.recordsByEmployeeId?.[String(id)];
    return record && record.dockVerifiedAt && record.restoredAt == null ? record : null;
  }
  function employeeActions(employee, state, eligibility) {
    const disabledWrite = state.stale || state.status === "refreshing" || state.action?.status === "pending";
    const dock = activeDock(state.payroll, employee.id);
    if (dock && eligibility?.eligible) return `<button class="r4-tcm-btn r4-tcm-btn-primary" data-action="restore" data-id="${employee.id}" ${disabledWrite ? "disabled" : ""}>Restore Pay</button>`;
    if (!eligibility?.eligible && !eligibility?.unverified) return `<button class="r4-tcm-btn r4-tcm-btn-warn" data-action="dock" data-id="${employee.id}" ${disabledWrite ? "disabled" : ""}>Dock Pay</button>`;
    if (eligibility?.eligible) return `<button class="r4-tcm-btn" data-action="train" data-id="${employee.id}" ${disabledWrite || Number(state.trains) <= 0 ? "disabled" : ""}>Train</button>`;
    return `<span class="r4-tcm-muted">No action</span>`;
  }
  function companyManagerHtml(state) {
    const nextId = state.rotation?.nextEmployeeId ?? null;
    const nextEmployee2 = (state.employees || []).find((e) => Number(e.id) === Number(nextId));
    const eligibleCount = state.rotation?.orderedEligible?.length ?? 0;
    const trainDisabled = state.stale || Number(state.trains) <= 0 || !nextEmployee2 || state.action?.status === "pending";
    const staleBanner = state.stale ? `<div class="r4-tcm-stale">Refresh required. Cached data may be shown; all write actions are disabled.</div>` : "";
    const error = state.error ? `<div class="r4-tcm-error">${escapeHtml(state.error)}</div>` : "";
    const rows = (state.employees || []).map((employee) => {
      const eligibility = byId(state.eligibilityById, employee.id);
      const history = byId(state.trainingById, employee.id) || { totalTrains: 0, lastTrainTimestamp: null };
      const isNext = Number(employee.id) === Number(nextId);
      const dock = activeDock(state.payroll, employee.id);
      let status = eligibilityLabel(eligibility, state.settings) + reasonDetails(eligibility);
      if (dock && eligibility?.eligible) status += `<span class="r4-tcm-reason r4-tcm-status-ok">Eligible Again \xB7 Pay docked</span>`;
      else if (dock) status += `<span class="r4-tcm-reason r4-tcm-status-warn">Pay docked</span>`;
      if (history.totalTrains === 0) status += `<span class="r4-tcm-reason">Never Trained</span>`;
      if (isNext) status += `<span class="r4-tcm-reason r4-tcm-next">NEXT TRAIN</span>`;
      const rowClasses = [isNext ? "r4-tcm-row-next" : "", eligibility?.eligible ? "" : "r4-tcm-row-ineligible"].filter(Boolean).join(" ");
      return `<tr class="${rowClasses}" data-eligible="${eligibility?.eligible ? "true" : "false"}">
      <td><strong>${escapeHtml(employee.name)}</strong><br><span class="r4-tcm-muted">[${escapeHtml(employee.id)}]</span></td>
      <td>${status}</td>
      <td>${escapeHtml(employee.addictionMagnitude ?? "?")} <span class="r4-tcm-muted">(${escapeHtml(employee.rawAddictionEffectiveness ?? "?")})</span></td>
      <td>${escapeHtml(employee.lastActionRelative || formatDuration(eligibility?.inactivitySeconds))}</td>
      <td>${history.totalTrains === 0 ? "Never" : escapeHtml(formatDateTime(history.lastTrainTimestamp))}</td>
      <td>${escapeHtml(formatMoney(employee.wage))}</td>
      <td>${employeeActions(employee, state, eligibility)}</td>
    </tr>`;
    }).join("");
    return `<section class="r4-tcm-manager" data-tcm-state="${escapeHtml(state.status)}">
    <div class="r4-tcm-header" data-manager-drag-handle>
      <h3 class="r4-tcm-title">Company Training Manager</h3>
      <div class="r4-tcm-header-right">
        <span class="r4-tcm-muted">Updated: ${escapeHtml(formatDateTime(state.lastUpdatedAt))}</span>
        <div class="r4-tcm-window-controls">
          <button type="button" class="r4-tcm-window-btn" data-window-action="minimize" aria-label="Minimize" title="Minimize">\u2212</button>
          <button type="button" class="r4-tcm-window-btn" data-window-action="maximize" aria-label="Maximize" title="Maximize">\u25A1</button>
          <button type="button" class="r4-tcm-window-btn" data-action="settings" aria-label="Settings" title="Settings">\u2699</button>
        </div>
      </div>
    </div>
    <div class="r4-tcm-manager-body">
      ${staleBanner}${error}
      <div class="r4-tcm-summary">
        <div class="r4-tcm-summary-card">Available trains: <strong>${escapeHtml(state.trains ?? "?")}</strong></div>
        <div class="r4-tcm-summary-card">Eligible: <strong>${eligibleCount} / ${(state.employees || []).length}</strong></div>
        <div class="r4-tcm-summary-card r4-tcm-next">Next train: <strong>${escapeHtml(nextEmployee2?.name || "None")}</strong></div>
      </div>
      <div class="r4-tcm-actions">
        <button class="r4-tcm-btn r4-tcm-btn-primary" data-action="train-next" ${trainDisabled ? "disabled" : ""}>Train Next Eligible${nextEmployee2 ? ` \xB7 ${escapeHtml(nextEmployee2.name)}` : ""}</button>
        <button class="r4-tcm-btn" data-action="refresh">Refresh Data</button>
      </div>
      <div class="r4-tcm-table-wrap"><table class="r4-tcm-table"><thead><tr><th>Employee</th><th>Eligibility</th><th>Addiction</th><th>Activity</th><th>Last Train</th><th>Pay</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No employees loaded.</td></tr>`}</tbody></table></div>
    </div>
  </section>`;
  }
  async function runSafely(fn, actions) {
    try {
      await fn();
    } catch (error) {
      actions?.onError?.(error);
    }
  }
  function renderCompanyManager(root, state, actions = {}) {
    if (!root) return;
    root.innerHTML = companyManagerHtml(state);
    if (!root.querySelectorAll) return;
    for (const button2 of root.querySelectorAll("[data-action]")) {
      button2.addEventListener?.("click", async () => {
        const action = button2.dataset.action;
        const id = Number(button2.dataset.id);
        if (action === "refresh") return runSafely(() => actions.refresh?.(), actions);
        if (action === "settings") return actions.openSettings?.();
        if (action === "train-next") {
          const nextId = state.rotation?.nextEmployeeId;
          const employee2 = (state.employees || []).find((e) => Number(e.id) === Number(nextId));
          if (!employee2) return;
          const ok = await showConfirmModal({ title: `Train ${employee2.name}?`, message: `This will spend one company train on <strong>${escapeHtml(employee2.name)}</strong>.`, confirmText: "Confirm Train" });
          if (ok) return runSafely(() => actions.trainEmployee?.(employee2.id), actions);
        }
        const employee = (state.employees || []).find((e) => Number(e.id) === id);
        if (!employee) return;
        if (action === "train") {
          const eligibility = byId(state.eligibilityById, employee.id);
          if (!eligibility?.eligible) return actions?.onError?.(new Error("Employee is not eligible for training"));
          const ok = await showConfirmModal({ title: `Train ${employee.name}?`, message: `Current pay: ${escapeHtml(formatMoney(employee.wage))}. The employee is currently eligible.`, confirmText: "Confirm Train" });
          if (ok) return runSafely(() => actions.trainEmployee?.(id), actions);
        }
        if (action === "dock") {
          const amount = await showNumberPrompt({ title: `Dock pay for ${employee.name}`, message: `Current pay: <strong>${escapeHtml(formatMoney(employee.wage))}</strong><br>Enter the temporary daily pay.`, initialValue: employee.wage, min: 0 });
          if (amount === null) return;
          const ok = await showConfirmModal({ title: "Confirm pay dock", message: `Change ${escapeHtml(employee.name)} from ${escapeHtml(formatMoney(employee.wage))} to <strong>${escapeHtml(formatMoney(amount))}</strong>?`, confirmText: "Apply Dock", danger: true });
          if (ok) return runSafely(() => actions.dockPay?.(id, amount), actions);
        }
        if (action === "restore") {
          const restoreState = actions.getRestoreStateFor?.(id) || { available: true, warning: null };
          if (!restoreState.available) return;
          const warning = restoreState.warning === "current_wage_changed" ? `<br><strong>Warning:</strong> Torn's current wage differs from the wage this script set.` : "";
          const ok = await showConfirmModal({ title: `Restore ${employee.name}'s pay?`, message: `Restore to <strong>${escapeHtml(formatMoney(restoreState.restoreWage))}</strong>?${warning}`, confirmText: "Restore Pay" });
          if (ok) return runSafely(() => actions.restorePay?.(id, { confirmMismatch: restoreState.warning === "current_wage_changed" }), actions);
        }
      });
    }
  }
  var MANAGER_DEFAULTS = Object.freeze({ x: 16, y: 80, width: 760, height: 560 });
  var MANAGER_MIN_WIDTH = 520;
  var MANAGER_MIN_HEIGHT = 280;
  var MANAGER_MINIMIZED_HEIGHT = 64;
  var MANAGER_VIEWPORT_MARGIN = 8;
  function finiteOr(value, fallback) {
    if (value === null || value === void 0 || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function normalizedGeometry(value = {}, windowRef = globalThis.window) {
    const viewportWidth = Math.max(320, finiteOr(windowRef?.innerWidth, 1280));
    const viewportHeight = Math.max(220, finiteOr(windowRef?.innerHeight, 800));
    const maxWidth = Math.max(320, viewportWidth - MANAGER_VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(220, viewportHeight - MANAGER_VIEWPORT_MARGIN * 2);
    const minWidth = Math.min(MANAGER_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(MANAGER_MIN_HEIGHT, maxHeight);
    const width = clamp(finiteOr(value.width, MANAGER_DEFAULTS.width), minWidth, maxWidth);
    const height = clamp(finiteOr(value.height, MANAGER_DEFAULTS.height), minHeight, maxHeight);
    const x = clamp(finiteOr(value.x, MANAGER_DEFAULTS.x), MANAGER_VIEWPORT_MARGIN, Math.max(MANAGER_VIEWPORT_MARGIN, viewportWidth - width - MANAGER_VIEWPORT_MARGIN));
    const y = clamp(finiteOr(value.y, MANAGER_DEFAULTS.y), MANAGER_VIEWPORT_MARGIN, Math.max(MANAGER_VIEWPORT_MARGIN, viewportHeight - height - MANAGER_VIEWPORT_MARGIN));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }
  async function attachManagerWindow({ root, uiStorage, windowRef = globalThis.window, ResizeObserverImpl = globalThis.ResizeObserver } = {}) {
    if (!root) return { destroy() {
    }, toggleMinimize: async () => {
    }, toggleMaximize: async () => {
    }, sync() {
    } };
    const loaded = await uiStorage?.loadManagerUi?.() || {};
    let geometry = normalizedGeometry(loaded, windowRef);
    let minimized = Boolean(loaded.minimized);
    let maximized = Boolean(loaded.maximized);
    if (maximized) minimized = false;
    let dragging = null;
    let destroyed = false;
    const stateForStorage = () => ({ ...geometry, minimized, maximized });
    const syncControls = () => {
      const minButton = root.querySelector?.('[data-window-action="minimize"]');
      const maxButton = root.querySelector?.('[data-window-action="maximize"]');
      if (minButton) {
        minButton.textContent = minimized ? "\u25A3" : "\u2212";
        minButton.title = minimized ? "Restore" : "Minimize";
        minButton.setAttribute?.("aria-label", minimized ? "Restore" : "Minimize");
      }
      if (maxButton) {
        maxButton.textContent = maximized ? "\u2199" : "\u25A1";
        maxButton.title = maximized ? "Restore" : "Maximize";
        maxButton.setAttribute?.("aria-label", maximized ? "Restore" : "Maximize");
      }
    };
    const apply = () => {
      const viewportWidth = Math.max(320, finiteOr(windowRef?.innerWidth, 1280));
      const viewportHeight = Math.max(220, finiteOr(windowRef?.innerHeight, 800));
      root.classList?.add?.("r4-tcm-floating-shell");
      root.classList?.toggle?.("r4-tcm-minimized", minimized);
      root.classList?.toggle?.("r4-tcm-maximized", maximized);
      root.style.position = "fixed";
      root.style.right = "auto";
      root.style.bottom = "auto";
      if (maximized) {
        root.style.left = `${MANAGER_VIEWPORT_MARGIN}px`;
        root.style.top = `${MANAGER_VIEWPORT_MARGIN}px`;
        root.style.width = `${Math.max(320, viewportWidth - MANAGER_VIEWPORT_MARGIN * 2)}px`;
        root.style.height = `${Math.max(220, viewportHeight - MANAGER_VIEWPORT_MARGIN * 2)}px`;
        root.style.resize = "none";
      } else if (minimized) {
        root.style.left = `${geometry.x}px`;
        root.style.top = `${geometry.y}px`;
        root.style.width = `${geometry.width}px`;
        root.style.height = `${MANAGER_MINIMIZED_HEIGHT}px`;
        root.style.resize = "none";
      } else {
        root.style.left = `${geometry.x}px`;
        root.style.top = `${geometry.y}px`;
        root.style.width = `${geometry.width}px`;
        root.style.height = `${geometry.height}px`;
        root.style.resize = "both";
      }
      syncControls();
    };
    const persist = async () => {
      if (!destroyed) await uiStorage?.saveManagerUi?.(stateForStorage());
    };
    const fromRect = () => {
      const rect = root.getBoundingClientRect?.();
      if (!rect) return geometry;
      return normalizedGeometry({ x: finiteOr(root.style.left?.replace?.("px", ""), rect.left), y: finiteOr(root.style.top?.replace?.("px", ""), rect.top), width: rect.width, height: rect.height }, windowRef);
    };
    const toggleMinimize = async () => {
      minimized = !minimized;
      if (minimized) maximized = false;
      apply();
      await persist();
    };
    const toggleMaximize = async () => {
      maximized = !maximized;
      if (maximized) minimized = false;
      apply();
      await persist();
    };
    const onClick = (event) => {
      const control = event?.target?.closest?.("[data-window-action]");
      if (!control) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      if (control.dataset?.windowAction === "minimize") void toggleMinimize();
      if (control.dataset?.windowAction === "maximize") void toggleMaximize();
    };
    const onPointerDown = (event) => {
      if (maximized) return;
      if (!event?.target?.closest?.(".r4-tcm-header")) return;
      if (event.target.closest?.("button,a,input,select,textarea")) return;
      const rect = root.getBoundingClientRect?.();
      if (!rect) return;
      dragging = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      root.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      geometry = normalizedGeometry({ x: event.clientX - dragging.dx, y: event.clientY - dragging.dy, width: geometry.width, height: geometry.height }, windowRef);
      apply();
    };
    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = null;
      root.releasePointerCapture?.(event?.pointerId);
      void persist();
    };
    const onViewportResize = () => {
      geometry = normalizedGeometry(geometry, windowRef);
      apply();
      void persist();
    };
    apply();
    root.addEventListener?.("click", onClick);
    root.addEventListener?.("pointerdown", onPointerDown);
    root.addEventListener?.("pointermove", onPointerMove);
    root.addEventListener?.("pointerup", onPointerUp);
    root.addEventListener?.("pointercancel", onPointerUp);
    windowRef?.addEventListener?.("resize", onViewportResize);
    const resizeObserver = ResizeObserverImpl ? new ResizeObserverImpl(() => {
      if (dragging || destroyed || minimized || maximized) return;
      const next = fromRect();
      if (next.x === geometry.x && next.y === geometry.y && next.width === geometry.width && next.height === geometry.height) return;
      geometry = next;
      apply();
      void persist();
    }) : null;
    resizeObserver?.observe?.(root);
    return {
      toggleMinimize,
      toggleMaximize,
      sync: apply,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        resizeObserver?.disconnect?.();
        root.removeEventListener?.("click", onClick);
        root.removeEventListener?.("pointerdown", onPointerDown);
        root.removeEventListener?.("pointermove", onPointerMove);
        root.removeEventListener?.("pointerup", onPointerUp);
        root.removeEventListener?.("pointercancel", onPointerUp);
        windowRef?.removeEventListener?.("resize", onViewportResize);
      }
    };
  }

  // src/ui/global-badge.js
  function nextEmployee(state) {
    const id = state?.rotation?.nextEmployeeId;
    return (state?.employees || []).find((employee) => Number(employee.id) === Number(id)) || null;
  }
  function globalBadgeHtml(state, { managerUrl = "https://www.torn.com/companies.php?step=your#employees" } = {}) {
    const next = nextEmployee(state);
    const eligible = state?.rotation?.orderedEligible?.length ?? 0;
    const skipped = state?.rotation?.skipped?.length ?? 0;
    const count = Number(state?.trains);
    const trainWord = count === 1 ? "train" : "trains";
    const missingKey = /API key required/i.test(String(state?.error || ""));
    const freshness = state?.stale ? `<span class="r4-tcm-status-warn">${missingKey ? "API key required" : "Refresh required"}</span>` : `Updated ${escapeHtml(formatDateTime(state?.lastUpdatedAt))}`;
    const trainCount = state?.settings?.showTrainCount === false ? "" : `<div>${Number.isFinite(count) ? count : "?"} ${trainWord} available</div>`;
    const settingsLabel = missingKey ? "Set API Key" : "Settings";
    return `<div class="r4-tcm-badge-head"><span>\u{1F393} Company Training</span><button type="button" class="r4-tcm-btn" data-badge-action="toggle" aria-label="Collapse">\u2212</button></div>
    <div class="r4-tcm-badge-body">
      <div>Next: <strong>${escapeHtml(next?.name || "None")}</strong></div>
      ${trainCount}
      <div>${eligible} eligible \xB7 ${skipped} skipped</div>
      <div class="r4-tcm-muted">${freshness}</div>
      <div class="r4-tcm-actions">
        <button type="button" class="r4-tcm-btn ${missingKey ? "r4-tcm-btn-primary" : ""}" data-badge-action="settings">${settingsLabel}</button>
        <a class="r4-tcm-btn" href="${escapeHtml(managerUrl)}">Company Manager</a>
      </div>
    </div>`;
  }
  function clamp2(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  async function mountGlobalBadge({ state, controller, uiStorage, documentRef = globalThis.document, windowRef = globalThis.window, managerUrl, onOpenSettings } = {}) {
    if (!documentRef?.body || state?.settings?.showGlobalBadge === false) return { update() {
    }, destroy() {
    } };
    let root = documentRef.getElementById?.("r4-tcm-global-badge");
    if (!root) {
      root = documentRef.createElement("div");
      root.id = "r4-tcm-global-badge";
      root.className = "r4-tcm-badge";
      documentRef.body.appendChild(root);
    }
    let ui = await uiStorage?.loadUi?.() || { x: null, y: null, collapsed: false };
    let currentState = state;
    const applyPosition = () => {
      if (!Number.isFinite(ui.x) || !Number.isFinite(ui.y)) return;
      const width = root.offsetWidth || 250;
      const height = root.offsetHeight || 80;
      const maxX = Math.max(0, (windowRef?.innerWidth || 1024) - width);
      const maxY = Math.max(0, (windowRef?.innerHeight || 768) - height);
      ui.x = clamp2(ui.x, 0, maxX);
      ui.y = clamp2(ui.y, 0, maxY);
      root.style.left = `${ui.x}px`;
      root.style.top = `${ui.y}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    };
    const render = () => {
      root.innerHTML = globalBadgeHtml(currentState, { managerUrl });
      root.classList.toggle("r4-tcm-collapsed", Boolean(ui.collapsed));
      const toggle = root.querySelector('[data-badge-action="toggle"]');
      if (toggle) {
        toggle.textContent = ui.collapsed ? "+" : "\u2212";
        toggle.addEventListener("click", async () => {
          ui.collapsed = !ui.collapsed;
          render();
          await uiStorage?.saveUi?.(ui);
        });
      }
      const settingsButton = root.querySelector('[data-badge-action="settings"]');
      if (settingsButton) settingsButton.addEventListener("click", () => onOpenSettings?.());
      const head = root.querySelector(".r4-tcm-badge-head");
      if (head) {
        let dragging = null;
        head.addEventListener("pointerdown", (event) => {
          if (event.target?.closest?.("button,a")) return;
          const rect = root.getBoundingClientRect();
          dragging = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
          head.setPointerCapture?.(event.pointerId);
        });
        head.addEventListener("pointermove", (event) => {
          if (!dragging) return;
          ui.x = event.clientX - dragging.dx;
          ui.y = event.clientY - dragging.dy;
          applyPosition();
        });
        head.addEventListener("pointerup", async (event) => {
          if (!dragging) return;
          dragging = null;
          head.releasePointerCapture?.(event.pointerId);
          await uiStorage?.saveUi?.(ui);
        });
      }
      applyPosition();
    };
    render();
    const onResize = () => applyPosition();
    windowRef?.addEventListener?.("resize", onResize);
    return {
      update(nextState) {
        currentState = nextState;
        if (nextState?.settings?.showGlobalBadge === false) {
          root.remove();
          return;
        }
        render();
      },
      destroy() {
        windowRef?.removeEventListener?.("resize", onResize);
        root.remove();
      }
    };
  }

  // src/ui/settings.js
  function checked(value) {
    return value ? "checked" : "";
  }
  function settingsFormHtml(state = {}, { hasApiKey = false } = {}) {
    const settings = state.settings || {};
    return `<div class="r4-tcm-modal r4-tcm-settings">
    <h3>Training Manager Settings</h3>
    <div class="r4-tcm-settings-row"><label>Inactivity rule</label><span class="r4-tcm-muted">More than 24 hours since last action = ineligible for training.</span></div>
    <div class="r4-tcm-settings-row"><label>Maximum addiction</label><input name="maxAddiction" type="number" min="0" step="1" value="${escapeHtml(settings.maxAddiction ?? 3)}"></div>
    <div class="r4-tcm-settings-row"><label>Refresh interval (minutes)</label><input name="refreshMinutes" type="number" min="1" step="1" value="${escapeHtml(settings.refreshMinutes ?? 5)}"></div>
    <div class="r4-tcm-settings-row r4-tcm-settings-check"><input name="prioritizeNeverTrained" type="checkbox" ${checked(settings.prioritizeNeverTrained !== false)}><label>Prioritize employees who have never been trained</label></div>
    <div class="r4-tcm-settings-row r4-tcm-settings-check"><input name="showGlobalBadge" type="checkbox" ${checked(settings.showGlobalBadge !== false)}><label>Show global next-train badge</label></div>
    <div class="r4-tcm-settings-row r4-tcm-settings-check"><input name="showTrainCount" type="checkbox" ${checked(settings.showTrainCount !== false)}><label>Show available train count</label></div>
    <hr>
    <div class="r4-tcm-settings-row"><label>Torn API key</label><input name="apiKey" type="password" autocomplete="off" value="" placeholder="${hasApiKey ? "Key saved \xB7 leave blank to keep it" : "Enter director-capable API key"}"><span class="r4-tcm-muted">Stored only in userscript-manager storage and sent only to api.torn.com.</span></div>
    <div class="r4-tcm-error" data-settings-error hidden></div>
    <div class="r4-tcm-actions">
      <button type="button" class="r4-tcm-btn r4-tcm-btn-primary" data-settings-action="save">Save</button>
      <button type="button" class="r4-tcm-btn" data-settings-action="rebuild">Rebuild Training History</button>
      <button type="button" class="r4-tcm-btn r4-tcm-btn-warn" data-settings-action="clear-key">Clear API Key</button>
      <button type="button" class="r4-tcm-btn r4-tcm-btn-danger" data-settings-action="reset">Reset Local Data</button>
      <button type="button" class="r4-tcm-btn" data-settings-action="close">Close</button>
    </div>
  </div>`;
  }
  function validateSettingsValues(values = {}) {
    const maxAddiction = Number(values.maxAddiction);
    const refreshMinutes = Number(values.refreshMinutes ?? 5);
    if (!Number.isInteger(maxAddiction) || maxAddiction < 0) throw new TypeError("Addiction threshold must be a whole number of zero or greater");
    if (!Number.isFinite(refreshMinutes) || refreshMinutes <= 0) throw new TypeError("Refresh minutes must be greater than zero");
    return {
      maxAddiction,
      prioritizeNeverTrained: values.prioritizeNeverTrained !== false,
      showGlobalBadge: values.showGlobalBadge !== false,
      showTrainCount: values.showTrainCount !== false,
      refreshMinutes
    };
  }
  async function savePolicySettings(values, controller) {
    const normalized = validateSettingsValues(values);
    await controller.updateSettings(normalized);
    return normalized;
  }
  async function renderSettingsModal(state, controller, { documentRef = globalThis.document } = {}) {
    if (!documentRef?.body) return null;
    const hasApiKey = Boolean(await controller.getApiKey?.());
    const backdrop = documentRef.createElement("div");
    backdrop.className = "r4-tcm-modal-backdrop";
    backdrop.innerHTML = settingsFormHtml(state, { hasApiKey });
    documentRef.body.appendChild(backdrop);
    const modal = backdrop.querySelector(".r4-tcm-settings");
    const errorBox = backdrop.querySelector("[data-settings-error]");
    const close = () => backdrop.remove();
    const showError = (error) => {
      if (!errorBox) return;
      errorBox.hidden = false;
      errorBox.textContent = String(error?.message || error);
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
    for (const button2 of backdrop.querySelectorAll("[data-settings-action]")) {
      button2.addEventListener("click", async () => {
        const action = button2.dataset.settingsAction;
        try {
          if (action === "close") return close();
          if (action === "save") {
            const maxAddiction = modal.querySelector('[name="maxAddiction"]').value;
            const refreshMinutes = modal.querySelector('[name="refreshMinutes"]').value;
            const prioritizeNeverTrained = modal.querySelector('[name="prioritizeNeverTrained"]').checked;
            const showGlobalBadge = modal.querySelector('[name="showGlobalBadge"]').checked;
            const showTrainCount = modal.querySelector('[name="showTrainCount"]').checked;
            await savePolicySettings({ maxAddiction, refreshMinutes, prioritizeNeverTrained, showGlobalBadge, showTrainCount }, controller);
            const key = modal.querySelector('[name="apiKey"]').value.trim();
            if (key) await controller.setApiKey?.(key);
            await controller.refresh?.();
            close();
            return;
          }
          if (action === "rebuild") {
            const ok = await showConfirmModal({ title: "Rebuild training history?", message: "This will rescan Company News. Payroll records and settings are preserved.", confirmText: "Rebuild", documentRef });
            if (ok) await controller.rebuildHistory?.();
            return;
          }
          if (action === "clear-key") {
            const ok = await showConfirmModal({ title: "Clear API key?", message: "The manager will stop refreshing until a new key is provided.", confirmText: "Clear Key", danger: true, documentRef });
            if (ok) {
              await controller.clearApiKey?.();
              close();
            }
            return;
          }
          if (action === "reset") {
            const ok = await showConfirmModal({ title: "Reset local Training Manager data?", message: "Settings, history cache, payroll audit records and UI position will be cleared. Your API key is preserved.", confirmText: "Reset Local Data", danger: true, documentRef });
            if (ok) {
              await controller.resetNonKeyData?.();
              close();
            }
          }
        } catch (error) {
          showError(error);
        }
      });
    }
    return backdrop;
  }

  // src/ui/styles.js
  var TCM_STYLES = `
.r4-tcm-manager,.r4-tcm-badge,.r4-tcm-modal{box-sizing:border-box;font-family:Arial,sans-serif;color:#f4f4f4!important}
.r4-tcm-manager *,.r4-tcm-badge *,.r4-tcm-modal *{box-sizing:border-box}
.r4-tcm-manager{margin:0;padding:14px;border:1px solid #666;border-radius:8px;background:rgba(24,24,24,.98);box-shadow:0 8px 28px #000a;color:#f4f4f4!important;height:100%;display:flex;flex-direction:column;overflow:hidden}
.r4-tcm-header{display:flex;gap:12px;align-items:center;justify-content:space-between;color:#f4f4f4!important;min-height:32px}
.r4-tcm-header-right{display:flex;align-items:center;gap:10px;min-width:0}
.r4-tcm-window-controls{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.r4-tcm-window-btn{width:30px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #666;border-radius:5px;background:#303030;color:#f4f4f4!important;cursor:pointer;font-size:16px;font-weight:700;line-height:1;padding:0}
.r4-tcm-window-btn:hover{filter:brightness(1.22)}
.r4-tcm-title{font-size:16px;font-weight:700;margin:0;color:#fff!important}.r4-tcm-manager-body{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}.r4-tcm-summary{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.r4-tcm-summary-card{background:#111;padding:8px 10px;border-radius:6px;border:1px solid #444;color:#f4f4f4!important}.r4-tcm-next{color:#7cff4f!important}
.r4-tcm-stale{background:#6b3d00;color:#fff2cc!important;padding:8px;border-radius:5px;margin:8px 0}.r4-tcm-error{background:#601d1d;color:#ffd7d7!important;padding:8px;border-radius:5px;margin:8px 0}
.r4-tcm-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.r4-tcm-btn{border:1px solid #666;border-radius:5px;padding:7px 10px;background:#333;color:#f4f4f4!important;cursor:pointer;font-weight:600}
.r4-tcm-btn:hover:not(:disabled){filter:brightness(1.18)}.r4-tcm-btn:disabled{opacity:.45;cursor:not-allowed}.r4-tcm-btn-primary{background:#356b28}.r4-tcm-btn-danger{background:#7a3328}.r4-tcm-btn-warn{background:#745c18}
.r4-tcm-table-wrap{overflow:auto;flex:1;min-height:0}.r4-tcm-table{width:100%;border-collapse:collapse;font-size:12px;color:#f4f4f4!important}.r4-tcm-table th,.r4-tcm-table td{padding:7px 6px;border-bottom:1px solid #444;text-align:left;vertical-align:middle;color:#f4f4f4!important}.r4-tcm-table th{font-weight:700;background:#222;position:sticky;top:0;z-index:1}.r4-tcm-row-next{outline:1px solid #7cff4f;background:#27402166}.r4-tcm-row-ineligible{background:rgba(100,20,20,.16)}
.r4-tcm-status-ok{color:#7cff4f!important;font-weight:700}.r4-tcm-status-bad{color:#ff6b6b!important;font-weight:700}.r4-tcm-status-warn{color:#ffe45c!important;font-weight:700}.r4-tcm-muted{color:#c7c7c7!important;opacity:1}.r4-tcm-reason{display:block;font-size:11px;margin-top:2px;color:#e8e8e8!important}.r4-tcm-manager strong{color:#fff!important}
.r4-tcm-modal-backdrop{position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:10000000;padding:16px}.r4-tcm-modal{width:min(460px,100%);background:#222;border:1px solid #666;border-radius:8px;padding:16px;box-shadow:0 12px 40px #000;color:#f4f4f4!important}.r4-tcm-modal h3{margin:0 0 10px;color:#fff!important}.r4-tcm-modal input{width:100%;padding:8px;background:#111;color:#eee!important;border:1px solid #555;border-radius:4px;margin:8px 0}.r4-tcm-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.r4-tcm-badge{position:fixed;right:18px;bottom:18px;width:250px;background:#1d1d1df2;border:1px solid #555;border-radius:8px;z-index:999999;padding:10px;box-shadow:0 4px 18px #0009}.r4-tcm-badge-head{display:flex;justify-content:space-between;align-items:center;cursor:move;font-weight:700}.r4-tcm-badge-body{margin-top:8px;font-size:12px;line-height:1.5}.r4-tcm-badge.r4-tcm-collapsed .r4-tcm-badge-body{display:none}
.r4-tcm-settings-row{margin:10px 0}.r4-tcm-settings-row label{display:block;font-weight:600;margin-bottom:3px}.r4-tcm-settings-check{display:flex;gap:8px;align-items:center}.r4-tcm-settings-check input{width:auto;margin:0}
.r4-tcm-floating-shell{z-index:999999!important;resize:both;overflow:hidden;min-width:520px;min-height:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px)}
.r4-tcm-floating-shell .r4-tcm-header{cursor:move;user-select:none}
.r4-tcm-floating-shell .r4-tcm-window-btn{cursor:pointer;user-select:none}
.r4-tcm-floating-shell.r4-tcm-minimized{min-height:64px!important;max-height:64px!important}
.r4-tcm-floating-shell.r4-tcm-minimized .r4-tcm-manager-body{display:none}
.r4-tcm-floating-shell.r4-tcm-maximized{max-width:none;max-height:none}
`;
  function injectStyles(documentRef = globalThis.document) {
    if (!documentRef?.head || documentRef.getElementById?.("r4-tcm-styles")) return;
    const style = documentRef.createElement("style");
    style.id = "r4-tcm-styles";
    style.textContent = TCM_STYLES;
    documentRef.head.appendChild(style);
  }

  // src/main.js
  var MutableApiClient = class {
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
    getEmployees(...args) {
      return this.#needClient().getEmployees(...args);
    }
    getProfile(...args) {
      return this.#needClient().getProfile(...args);
    }
    getTrainingNewsSince(...args) {
      return this.#needClient().getTrainingNewsSince(...args);
    }
    rebuildTrainingNews(...args) {
      return this.#needClient().rebuildTrainingNews(...args);
    }
    validateCapabilities(...args) {
      return this.#needClient().validateCapabilities(...args);
    }
  };
  function directUserscriptGrants() {
    return {
      GM_getValue: typeof GM_getValue === "function" ? GM_getValue : null,
      GM_setValue: typeof GM_setValue === "function" ? GM_setValue : null,
      GM_deleteValue: typeof GM_deleteValue === "function" ? GM_deleteValue : null,
      GM_xmlhttpRequest: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null,
      GM_registerMenuCommand: typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : null
    };
  }
  function resolveUserscriptGrant(name, { globalRef = globalThis, directGrants = directUserscriptGrants() } = {}) {
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
  function isCompanyEmployeesPage(windowRef, documentRef) {
    let url;
    try {
      url = new URL(hrefOf(windowRef));
    } catch {
      return false;
    }
    if (!/\/companies\.php$/i.test(url.pathname)) return false;
    if (url.searchParams.get("step") !== "your") return false;
    const hash = String(url.hash || "").toLowerCase();
    const explicitEmployeeRoute = hash.includes("employee") || url.searchParams.get("tab") === "employees";
    if (explicitEmployeeRoute) return true;
    return Boolean(documentRef?.querySelector?.('a[href*="step=trainemp2"], a[href*="step=kickemp"]'));
  }
  async function defaultMountCompanyUi({ documentRef, windowRef, state, actions, uiStorage, ResizeObserverImpl }) {
    if (!documentRef?.createElement || !documentRef?.body) return { update() {
    }, destroy() {
    } };
    let root = documentRef.getElementById?.("r4-tcm-company-root");
    if (!root) {
      root = documentRef.createElement("div");
      root.id = "r4-tcm-company-root";
      documentRef.body.appendChild(root);
    }
    let windowHandle = null;
    renderCompanyManager(root, state, actions);
    windowHandle = await attachManagerWindow({ root, uiStorage, windowRef, ResizeObserverImpl });
    return {
      update(nextState) {
        renderCompanyManager(root, nextState, actions);
        windowHandle?.sync?.();
      },
      destroy() {
        windowHandle?.destroy?.();
        root.remove?.();
      }
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
  async function bootstrap(deps = {}) {
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
    const mountGlobalBadgeImpl = deps.mountGlobalBadgeImpl ?? mountGlobalBadge;
    const registerMenuCommandImpl = deps.registerMenuCommandImpl ?? resolveUserscriptGrant("GM_registerMenuCommand");
    const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1e3));
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
        try {
          windowRef?.location?.reload?.();
        } catch {
        }
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
        try {
          windowRef?.alert?.(`Training Manager: ${message}`);
        } catch {
        }
      }
    };
    try {
      registerMenuCommandImpl?.("Company Training Manager: Settings", actions.openSettings);
    } catch {
    }
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
        mounted = await mountCompanyUi({ documentRef, windowRef, state, controller, actions, uiStorage: storage, ResizeObserverImpl });
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
      intervalId = setIntervalImpl?.(() => controller.refresh?.(), minutes * 6e4) ?? null;
    };
    const unsubscribe = controller.subscribe?.((state) => {
      ensureInterval(state);
      void evaluateRoute(state);
    }) ?? (() => {
    });
    ensureInterval(controller.getState());
    await evaluateRoute(controller.getState());
    const observer = MutationObserverImpl ? new MutationObserverImpl(() => {
      if (routeTimer) clearTimeoutImpl?.(routeTimer);
      routeTimer = setTimeoutImpl?.(() => {
        routeTimer = null;
        void evaluateRoute(controller.getState());
      }, 250) ?? null;
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
})();
