export const TCM_STYLES = `
.r4-tcm-manager,.r4-tcm-badge,.r4-tcm-modal,.r4-tcm-audit-panel{box-sizing:border-box;font-family:Arial,sans-serif;color:#f4f4f4!important}
.r4-tcm-manager *,.r4-tcm-badge *,.r4-tcm-modal *,.r4-tcm-audit-panel *{box-sizing:border-box}
.r4-tcm-manager{margin:0;padding:14px;border:1px solid #666;border-radius:8px;background:rgba(24,24,24,.98);box-shadow:0 8px 28px #000a;color:#f4f4f4!important;height:100%;display:flex;flex-direction:column;overflow:hidden}
.r4-tcm-header{display:flex;gap:12px;align-items:center;justify-content:space-between;color:#f4f4f4!important;min-height:32px}
.r4-tcm-header-right{display:flex;align-items:center;gap:10px;min-width:0}
.r4-tcm-window-controls{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.r4-tcm-window-btn{width:30px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #666;border-radius:5px;background:#303030;color:#f4f4f4!important;cursor:pointer;font-size:16px;font-weight:700;line-height:1;padding:0}
.r4-tcm-window-btn:hover{filter:brightness(1.22)}
.r4-tcm-title{font-size:16px;font-weight:700;margin:0;color:#fff!important}.r4-tcm-manager-body{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}.r4-tcm-summary{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.r4-tcm-summary-card{background:#111;padding:8px 10px;border-radius:6px;border:1px solid #444;color:#f4f4f4!important}.r4-tcm-next{color:#7cff4f!important}
.r4-tcm-stale{background:#6b3d00;color:#fff2cc!important;padding:8px;border-radius:5px;margin:8px 0}.r4-tcm-error{background:#601d1d;color:#ffd7d7!important;padding:8px;border-radius:5px;margin:8px 0}.r4-tcm-info{background:#17344e;color:#d9efff!important;padding:8px;border-radius:5px;margin:8px 0}.r4-tcm-success{background:#214d22;color:#dcffdd!important;padding:8px;border-radius:5px;margin:8px 0}
.r4-tcm-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.r4-tcm-btn{border:1px solid #666;border-radius:5px;padding:7px 10px;background:#333;color:#f4f4f4!important;cursor:pointer;font-weight:600}
.r4-tcm-btn:hover:not(:disabled){filter:brightness(1.18)}.r4-tcm-btn:disabled{opacity:.45;cursor:not-allowed}.r4-tcm-btn-primary{background:#356b28}.r4-tcm-btn-danger{background:#7a3328}.r4-tcm-btn-warn{background:#745c18}
.r4-tcm-table-wrap{overflow:auto;flex:1;min-height:0}.r4-tcm-table{width:100%;border-collapse:collapse;font-size:12px;color:#f4f4f4!important}.r4-tcm-table th,.r4-tcm-table td{padding:7px 6px;border-bottom:1px solid #444;text-align:left;vertical-align:middle;color:#f4f4f4!important}.r4-tcm-table th{font-weight:700;background:#222;position:sticky;top:0;z-index:1}.r4-tcm-row-next{outline:1px solid #7cff4f;background:#27402166}.r4-tcm-row-ineligible{background:rgba(100,20,20,.16)}
.r4-tcm-status-ok{color:#7cff4f!important;font-weight:700}.r4-tcm-status-bad{color:#ff6b6b!important;font-weight:700}.r4-tcm-status-warn{color:#ffe45c!important;font-weight:700}.r4-tcm-muted{color:#c7c7c7!important;opacity:1}.r4-tcm-reason{display:block;font-size:11px;margin-top:2px;color:#e8e8e8!important}.r4-tcm-manager strong{color:#fff!important}
.r4-tcm-diagnostics{margin:8px 0 10px;padding:8px 10px;border:1px solid #3f5365;border-radius:6px;background:#0d141a;flex:0 0 auto}.r4-tcm-diagnostics summary{cursor:pointer;font-weight:700;color:#d9efff!important;user-select:none}.r4-tcm-diagnostics-pre{margin:10px 0 0;padding:10px;max-height:260px;overflow:auto;border:1px solid #283746;border-radius:5px;background:#070a0d;color:#d6e7f5!important;font:11px/1.45 Consolas,Monaco,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.r4-tcm-diagnostics-actions{margin-bottom:0}
.r4-tcm-modal-backdrop{position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:10000000;padding:16px}.r4-tcm-modal{width:min(460px,100%);background:#222;border:1px solid #666;border-radius:8px;padding:16px;box-shadow:0 12px 40px #000;color:#f4f4f4!important}.r4-tcm-modal h3{margin:0 0 10px;color:#fff!important}.r4-tcm-modal input{width:100%;padding:8px;background:#111;color:#eee!important;border:1px solid #555;border-radius:4px;margin:8px 0}.r4-tcm-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.r4-tcm-audit-backdrop{align-items:center;justify-content:center}.r4-tcm-audit-panel{width:min(920px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;background:#181818;border:1px solid #666;border-radius:8px;padding:14px;box-shadow:0 12px 40px #000;color:#f4f4f4!important}.r4-tcm-audit-filters{display:grid;grid-template-columns:minmax(130px,1fr) minmax(160px,1fr) minmax(180px,2fr);gap:10px;margin:12px 0}.r4-tcm-audit-filters label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#e8e8e8!important}.r4-tcm-audit-filters select,.r4-tcm-audit-filters input{width:100%;padding:7px 8px;border:1px solid #555;border-radius:5px;background:#111;color:#f4f4f4!important}.r4-tcm-audit-table-wrap{max-height:58vh;overflow:auto;flex:1 1 auto}.r4-tcm-audit-table th{z-index:2}.r4-tcm-audit-details{max-width:410px;font-family:Consolas,Monaco,monospace;font-size:11px;overflow-wrap:anywhere;white-space:normal}.r4-tcm-audit-panel .r4-tcm-header{flex:0 0 auto}
.r4-tcm-badge{position:fixed;right:18px;bottom:18px;width:250px;background:#1d1d1df2;border:1px solid #555;border-radius:8px;z-index:999999;padding:10px;box-shadow:0 4px 18px #0009}.r4-tcm-badge-head{display:flex;justify-content:space-between;align-items:center;cursor:move;font-weight:700}.r4-tcm-badge-body{margin-top:8px;font-size:12px;line-height:1.5}.r4-tcm-badge.r4-tcm-collapsed .r4-tcm-badge-body{display:none}
.r4-tcm-settings-row{margin:10px 0}.r4-tcm-settings-row label{display:block;font-weight:600;margin-bottom:3px}.r4-tcm-settings-check{display:flex;gap:8px;align-items:center}.r4-tcm-settings-check input{width:auto;margin:0}
.r4-tcm-floating-shell{z-index:999999!important;resize:both;overflow:hidden;min-width:520px;min-height:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px)}
.r4-tcm-floating-shell .r4-tcm-header{cursor:move;user-select:none}
.r4-tcm-floating-shell .r4-tcm-window-btn{cursor:pointer;user-select:none}
.r4-tcm-floating-shell.r4-tcm-minimized{min-height:64px!important;max-height:64px!important}
.r4-tcm-floating-shell.r4-tcm-minimized .r4-tcm-manager-body{display:none}
.r4-tcm-floating-shell.r4-tcm-maximized{max-width:none;max-height:none}
@media(max-width:720px){.r4-tcm-audit-filters{grid-template-columns:1fr}.r4-tcm-audit-panel{width:98vw;max-height:94vh}.r4-tcm-audit-details{max-width:240px}}
`;

export function injectStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || documentRef.getElementById?.("r4-tcm-styles")) return;
  const style = documentRef.createElement("style");
  style.id = "r4-tcm-styles";
  style.textContent = TCM_STYLES;
  documentRef.head.appendChild(style);
}
