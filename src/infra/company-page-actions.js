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

function findSubmitChangesControls(document) {
  const selectors = [
    "button",
    "input[type='submit']",
    'input[type="submit"]',
    "[role='button']"
  ];
  const seen = new Set();
  const candidates = [];
  for (const selector of selectors) {
    for (const node of toArray(document?.querySelectorAll?.(selector))) {
      if (seen.has(node)) continue;
      seen.add(node);
      if (isDisabled(node)) continue;
      const label = String(node.textContent || node.value || node.getAttribute?.("aria-label") || "").trim();
      if (/SUBMIT\s+CHANGES/i.test(label)) candidates.push(node);
    }
  }
  return candidates;
}

function findSubmitChangesControl(document) {
  const candidates = findSubmitChangesControls(document);
  return candidates.length === 1 ? candidates[0] : null;
}

function dispatchWageEvents(document, input) {
  const EventCtor = document?.defaultView?.Event || globalThis.Event;
  for (const type of ["input", "change", "blur"]) {
    const event = typeof EventCtor === "function"
      ? new EventCtor(type, { bubbles: true })
      : { type };
    input.dispatchEvent?.(event);
  }
}

function rowEmployeeId(row) {
  const raw = row?.dataset?.user
    ?? row?.getAttribute?.("data-user")
    ?? row?.dataset?.employeeId
    ?? row?.getAttribute?.("data-employee-id");
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function visibleEmployeeRows(document) {
  const selectors = [
    "ul.employee-list li[data-user]",
    "li[data-user]",
    "tr[data-user]",
    "[data-employee-id]"
  ];
  const seen = new Set();
  const rows = [];
  for (const selector of selectors) {
    for (const row of toArray(document?.querySelectorAll?.(selector))) {
      if (seen.has(row)) continue;
      seen.add(row);
      rows.push(row);
    }
  }
  return rows;
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

  #isCompanyManagementPage() {
    try {
      const url = new URL(this.document?.location?.href || "", this.#origin());
      const step = url.searchParams.get("step");
      return url.origin === "https://www.torn.com"
        && /\/companies\.php$/i.test(url.pathname)
        && (!step || step === "your");
    } catch {
      return false;
    }
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
        const enabled = candidates.filter((node) => {
          if (isDisabled(node)) return false;
          const wrapper = node.closest?.(".train-action");
          return !wrapper || !isDisabled(wrapper);
        });
        if (enabled.length > 1) return null;
        if (enabled.length === 1) return enabled[0];
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
      companyManagementPage: this.#isCompanyManagementPage(),
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
    if (!this.#isCompanyManagementPage()) return { status: "unsafe_dom", reason: "not_company_management_page" };

    const row = this.#rowForEmployee(id);
    if (!row) return { status: "unsafe_dom", reason: "employee_row_not_found" };

    const token = this.#rfcToken();
    if (!token) return { status: "unsafe_dom", reason: "rfc_token_not_found" };

    const url = new URL("/companies.php", this.#origin());
    url.searchParams.set("rfcv", token);
    if (!isSameOrigin(url.href, "https://www.torn.com")) return { status: "unsafe_dom", reason: "cross_origin_train_endpoint" };

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

  inspectPayrollEnvironment(apiWagesById, employeeId = null) {
    const id = Number(employeeId);
    const targetId = Number.isInteger(id) ? id : null;
    const row = targetId == null ? null : this.#rowForEmployee(targetId);
    const wageInputs = row
      ? toArray(row.querySelectorAll?.(".pay input")).filter((input) => !isDisabled(input))
      : [];
    const dirtyEmployeeIds = [];
    let apiWageCoverageOk = true;
    let targetDirty = false;

    for (const visibleRow of visibleEmployeeRows(this.document)) {
      const visibleId = rowEmployeeId(visibleRow);
      if (!Number.isInteger(visibleId)) continue;
      const inputs = toArray(visibleRow.querySelectorAll?.(".pay input")).filter((input) => !isDisabled(input));
      if (inputs.length === 0) continue;
      if (inputs.length !== 1) {
        apiWageCoverageOk = false;
        continue;
      }
      const apiWage = Number(mapGet(apiWagesById, visibleId));
      const currentWage = controlValue(inputs[0]);
      if (!Number.isInteger(apiWage) || apiWage < 0 || currentWage === null) {
        apiWageCoverageOk = false;
        continue;
      }
      if (currentWage !== apiWage) {
        dirtyEmployeeIds.push(visibleId);
        if (visibleId === targetId) targetDirty = true;
      }
    }

    return {
      employeeId: targetId,
      employeeRowFound: Boolean(row),
      wageInputCount: wageInputs.length,
      submitControlCount: findSubmitChangesControls(this.document).length,
      targetDirty,
      dirtyEmployeeIds,
      apiWageCoverageOk
    };
  }

  async submitWageChange({ employeeId, targetWage, apiWagesById }) {
    const id = Number(employeeId);
    if (!Number.isInteger(id)) return { status: "unsafe_dom", reason: "invalid_employee_id" };
    if (!Number.isInteger(targetWage) || targetWage < 0) return { status: "unsafe_dom", reason: "invalid_target_wage" };
    if (!this.#isCompanyManagementPage()) return { status: "unsafe_dom", reason: "not_company_management_page" };

    const row = this.#rowForEmployee(id);
    if (!row) return { status: "unsafe_dom", reason: "employee_row_not_found", employeeId: id };
    const wageInputs = toArray(row.querySelectorAll?.(".pay input")).filter((input) => !isDisabled(input));
    if (wageInputs.length !== 1) return { status: "unsafe_dom", reason: "wage_input_not_unique", employeeId: id };

    const targetApiWage = Number(mapGet(apiWagesById, id));
    if (!Number.isInteger(targetApiWage) || targetApiWage < 0) return { status: "unsafe_dom", reason: "api_wage_unverified", employeeId: id };
    const targetCurrentWage = controlValue(wageInputs[0]);
    if (targetCurrentWage === null) return { status: "unsafe_dom", reason: "wage_value_unreadable", employeeId: id };
    if (targetCurrentWage !== targetApiWage) return { status: "unsafe_dom", reason: "target_dirty_wage", employeeId: id };

    for (const visibleRow of visibleEmployeeRows(this.document)) {
      const visibleId = rowEmployeeId(visibleRow);
      if (!Number.isInteger(visibleId) || visibleId === id) continue;
      const inputs = toArray(visibleRow.querySelectorAll?.(".pay input")).filter((input) => !isDisabled(input));
      if (inputs.length === 0) continue;
      if (inputs.length !== 1) return { status: "unsafe_dom", reason: "wage_input_not_unique", employeeId: visibleId };
      const apiWage = Number(mapGet(apiWagesById, visibleId));
      if (!Number.isInteger(apiWage) || apiWage < 0) return { status: "unsafe_dom", reason: "api_wage_unverified", employeeId: visibleId };
      const currentWage = controlValue(inputs[0]);
      if (currentWage === null) return { status: "unsafe_dom", reason: "wage_value_unreadable", employeeId: visibleId };
      if (currentWage !== apiWage) return { status: "unsafe_dom", reason: "unrelated_dirty_wage", employeeId: visibleId };
    }

    const submitControl = findSubmitChangesControl(this.document);
    if (!submitControl) return { status: "unsafe_dom", reason: "submit_changes_not_unique" };

    const input = wageInputs[0];
    input.value = String(targetWage);
    dispatchWageEvents(this.document, input);
    submitControl.click?.();
    return { status: "submitted" };
  }
}
