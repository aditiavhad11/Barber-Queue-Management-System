export const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// availability.days is the list of OPEN days. A day missing from the list is a "Close Shop" day.
// Shops saved before this option existed have no list, so they stay open every day.
export const openDaysOf = (shop) => (Array.isArray(shop?.availability?.days) ? shop.availability.days : ALL_DAYS);
export const isClosedToday = (shop, date = new Date()) => !openDaysOf(shop).includes(JS_DAY[date.getDay()]);
export const isShopOpenNow = (shop) => Boolean(shop?.open ?? shop?.isOpen) && !isClosedToday(shop);

// ---- Per-day schedule: availability.schedule = { Mon: { open: "10:30", close: "20:00", closed: false }, ... } (24h)
export const defaultSchedule = (open = "09:00", close = "21:00") => Object.fromEntries(ALL_DAYS.map((d) => [d, { open, close, closed: false }]));
export const scheduleOf = (shop) => {
  const saved = shop?.availability?.schedule;
  const hours = shop?.hours || {};
  const base = defaultSchedule(String(hours.open || "09:00").slice(0, 5), String(hours.close || "21:00").slice(0, 5));
  if (saved && typeof saved === "object") return Object.fromEntries(ALL_DAYS.map((d) => [d, { ...base[d], ...(saved[d] || {}) }]));
  const days = openDaysOf(shop);
  return Object.fromEntries(ALL_DAYS.map((d) => [d, { ...base[d], closed: !days.includes(d) }]));
};
// Keep the old fields in sync so everything that reads availability.days / hours keeps working.
export const withSchedule = (availability = {}, schedule) => ({ ...availability, schedule, days: ALL_DAYS.filter((d) => !schedule[d].closed) });
export const hoursFromSchedule = (schedule) => {
  const first = ALL_DAYS.find((d) => !schedule[d].closed) || "Mon";
  return { open: schedule[first].open, close: schedule[first].close };
};
export const scheduleError = (schedule) => {
  if (ALL_DAYS.every((d) => schedule[d].closed)) return "Keep at least one day open.";
  const bad = ALL_DAYS.find((d) => !schedule[d].closed && schedule[d].close <= schedule[d].open);
  return bad ? `${bad}: closing time must be after opening time.` : "";
};
export const todayHoursText = (shop, date = new Date()) => {
  const d = JS_DAY[date.getDay()];
  const e = scheduleOf(shop)[d];
  return e.closed ? `${d}: Closed` : `${d}: ${e.open} - ${e.close}`;
};
