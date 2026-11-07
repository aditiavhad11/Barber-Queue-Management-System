import {
  SHOP_TIME_ZONE,
  WEEKDAY_CODES,
  clockMinutes,
  weekdayIST as weekdayForDate,
} from "./time.js";

export { SHOP_TIME_ZONE, WEEKDAY_CODES };

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
