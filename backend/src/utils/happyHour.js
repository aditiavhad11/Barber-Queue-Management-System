export const SHOP_TIME_ZONE = "Asia/Kolkata";
export const WEEKDAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + Number(match[2]);
}

function weekdayForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: SHOP_TIME_ZONE, weekday: "short" }).format(parsed);
}

function currentLocalParts(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  if (!WEEKDAY_CODES.includes(value("weekday")) || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { weekday: value("weekday"), minute: (hour % 24) * 60 + minute };
}

function normalizedDays(days) {
  if (typeof days === "string") {
    try { days = JSON.parse(days); } catch { return null; }
  }
  if (!Array.isArray(days)) return [];
  return days.map(String);
}

export function isWithinHappyHour({
  startTime,
  endTime,
  days = [],
  bookingDate,
  scheduledTime = null,
  now = new Date(),
}) {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  const applicableDays = normalizedDays(days);
  if (start == null || end == null || start === end || applicableDays == null) return false;
  if (applicableDays.some((day) => !WEEKDAY_CODES.includes(day))) return false;

  let local;
  if (scheduledTime) {
    const minute = clockMinutes(scheduledTime);
    const weekday = weekdayForDate(bookingDate);
    if (minute == null || !weekday) return false;
    local = { weekday, minute };
  } else {
    local = currentLocalParts(now);
    if (!local) return false;
  }

  let windowDay = local.weekday;
  let insideWindow;
  if (start < end) {
    insideWindow = local.minute >= start && local.minute < end;
  } else if (local.minute >= start) {
    insideWindow = true;
  } else if (local.minute < end) {
    insideWindow = true;
    windowDay = WEEKDAY_CODES[(WEEKDAY_CODES.indexOf(local.weekday) + 6) % 7];
  } else {
    insideWindow = false;
  }
  return insideWindow && (!applicableDays.length || applicableDays.includes(windowDay));
}
