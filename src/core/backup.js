const BACKUP_SCHEMA = 1;
const DOMAIN_METHODS = Object.freeze({
  settings: ["loadSettings", "saveSettings"],
  history: ["loadHistory", "saveHistory"],
  payroll: ["loadPayroll", "savePayroll"],
  managerUi: ["loadManagerUi", "saveManagerUi"],
  paidContracts: ["loadPaidContracts", "savePaidContracts"],
  fairness: ["loadFairness", "saveFairness"],
  overrides: ["loadOverrides", "saveOverrides"],
  audit: ["loadAudit", "saveAudit"]
});

const SECRET_KEY = /(api.?key|authorization|rfc|cookie|session|token|password|secret)/i;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitize(child);
  }
  return out;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Backup payload must be an object");
  if (Number(payload.schemaVersion) !== BACKUP_SCHEMA) throw new TypeError("Unsupported backup schema version");
  if (!payload.domains || typeof payload.domains !== "object" || Array.isArray(payload.domains)) throw new TypeError("Backup domains are missing");
  const domains = Object.keys(payload.domains);
  for (const domain of domains) {
    if (!DOMAIN_METHODS[domain]) throw new TypeError(`Unsupported backup domain: ${domain}`);
    const value = payload.domains[domain];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Invalid backup domain: ${domain}`);
    if (Number(value.schemaVersion) !== 1) throw new TypeError(`Unsupported ${domain} schema version`);
  }
  return domains;
}

export async function exportNonSecretState(storage, { includeAudit = false, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!storage) throw new TypeError("Storage is required");
  const domains = {};
  for (const [domain, [loadMethod]] of Object.entries(DOMAIN_METHODS)) {
    if (domain === "audit" && !includeAudit) continue;
    if (typeof storage[loadMethod] !== "function") continue;
    domains[domain] = sanitize(await storage[loadMethod]());
  }
  return { schemaVersion: BACKUP_SCHEMA, exportedAt: Number(nowSeconds) || 0, domains };
}

export function previewImport(payload) {
  const domains = validatePayload(payload);
  return {
    schemaVersion: BACKUP_SCHEMA,
    exportedAt: Number(payload.exportedAt) || null,
    domains,
    counts: Object.fromEntries(domains.map((domain) => {
      const value = payload.domains[domain];
      if (Array.isArray(value?.entries)) return [domain, value.entries.length];
      if (value?.contractsById && typeof value.contractsById === "object") return [domain, Object.keys(value.contractsById).length];
      if (Array.isArray(value?.opportunities)) return [domain, value.opportunities.length];
      return [domain, 1];
    }))
  };
}

export async function applyImport(storage, payload) {
  const preview = previewImport(payload);
  const backup = await exportNonSecretState(storage, { includeAudit: true });
  if (typeof storage.saveBackup === "function") await storage.saveBackup(backup);
  for (const domain of preview.domains) {
    const [, saveMethod] = DOMAIN_METHODS[domain];
    if (typeof storage[saveMethod] !== "function") throw new Error(`Storage cannot import ${domain}`);
    await storage[saveMethod](clone(payload.domains[domain]));
  }
  return preview;
}
