export const SHOP_TIME_ZONE = "Asia/Kolkata";
export const WEEKDAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Returns a date string in YYYY-MM-DD format in the target timezone (defaults to Asia/Kolkata).
 * Works with Date objects, date strings, or timestamps.
 */
export function todayIST(date = new Date(), timeZone = SHOP_TIME_ZONE) {
  const target = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export const localDateKey = todayIST;
export const scheduledQueueDate = todayIST;

/**
 * Returns a 24-hour time string in HH:mm format in the target timezone (defaults to Asia/Kolkata).
 */
export function nowTimeIST(date = new Date(), timeZone = SHOP_TIME_ZONE) {
  const target = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(target);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick("hour")}:${pick("minute")}`;
}

export const localTimeKey = nowTimeIST;

/**
 * Returns the short weekday name (e.g. "Mon", "Tue") for a given date or YYYY-MM-DD string in shop timezone.
 */
export function weekdayIST(date, timeZone = SHOP_TIME_ZONE) {
  if (!date) return null;
  const target =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? new Date(`${date.trim()}T12:00:00Z`)
      : date instanceof Date
        ? date
        : new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(target);
}

export const weekdayForDate = weekdayIST;

/**
 * Parses a clock time string (e.g. "09:00", "9:05:00", "21:30") into minutes from midnight (0..1439).
 * Returns null for invalid times.
 */
export function clockMinutes(value, fallback) {
  const raw =
    value !== undefined && value !== null && value !== "" ? value : fallback;
  const match = String(raw || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

export const timeToMinutes = clockMinutes;
export const toMinutes = clockMinutes;

/**
 * Returns the difference in minutes between two times or dates: end - start.
 * If both arguments are "HH:MM" (or "HH:MM:SS") strings, computes difference in clock minutes.
 * Otherwise, treats them as Date objects or ISO date/time strings and computes the elapsed minutes.
 */
export function minutesBetween(start, end) {
  if (
    typeof start === "string" &&
    typeof end === "string" &&
    /^\d{1,2}:\d{2}/.test(start.trim()) &&
    /^\d{1,2}:\d{2}/.test(end.trim()) &&
    !start.includes("T") &&
    !end.includes("T") &&
    !start.includes("-") &&
    !end.includes("-")
  ) {
    const startMin = clockMinutes(start);
    const endMin = clockMinutes(end);
    if (startMin != null && endMin != null) {
      return endMin - startMin;
    }
  }

  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  return Math.floor((endDate.getTime() - startDate.getTime()) / 60000);
}

/**
 * Calculates minutes remaining until a scheduled appointment on a given date and time.
 * Appointment time is interpreted in Asia/Kolkata (+05:30).
 */
export function minutesUntilAppointment(date, time, now = new Date()) {
  const appointment = new Date(`${date}T${String(time).slice(0, 8)}+05:30`);
  return Math.floor((appointment.getTime() - (now instanceof Date ? now : new Date(now)).getTime()) / 60000);
}

/**
 * True only for a real calendar date in YYYY-MM-DD format.
 */
export function isValidDateKey(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

export default {
  SHOP_TIME_ZONE,
  WEEKDAY_CODES,
  todayIST,
  localDateKey,
  scheduledQueueDate,
  nowTimeIST,
  localTimeKey,
  weekdayIST,
  weekdayForDate,
  clockMinutes,
  timeToMinutes,
  toMinutes,
  minutesBetween,
  minutesUntilAppointment,
  isValidDateKey,
};

