// Restaurant cash positions can legitimately go negative (e.g. a Daily
// Closing that opens with a cash deficit) — format as "-₹504.00", not
// "₹-504.00", so the sign reads naturally.
export function formatCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}₹${Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCurrencyCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}k`;
  return formatCurrency(amount);
}

export function formatDateDisplay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateShort(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
