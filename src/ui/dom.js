export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatMoney(value) {
  return Number.isFinite(Number(value)) ? `$${Math.trunc(Number(value)).toLocaleString("en-US")}` : "—";
}

export function formatDateTime(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return "Never";
  try { return new Date(Number(seconds) * 1000).toLocaleString(); } catch { return "—"; }
}

export function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "Unknown";
  const total = Math.floor(Number(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function byId(mapLike, id) {
  if (mapLike instanceof Map) return mapLike.get(Number(id));
  return mapLike?.[id] ?? mapLike?.[String(id)];
}
