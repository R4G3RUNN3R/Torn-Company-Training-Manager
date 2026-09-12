import { escapeHtml } from "./dom.js";

export function dataRecoveryHtml() {
  return `<div class="r4-tcm-settings-stack">
    <p class="r4-tcm-settings-help">Back up or move Training Manager state without exporting your Torn API key.</p>
    <button type="button" class="r4-tcm-btn" data-settings-action="export-data">Export Training Manager Data</button>
    <button type="button" class="r4-tcm-btn" data-settings-action="import-data">Import Training Manager Data</button>
    <button type="button" class="r4-tcm-btn" data-settings-action="rebuild">Rebuild Training History</button>
    <button type="button" class="r4-tcm-btn r4-tcm-btn-danger" data-settings-action="reset">Reset Local Data</button>
  </div>`;
}

export function backupDownloadName(timestamp = Date.now()) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) throw new TypeError("Backup timestamp is invalid");
  return `voidsmith-training-manager-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function parseImportText(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? ""));
  } catch {
    throw new TypeError("Import must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Import must be a JSON object");
  if (Number(value.schemaVersion) !== 1) throw new TypeError("Unsupported backup schema version");
  if (!value.domains || typeof value.domains !== "object" || Array.isArray(value.domains)) throw new TypeError("Backup domains are missing");
  return value;
}

export function importPreviewHtml(preview = {}) {
  const domains = Array.isArray(preview.domains) ? preview.domains : [];
  const rows = domains.map((domain) => `<li><strong>${escapeHtml(domain)}</strong>${preview.counts?.[domain] != null ? ` · ${escapeHtml(preview.counts[domain])}` : ""}</li>`).join("");
  return `<div class="r4-tcm-import-preview"><p>This import will replace the validated local domains below. A backup of current non-secret state is created first.</p><ul>${rows}</ul></div>`;
}
