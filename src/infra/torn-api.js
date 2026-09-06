import { normalizeEmployee } from "../core/normalize.js";

const API_ORIGIN = "https://api.torn.com";
const API_BASE = `${API_ORIGIN}/v2/company`;
const COMMENT = "R4G3RUNN3R Training Manager";
const COMMENT_Q = encodeURIComponent(COMMENT);

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
  return Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
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

export class TornApiError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = "TornApiError";
    this.code = code;
    this.status = status;
  }
}

export function validateDirectorCapabilities({ employeesResponse, profileResponse }) {
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

export function createGmTransport(gmXmlhttpRequest) {
  if (typeof gmXmlhttpRequest !== "function") throw new TypeError("GM_xmlhttpRequest is required");
  return {
    requestJson({ method = "GET", url, headers = {} }) {
      return new Promise((resolve, reject) => {
        gmXmlhttpRequest({
          method,
          url,
          headers,
          timeout: 30000,
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
          onerror() { reject(new TornApiError("Torn API network error")); },
          ontimeout() { reject(new TornApiError("Torn API request timed out")); },
          onabort() { reject(new TornApiError("Torn API request aborted")); }
        });
      });
    }
  };
}

export class TornApiClient {
  constructor({ transport, apiKey, nowSeconds = () => Math.floor(Date.now() / 1000) }) {
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
      if (from !== null && from !== undefined && Number.isFinite(Number(from))) params.set("from", String(Math.trunc(Number(from))));
      requestUrl = `${API_BASE}/news?${params.toString()}`;
    }
    if (!safeApiUrl(requestUrl)) throw new TornApiError("Unsafe Torn API pagination URL");
    const response = await this.#request(requestUrl);
    return { news: asNewsArray(response), next: metadataNext(response), raw: response };
  }

  async #collectNews({ from = null, onProgress = null } = {}) {
    const news = [];
    const seenUrls = new Set();
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
}
