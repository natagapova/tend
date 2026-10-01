// Relevance decays exponentially with time since the tab last had focus.
// A tab that was focused HALF_LIFE_HOURS ago scores 0.5; the active tab scores 1.

export const HALF_LIFE_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

export function relevance(tab, now = Date.now()) {
  if (tab.active) return 1;
  const hours = Math.max(0, now - tab.lastFocusedAt) / HOUR_MS;
  return Math.pow(0.5, hours / HALF_LIFE_HOURS);
}
