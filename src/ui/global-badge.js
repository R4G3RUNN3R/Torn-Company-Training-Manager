import { escapeHtml, formatDateTime } from "./dom.js";

function nextEmployee(state) {
  const id = state?.rotation?.nextEmployeeId;
  return (state?.employees || []).find((employee) => Number(employee.id) === Number(id)) || null;
}

export function globalBadgeHtml(state, { managerUrl = "https://www.torn.com/companies.php?step=your#employees" } = {}) {
  const next = nextEmployee(state);
  const eligible = state?.rotation?.orderedEligible?.length ?? 0;
  const skipped = state?.rotation?.skipped?.length ?? 0;
  const count = Number(state?.trains);
  const trainWord = count === 1 ? "train" : "trains";
  const missingKey = /API key required/i.test(String(state?.error || ""));
  const freshness = state?.stale
    ? `<span class="r4-tcm-status-warn">${missingKey ? "API key required" : "Refresh required"}</span>`
    : `Updated ${escapeHtml(formatDateTime(state?.lastUpdatedAt))}`;
  const trainCount = state?.settings?.showTrainCount === false ? "" : `<div>${Number.isFinite(count) ? count : "?"} ${trainWord} available</div>`;
  return `<div class="r4-tcm-badge-head"><span>🎓 Company Training</span><button type="button" class="r4-tcm-btn" data-badge-action="toggle" aria-label="Collapse">−</button></div>
    <div class="r4-tcm-badge-body">
      <div>Next: <strong>${escapeHtml(next?.name || "None")}</strong></div>
      ${trainCount}
      <div>${eligible} eligible · ${skipped} skipped</div>
      <div class="r4-tcm-muted">${freshness}</div>
      <div><a href="${escapeHtml(managerUrl)}">Company Manager</a></div>
    </div>`;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export async function mountGlobalBadge({ state, controller, uiStorage, documentRef = globalThis.document, windowRef = globalThis.window, managerUrl } = {}) {
  if (!documentRef?.body || state?.settings?.showGlobalBadge === false) return { update() {}, destroy() {} };
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
    ui.x = clamp(ui.x, 0, maxX); ui.y = clamp(ui.y, 0, maxY);
    root.style.left = `${ui.x}px`; root.style.top = `${ui.y}px`; root.style.right = "auto"; root.style.bottom = "auto";
  };

  const render = () => {
    root.innerHTML = globalBadgeHtml(currentState, { managerUrl });
    root.classList.toggle("r4-tcm-collapsed", Boolean(ui.collapsed));
    const toggle = root.querySelector('[data-badge-action="toggle"]');
    if (toggle) {
      toggle.textContent = ui.collapsed ? "+" : "−";
      toggle.addEventListener("click", async () => { ui.collapsed = !ui.collapsed; render(); await uiStorage?.saveUi?.(ui); });
    }
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
        ui.x = event.clientX - dragging.dx; ui.y = event.clientY - dragging.dy; applyPosition();
      });
      head.addEventListener("pointerup", async (event) => { if (!dragging) return; dragging = null; head.releasePointerCapture?.(event.pointerId); await uiStorage?.saveUi?.(ui); });
    }
    applyPosition();
  };
  render();
  const onResize = () => applyPosition();
  windowRef?.addEventListener?.("resize", onResize);

  return {
    update(nextState) {
      currentState = nextState;
      if (nextState?.settings?.showGlobalBadge === false) { root.remove(); return; }
      render();
    },
    destroy() { windowRef?.removeEventListener?.("resize", onResize); root.remove(); }
  };
}
