export const TCM_STYLES = `
.r4-tcm-manager,.r4-tcm-badge,.r4-tcm-modal{box-sizing:border-box;font-family:Arial,sans-serif;color:var(--default-gray-9-color,#e5e5e5)}
.r4-tcm-manager *,.r4-tcm-badge *,.r4-tcm-modal *{box-sizing:border-box}
.r4-tcm-manager{margin:12px 0;padding:14px;border:1px solid #555;border-radius:8px;background:rgba(24,24,24,.96);box-shadow:0 2px 8px #0006}
.r4-tcm-header{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.r4-tcm-title{font-size:16px;font-weight:700;margin:0}.r4-tcm-summary{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.r4-tcm-summary-card{background:#111;padding:8px 10px;border-radius:6px;border:1px solid #444}.r4-tcm-next{color:#8bc34a}
.r4-tcm-stale{background:#6b3d00;color:#fff2cc;padding:8px;border-radius:5px;margin:8px 0}.r4-tcm-error{background:#601d1d;color:#ffd7d7;padding:8px;border-radius:5px;margin:8px 0}
.r4-tcm-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.r4-tcm-btn{border:1px solid #555;border-radius:5px;padding:7px 10px;background:#333;color:#eee;cursor:pointer;font-weight:600}
.r4-tcm-btn:hover:not(:disabled){filter:brightness(1.18)}.r4-tcm-btn:disabled{opacity:.45;cursor:not-allowed}.r4-tcm-btn-primary{background:#356b28}.r4-tcm-btn-danger{background:#7a3328}.r4-tcm-btn-warn{background:#745c18}
.r4-tcm-table-wrap{overflow:auto}.r4-tcm-table{width:100%;border-collapse:collapse;font-size:12px}.r4-tcm-table th,.r4-tcm-table td{padding:7px 6px;border-bottom:1px solid #444;text-align:left;vertical-align:middle}.r4-tcm-table th{font-weight:700;background:#222;position:sticky;top:0}.r4-tcm-row-next{outline:1px solid #6c9d54;background:#27402155}
.r4-tcm-status-ok{color:#8bc34a}.r4-tcm-status-bad{color:#ff8a80}.r4-tcm-status-warn{color:#ffd54f}.r4-tcm-muted{opacity:.72}.r4-tcm-reason{display:block;font-size:11px;margin-top:2px}
.r4-tcm-modal-backdrop{position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:10000000;padding:16px}.r4-tcm-modal{width:min(460px,100%);background:#222;border:1px solid #666;border-radius:8px;padding:16px;box-shadow:0 12px 40px #000}.r4-tcm-modal h3{margin:0 0 10px}.r4-tcm-modal input{width:100%;padding:8px;background:#111;color:#eee;border:1px solid #555;border-radius:4px;margin:8px 0}.r4-tcm-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.r4-tcm-badge{position:fixed;right:18px;bottom:18px;width:250px;background:#1d1d1df2;border:1px solid #555;border-radius:8px;z-index:999999;padding:10px;box-shadow:0 4px 18px #0009}.r4-tcm-badge-head{display:flex;justify-content:space-between;align-items:center;cursor:move;font-weight:700}.r4-tcm-badge-body{margin-top:8px;font-size:12px;line-height:1.5}.r4-tcm-badge.r4-tcm-collapsed .r4-tcm-badge-body{display:none}
.r4-tcm-settings-row{margin:10px 0}.r4-tcm-settings-row label{display:block;font-weight:600;margin-bottom:3px}.r4-tcm-settings-check{display:flex;gap:8px;align-items:center}.r4-tcm-settings-check input{width:auto;margin:0}
`;

export function injectStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || documentRef.getElementById?.("r4-tcm-styles")) return;
  const style = documentRef.createElement("style");
  style.id = "r4-tcm-styles";
  style.textContent = TCM_STYLES;
  documentRef.head.appendChild(style);
}
