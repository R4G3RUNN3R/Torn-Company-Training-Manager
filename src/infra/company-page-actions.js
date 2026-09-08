function parseMoney(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[$,\s]/g, "");
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

function mapGet(mapLike, id) {
  if (mapLike instanceof Map) return mapLike.get(Number(id));
  return mapLike?.[id] ?? mapLike?.[String(id)];
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

function isDisabled(node) {
  if (!node) return true;
  const className = String(node.className || "");
  return Boolean(node.disabled)
    || node.getAttribute?.("aria-disabled") === "true"
    || /\bdisabled\b/i.test(className);
}

function findForm(document) {
  const forms = toArray(document?.querySelectorAll?.("form"));
  const candidates = forms.filter((form) => {
    try {
      const buttons = toArray(form.querySelectorAll?.("button, input[type='submit']"));
      if (buttons.length === 0 && form.controls) return true;
      return buttons.some((button) => /SUBMIT\s+CHANGES/i.test(button.textContent || button.value || ""));
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
    "li[data-user]",
    "tr[data-user]",
    "[data-employee-id]",
    "tr",
    "li",
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
      // Try next selector.
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

function validRfcToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{4,}$/.test(value.trim());
}

function tokenFromUrl(value, origin) {
  try {
    const url = new URL(value, origin);
    const token = url.searchParams.get("rfcv") || url.searchParams.get("rfc_v");
    return validRfcToken(token) ? token.trim() : null;
  } catch {
    return null;
  }
}

function tokenFromCookie(cookie) {
  const text = String(cookie || "");
  for (const name of ["rfc_v", "rfcv"]) {
    const match = text.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (!match) continue;
    const value = decodeURIComponent(match[1]);
    if (validRfcToken(value)) return value.trim();
  }
  return null;
}

function sanitizedReason(value, token = "") {
  let text = String(value || "Torn rejected the training request").trim();
  if (token) text = text.split(token).join("[redacted]");
  return text.slice(0, 300);
}

export class CompanyPageActions {
  constructor({ document, fetchImpl = globalThis.fetch?.bind(globalThis), formDataFactory = (form) => new FormData(form) } = {}) {
    if (!document) throw new TypeError("document is required");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
    this.document = document;
    this.fetchImpl = fetchImpl;
    this.formDataFactory = formDataFactory;
  }

  #origin() {
    return this.document?.location?.origin || globalThis.location?.origin || "https://www.torn.com";
  }

  #legacyTrainLinksFor(employeeId) {
    const links = toArray(this.document.querySelectorAll?.('a[href*="step=trainemp2"]'));
    return links.filter((link) => exactEmployeeIdFromHref(link.href || link.getAttribute?.("href"), "trainemp2") === Number(employeeId));
  }

  #rowForEmployee(employeeId) {
    const id = Number(employeeId);
    if (!Number.isInteger(id)) return null;
    const selectors = [
      `ul.employee-list li[data-user="${id}"]`,
      `li[data-user="${id}"]`,
      `tr[data-user="${id}"]`,
      `[data-employee-id="${id}"]`
    ];
    for (const selector of selectors) {
      try {
        const row = this.document.querySelector?.(selector);
        if (row) return row;
      } catch {
        // Try the next exact-ID selector.
      }
    }
    const links = this.#legacyTrainLinksFor(id);
    return links.length === 1 ? closestEmployeeRow(links[0]) : null;
  }

  #trainActionFor(employeeId) {
    const id = Number(employeeId);
    const row = this.#rowForEmployee(id);
    if (row?.querySelectorAll) {
      const selectors = [
        ".train .train-action.btn-wrap button.torn-btn",
        ".train button.torn-btn",
        ".train .train-action.btn-wrap",
        ".train a.train-action[href*='trainemp2']",
        "a.train-action[href*='trainemp2']",
        "a[href*='step=trainemp2']"
      ];
      for (const selector of selectors) {
        const candidates = toArray(row.querySelectorAll(selector));
        const enabled = candidates.find((node) => {
          if (isDisabled(node)) return false;
          const wrapper = node.closest?.(".train-action");
          return !wrapper || !isDisabled(wrapper);
        });
        if (enabled) return enabled;
      }
    }

    const legacy = this.#legacyTrainLinksFor(id).filter((node) => !isDisabled(node));
    return legacy.length === 1 ? legacy[0] : null;
  }

  #rfcToken() {
    const selectors = [
      'input[name="rfcv"]',
      'input[name="rfc_v"]',
      '#rfcv',
      '#rfc_v'
    ];
    for (const selector of selectors) {
      try {
        const value = this.document.querySelector?.(selector)?.value;
        if (validRfcToken(value)) return String(value).trim();
      } catch {
        // Keep looking.
      }
    }

    const origin = this.#origin();
    const locationToken = tokenFromUrl(this.document?.location?.href, origin);
    if (locationToken) return locationToken;

    try {
      const links = toArray(this.document.querySelectorAll?.('a[href*="rfcv="], a[href*="rfc_v="]'));
      for (const link of links) {
        const token = tokenFromUrl(link.href || link.getAttribute?.("href"), origin);
        if (token) return token;
      }
    } catch {
      // Ignore DOM variations.
    }

    try {
      const forms = toArray(this.document.querySelectorAll?.("form"));
      for (const form of forms) {
        const token = tokenFromUrl(form.action, origin);
        if (token) return token;
      }
    } catch {
      // Ignore DOM variations.
    }

    return tokenFromCookie(this.document?.cookie);
  }

  findTrainHref(employeeId) {
    const action = this.#trainActionFor(employeeId);
    const href = action?.href || action?.getAttribute?.("href");
    if (!href || !isSameOrigin(href, this.#origin())) return null;
    return new URL(href, this.#origin()).href;
  }

  inspectTrainingEnvironment(employeeId = null) {
    const id = Number(employeeId);
    const row = Number.isInteger(id) ? this.#rowForEmployee(id) : null;
    const action = Number.isInteger(id) ? this.#trainActionFor(id) : null;
    const href = action?.href || action?.getAttribute?.("href") || null;
    return {
      employeeId: Number.isInteger(id) ? id : null,
      employeeRowFound: Boolean(row),
      exactTrainControlFound: Boolean(action),
      legacyTrainHrefPresent: Boolean(href),
      targetOriginSafe: href ? isSameOrigin(href, this.#origin()) : true,
      rfcTokenPresent: Boolean(this.#rfcToken())
    };
  }

  async submitTrain(employeeId) {
    const id = Number(employeeId);
    if (!Number.isInteger(id)) return { status: "unsafe_dom", reason: "invalid_employee_id" };
    const action = this.#trainActionFor(id);
    if (!action) return { status: "unsafe_dom", reason: "train_control_not_found" };

    const href = action.href || action.getAttribute?.("href") || null;
    if (href && !isSameOrigin(href, this.#origin())) return { status: "unsafe_dom", reason: "cross_origin_train_link" };

    const token = this.#rfcToken();
    if (!token) return { status: "unsafe_dom", reason: "rfc_token_not_found" };

    const url = new URL("/companies.php", this.#origin());
    url.searchParams.set("rfcv", token);
    if (!isSameOrigin(url.href, this.#origin())) return { status: "unsafe_dom", reason: "cross_origin_train_endpoint" };

    const body = new URLSearchParams();
    body.set("step", "trainemp2");
    body.set("ID", String(id));

    try {
      const response = await this.fetchImpl(url.href, {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      if (!response?.ok) return { status: "http_failed", reason: `http_${Number(response?.status) || 0}`, httpStatus: Number(response?.status) || null };

      let payload;
      try {
        const text = typeof response.text === "function" ? await response.text() : "";
        payload = JSON.parse(text);
      } catch {
        return { status: "http_failed", reason: "invalid_response", httpStatus: Number(response?.status) || null };
      }

      if (payload?.success === true) return { status: "accepted", httpStatus: Number(response?.status) || 200 };
      if (payload?.success === false || payload?.error) {
        return {
          status: "rejected",
          reason: sanitizedReason(payload?.error ?? payload?.message ?? payload?.reason, token),
          httpStatus: Number(response?.status) || 200
        };
      }
      return { status: "http_failed", reason: "unrecognized_response", httpStatus: Number(response?.status) || 200 };
    } catch (error) {
      return { status: "http_failed", reason: "network_error", error: String(error?.message || error).slice(0, 300) };
    }
  }

  inspectPayrollForm(apiWagesById) {
    const form = findForm(this.document);
    if (!form) return { safe: false, reason: "payroll_form_not_unique", targets: new Map() };
    const targets = new Map();
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
}
