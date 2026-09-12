function isActuallyVisible(el, windowRef) {
  if (!el) return false;
  try {
    const rect = el.getBoundingClientRect?.();
    const style = windowRef?.getComputedStyle?.(el);
    const hasSize = !rect || (Number(rect.width) > 0 && Number(rect.height) > 0);
    return hasSize
      && (!style || style.display !== "none")
      && (!style || style.visibility !== "hidden")
      && (!style || style.opacity !== "0");
  } catch {
    return false;
  }
}

export function findStatusIconsBar(documentRef, windowRef = globalThis.window) {
  const selectors = [
    'ul[class*="status-icons"]',
    'ul[class*="statusIcons"]',
    'div[class*="status-icons"] ul',
    'div[class*="statusIcons"] ul',
    'header ul',
    '[class*="header"] ul',
    '[class*="top"] ul'
  ];
  for (const selector of selectors) {
    const candidate = documentRef?.querySelector?.(selector);
    if (isActuallyVisible(candidate, windowRef)) return candidate;
  }
  return null;
}

function nextEmployeeName(state) {
  const id = Number(state?.recommendation?.nextEmployeeId ?? state?.rotation?.nextEmployeeId);
  if (!Number.isFinite(id)) return null;
  return (state?.employees || []).find((employee) => Number(employee?.id) === id)?.name || null;
}

function dockTone(state) {
  if (state?.stale || state?.status === "error" || state?.error) return "error";
  if (["awaiting_verification", "accepted_unverified", "submission_unknown"].includes(state?.action?.status)) return "warning";
  if ((state?.attention || []).some?.((item) => item?.severity === "critical")) return "error";
  if ((state?.attention || []).some?.((item) => item?.severity === "action")) return "warning";
  if (Number(state?.trains) > 0) return "ready";
  return "idle";
}

function dockTitle(state, isManagerOpen) {
  const trains = Number.isFinite(Number(state?.trains)) ? Number(state.trains) : "?";
  const next = nextEmployeeName(state);
  const action = isManagerOpen ? "Minimize" : "Open";
  return `${action} Company Training Manager · ${trains} train${trains === 1 ? "" : "s"}${next ? ` · Next: ${next}` : ""}`;
}

export const MANAGER_DOCK_STYLES = `
.r4-tcm-dock-icon{position:relative!important;width:28px!important;height:28px!important;min-width:28px!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;user-select:none!important;list-style:none!important;border:1px solid transparent!important;border-radius:7px!important;margin:0 2px!important;transition:background .15s ease,border-color .15s ease!important}
.r4-tcm-dock-icon:hover{background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.12)!important}
.r4-tcm-dock-glyph{font:800 13px/1 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important;color:#ececef!important;letter-spacing:-.03em!important}
.r4-tcm-dock-accent{color:#b33b38!important;font-size:8px!important;margin-left:1px!important}
.r4-tcm-dock-dot{position:absolute!important;right:1px!important;bottom:1px!important;width:7px!important;height:7px!important;border-radius:50%!important;background:#888!important;border:1px solid #181818!important}
.r4-tcm-dock-icon[data-tone="ready"] .r4-tcm-dock-dot{background:#63d467!important;box-shadow:0 0 5px #63d46788!important}
.r4-tcm-dock-icon[data-tone="warning"] .r4-tcm-dock-dot{background:#e2b84d!important}
.r4-tcm-dock-icon[data-tone="error"] .r4-tcm-dock-dot{background:#ef6262!important}
.r4-tcm-dock-fallback{position:fixed!important;right:8px!important;top:120px!important;z-index:1000000!important}
.r4-tcm-dock-fallback button{width:34px!important;height:34px!important;padding:0!important;border:1px solid #555!important;border-radius:8px!important;background:#1d1d20!important;color:#fff!important;cursor:pointer!important;box-shadow:0 5px 18px #0009!important;font:800 13px/1 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important}
.r4-tcm-floating-shell.r4-tcm-minimized{display:none!important}
`;

function ensureDockStyles(documentRef) {
  if (!documentRef?.head || documentRef.getElementById?.("r4-tcm-dock-styles")) return;
  const style = documentRef.createElement("style");
  style.setAttribute?.("id", "r4-tcm-dock-styles");
  style.textContent = MANAGER_DOCK_STYLES;
  documentRef.head.appendChild(style);
}

function buildDockIcon(documentRef, onToggle) {
  const li = documentRef.createElement("li");
  li.classList.add("r4-tcm-dock-icon");
  li.setAttribute?.("role", "button");
  li.setAttribute?.("tabindex", "0");
  li.setAttribute?.("aria-label", "Company Training Manager");

  const glyph = documentRef.createElement("span");
  glyph.classList.add("r4-tcm-dock-glyph");
  glyph.textContent = "T";
  li.appendChild(glyph);
  const accent = documentRef.createElement("span");
  accent.classList.add("r4-tcm-dock-accent");
  accent.textContent = "◆";
  li.appendChild(accent);

  const dot = documentRef.createElement("span");
  dot.classList.add("r4-tcm-dock-dot");
  li.appendChild(dot);

  const activate = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onToggle?.();
  };
  li.addEventListener?.("click", activate);
  li.addEventListener?.("keydown", (event) => {
    if (event?.key === "Enter" || event?.key === " ") activate(event);
  });
  return li;
}

function buildFallback(documentRef, onToggle) {
  const wrap = documentRef.createElement("div");
  wrap.setAttribute?.("id", "r4-tcm-dock-fallback");
  wrap.classList.add("r4-tcm-dock-fallback");
  const button = documentRef.createElement("button");
  button.setAttribute?.("type", "button");
  button.setAttribute?.("aria-label", "Company Training Manager");
  button.textContent = "T◆";
  button.addEventListener?.("click", (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onToggle?.();
  });
  wrap.appendChild(button);
  documentRef.body?.appendChild?.(wrap);
  return wrap;
}

function managerRoot(documentRef) {
  return documentRef?.getElementById?.("r4-tcm-company-root") || null;
}

function managerIsOpen(documentRef) {
  const root = managerRoot(documentRef);
  if (!root) return false;
  return !root.classList?.contains?.("r4-tcm-minimized") && root.style?.display !== "none";
}

function defaultToggleManager({ documentRef, windowRef, managerUrl }) {
  const root = managerRoot(documentRef);
  const minimizeButton = root?.querySelector?.('[data-window-action="minimize"]');
  if (minimizeButton?.click) {
    minimizeButton.click();
    return true;
  }
  try {
    if (managerUrl) windowRef.location.href = managerUrl;
  } catch {}
  return false;
}

export function mountManagerDock({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  state = {},
  isManagerOpen = null,
  managerUrl = "https://www.torn.com/companies.php?step=your#employees",
  onToggle = null,
  MutationObserverImpl = globalThis.MutationObserver
} = {}) {
  if (!documentRef?.createElement || !documentRef?.body) return { update() {}, ensure() {}, destroy() {} };
  ensureDockStyles(documentRef);
  let currentState = state || {};
  let currentOpen = typeof isManagerOpen === "boolean" ? isManagerOpen : managerIsOpen(documentRef);
  let destroyed = false;
  let icon = null;

  const updatePresentation = () => {
    const tone = dockTone(currentState);
    const title = dockTitle(currentState, currentOpen);
    for (const element of [icon, fallback]) {
      if (!element) continue;
      element.title = title;
      element.dataset.tone = tone;
      element.dataset.managerOpen = currentOpen ? "true" : "false";
    }
    const button = fallback?.querySelector?.("button");
    if (button) button.title = title;
  };

  const toggle = async () => {
    if (typeof onToggle === "function") await onToggle();
    else defaultToggleManager({ documentRef, windowRef, managerUrl });
    currentOpen = managerIsOpen(documentRef);
    updatePresentation();
  };

  let fallback = documentRef.getElementById?.("r4-tcm-dock-fallback") || buildFallback(documentRef, toggle);

  const ensure = () => {
    if (destroyed) return;
    if (typeof isManagerOpen !== "boolean") currentOpen = managerIsOpen(documentRef);
    const bar = findStatusIconsBar(documentRef, windowRef);
    const existing = documentRef.querySelector?.(".r4-tcm-dock-icon");
    if (bar) {
      fallback.style.display = "none";
      if (existing && existing.parentElement === bar) {
        icon = existing;
      } else {
        existing?.remove?.();
        icon = buildDockIcon(documentRef, toggle);
        try { bar.prepend(icon); } catch { bar.appendChild?.(icon); }
      }
    } else {
      existing?.remove?.();
      icon = null;
      fallback.style.display = "block";
    }
    updatePresentation();
  };

  const onDocumentClick = (event) => {
    if (!event?.target?.closest?.('[data-window-action="minimize"]')) return;
    Promise.resolve().then(() => {
      currentOpen = managerIsOpen(documentRef);
      updatePresentation();
    });
  };

  ensure();
  documentRef.addEventListener?.("click", onDocumentClick, true);
  const observer = MutationObserverImpl ? new MutationObserverImpl(() => ensure()) : null;
  observer?.observe?.(documentRef.documentElement || documentRef.body, { childList: true, subtree: true });

  return {
    update(nextState, { managerOpen } = {}) {
      currentState = nextState || {};
      currentOpen = typeof managerOpen === "boolean" ? managerOpen : managerIsOpen(documentRef);
      ensure();
    },
    ensure,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect?.();
      documentRef.removeEventListener?.("click", onDocumentClick, true);
      icon?.remove?.();
      fallback?.remove?.();
      documentRef.getElementById?.("r4-tcm-dock-styles")?.remove?.();
      icon = null;
      fallback = null;
    }
  };
}
