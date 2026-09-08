import { SCHEMA_VERSION } from "./constants.js";

export const AUDIT_LIMIT = 500;

const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|rfcv?|cookie|session|token|secret)/i;
const SAFE_PRESENCE_KEY_RE = /(api[_-]?key|authorization|rfcv?|cookie|session|token|secret).*present$/i;
let sequence = 0;

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function shouldRedact(key, raw) {
  if (typeof raw === "boolean" && SAFE_PRESENCE_KEY_RE.test(key)) return false;
  return SENSITIVE_KEY_RE.test(key);
}

export function sanitizeAuditValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, seen));

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    out[key] = shouldRedact(key, raw) ? "[redacted]" : sanitizeAuditValue(raw, seen);
  }
  return out;
}

export function createAuditEntry(input = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = Number.isFinite(Number(nowSeconds)) ? Math.trunc(Number(nowSeconds)) : Math.floor(Date.now() / 1000);
  sequence = (sequence + 1) % 1_000_000;
  const employeeId = Number(input.employeeId);
  return {
    id: `${timestamp}-${sequence}`,
    timestamp,
    type: String(input.type || "unknown"),
    phase: String(input.phase || "unknown"),
    employeeId: Number.isInteger(employeeId) ? employeeId : null,
    employeeName: input.employeeName == null ? null : String(input.employeeName),
    details: sanitizeAuditValue(isRecord(input.details) ? input.details : {})
  };
}

export function appendAuditEntry(state, entry, limit = AUDIT_LIMIT) {
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : AUDIT_LIMIT;
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [...entries, sanitizeAuditValue(entry)].slice(-safeLimit)
  };
}

export function filterAuditEntries(entries = [], filters = {}) {
  const type = String(filters.type || "").trim().toLowerCase();
  const phase = String(filters.phase || "").trim().toLowerCase();
  const employee = String(filters.employee || "").trim().toLowerCase();

  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (type && type !== "all" && String(entry?.type || "").toLowerCase() !== type) return false;
    if (phase && phase !== "all" && String(entry?.phase || "").toLowerCase() !== phase) return false;
    if (employee) {
      const haystack = `${entry?.employeeName || ""} ${entry?.employeeId ?? ""}`.toLowerCase();
      if (!haystack.includes(employee)) return false;
    }
    return true;
  });
}
