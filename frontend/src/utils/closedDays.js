import { to12Hour } from "./time.js";

export const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// availability.days is the list of OPEN days. A day missing from the list is a "Close Shop" day.
// Shops saved before this option existed have no list, so they stay open every day.
const SHOP_TIME_ZONE = "Asia/Kolkata";
const shopDateParts = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
export const toLocalDateString = (d = new Date()) => {
  const parts = shopDateParts(d);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

export const formatDateDisplay = (str, includeYear = false) => {
  if (!str) return "";
  try {
    const [y, m, d] = str.split("-").map(Number);
    if (!y || !m || !d) return str;
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" } : {}),
    });
  } catch {
    return str;
  }
};

export const getTemporaryClosure = (shop, date = new Date()) => {
  const tc = shop?.availability?.temporaryClosure;
  if (!tc || !tc.active) return { isClosed: false };

  const current = toLocalDateString(date);
  if (tc.startAt || tc.endAt) {
    const start = tc.startAt ? new Date(tc.startAt) : null;
    const end = tc.endAt ? new Date(tc.endAt) : null;
    if (start && date < start)
      return { isClosed: false, upcoming: true, startAt: tc.startAt, endAt: tc.endAt, reason: String(tc.reason || "").trim() };
    if (end && date >= end)
      return { isClosed: false, expired: true, startAt: tc.startAt, endAt: tc.endAt };
    return {
      isClosed: true,
      startAt: tc.startAt,
      endAt: tc.endAt,
      startDate: tc.startDate || tc.startAt?.slice(0, 10),
      endDate: tc.endDate || tc.endAt?.slice(0, 10),
      reason: String(tc.reason || "").trim(),
    };
  }
  const start = tc.startDate || current;
  const end = tc.endDate || "";

  if (current < start) {
    return {
      isClosed: false,
      upcoming: true,
      startDate: start,
      endDate: end,
      reason: String(tc.reason || "").trim(),
    };
  }

  if (end && current > end) {
    return { isClosed: false, expired: true };
  }

  return {
    isClosed: true,
    startDate: start,
    endDate: end,
    reason: String(tc.reason || "").trim(),
  };
};

export const annualSchedulesOf = (shopOrAvailability) => {
  const availability = shopOrAvailability?.availability || shopOrAvailability || {};
  const saved = availability?.annualSchedules;
  if (!saved || typeof saved !== "object") return {};
  return Object.fromEntries(
    Object.entries(saved)
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, item]) => [
        date,
        {
          type: ["closed", "half_day", "special_hours"].includes(item?.type)
            ? item.type
            : "closed",
          open: String(item?.open || "09:00").slice(0, 5),
          close: String(item?.close || "21:00").slice(0, 5),
          note: String(item?.note || "").slice(0, 200),
        },
      ]),
  );
};

export const annualScheduleForDate = (shop, date = new Date()) =>
  annualSchedulesOf(shop)[
    typeof date === "string" ? date : toLocalDateString(date)
  ] || null;

export const MAX_SHIFTS_PER_DAY = 6;

export const normalizeDayShifts = (dayObj) => {
  if (Array.isArray(dayObj?.shifts) && dayObj.shifts.length > 0) {
    return dayObj.shifts.slice(0, MAX_SHIFTS_PER_DAY).map((s) => ({
      open: String(s?.open || "09:00").slice(0, 5),
      close: String(s?.close || "21:00").slice(0, 5),
    }));
  }
  return [
    {
      open: String(dayObj?.open || "09:00").slice(0, 5),
      close: String(dayObj?.close || "21:00").slice(0, 5),
    },
  ];
};

export const formatShiftDisplay = (s) => {
  const o = to12Hour(s?.open || "09:00");
  const c = to12Hour(s?.close || "21:00");
  return `${o.time} ${o.period} - ${c.time} ${c.period}`;
};

export const openDaysOf = (shop) =>
  Array.isArray(shop?.availability?.days) ? shop.availability.days : ALL_DAYS;
export const isClosedToday = (shop, date = new Date()) =>
  !openDaysOf(shop).includes(JS_DAY[date.getDay()]);

const tcEnded = (shop, date = new Date()) => {
  const end = shop?.availability?.temporaryClosure?.endAt;
  return Boolean(end && new Date(end) <= date);
};

export const isShopOpenNow = (shop, date = new Date()) => {
  if (getTemporaryClosure(shop, date).isClosed) return false;
  const manualOpen = shop?.availability?.isOpen === true;
  const annual = annualScheduleForDate(shop, date);
  if (annual?.type === "closed" && !manualOpen) return false;
  const openFlag =
    shop?.availability?.isOpen !== undefined
      ? shop.availability.isOpen
      : shop?.open !== undefined
        ? shop.open
        : shop?.isOpen !== undefined
          ? shop.isOpen
          : true;
  const expiredEmergency =
    shop?.availability?.emergencyClosed &&
    tcEnded(shop, date);
  if ((!openFlag && !expiredEmergency) || (!manualOpen && isClosedToday(shop, date))) return false;

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIME_ZONE,
    weekday: "short",
  }).format(date);
  const d = weekday;
  const sched = scheduleOf(shop)[d];
  if (!sched || (sched.closed && !manualOpen)) return false;

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHOP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const currentH = timeParts.find((part) => part.type === "hour")?.value;
  const currentM = timeParts.find((part) => part.type === "minute")?.value;
  const now = `${currentH}:${currentM}`;
  if (manualOpen) return true;

  const override = shop?.availability?.operationalHours;
  if (
    override?.enabled &&
    (!override.date || override.date === toLocalDateString(date)) &&
    /^\d{2}:\d{2}$/.test(String(override.open)) &&
    /^\d{2}:\d{2}$/.test(String(override.close))
  ) {
    return now >= override.open && now < override.close;
  }

  if (annual && ["half_day", "special_hours"].includes(annual.type)) {
    return now >= annual.open && now < annual.close;
  }

  const shifts = normalizeDayShifts(sched);
  return shifts.some((s) => now >= s.open && now < s.close);
};

// ---- Per-day schedule: availability.schedule = { Mon: { open: "09:00", close: "21:00", closed: false, shifts: [...] }, ... }
export const defaultSchedule = (open = "09:00", close = "21:00") =>
  Object.fromEntries(
    ALL_DAYS.map((d) => [
      d,
      {
        open,
        close,
        closed: false,
        shifts: [{ open, close }],
      },
    ]),
  );

export const scheduleOf = (shop) => {
  const saved = shop?.availability?.schedule;
  const hours = shop?.hours || {};
  const base = defaultSchedule(
    String(hours.open || "09:00").slice(0, 5),
    String(hours.close || "21:00").slice(0, 5),
  );
  if (saved && typeof saved === "object") {
    return Object.fromEntries(
      ALL_DAYS.map((d) => {
        const item = saved[d] || {};
        const shifts = normalizeDayShifts({ ...base[d], ...item });
        const earliest = shifts[0]?.open || item.open || base[d].open;
        const latest =
          shifts[shifts.length - 1]?.close || item.close || base[d].close;
        return [
          d,
          {
            ...base[d],
            ...item,
            open: earliest,
            close: latest,
            shifts,
          },
        ];
      }),
    );
  }
  const days = openDaysOf(shop);
  return Object.fromEntries(
    ALL_DAYS.map((d) => [
      d,
      {
        ...base[d],
        closed: !days.includes(d),
        shifts: normalizeDayShifts(base[d]),
      },
    ]),
  );
};

// Keep the old fields in sync so everything that reads availability.days / hours keeps working.
export const withSchedule = (availability = {}, schedule) => {
  const normalizedSchedule = Object.fromEntries(
    ALL_DAYS.map((d) => {
      const item = schedule[d] || {};
      const shifts = normalizeDayShifts(item);
      const earliest = shifts[0]?.open || item.open || "09:00";
      const latest =
        shifts[shifts.length - 1]?.close || item.close || "21:00";
      return [
        d,
        {
          ...item,
          open: earliest,
          close: latest,
          shifts,
        },
      ];
    }),
  );
  return {
    ...availability,
    schedule: normalizedSchedule,
    days: ALL_DAYS.filter((d) => !normalizedSchedule[d].closed),
  };
};

export const hoursFromSchedule = (schedule) => {
  const first = ALL_DAYS.find((d) => !schedule[d]?.closed) || "Mon";
  const item = schedule[first] || {};
  const shifts = normalizeDayShifts(item);
  return {
    open: shifts[0]?.open || item.open || "09:00",
    close: shifts[shifts.length - 1]?.close || item.close || "21:00",
  };
};

export const scheduleError = (schedule) => {
  if (ALL_DAYS.every((d) => schedule[d]?.closed))
    return "Keep at least one day open.";

  for (const d of ALL_DAYS) {
    const day = schedule[d];
    if (day?.closed) continue;

    if (Array.isArray(day?.shifts) && day.shifts.length > MAX_SHIFTS_PER_DAY) {
      return `${d}: Maximum ${MAX_SHIFTS_PER_DAY} shifts allowed per day.`;
    }

    const shifts = normalizeDayShifts(day);
    if (!shifts.length) {
      return `${d}: Add at least one shift or mark the day as closed.`;
    }

    for (let i = 0; i < shifts.length; i++) {
      const s = shifts[i];
      if (s.close <= s.open) {
        return `${d} Shift ${i + 1}: Closing time must be after opening time.`;
      }
    }

    // Check for overlapping shifts
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length; j++) {
        const a = shifts[i];
        const b = shifts[j];
        if (a.open < b.close && b.open < a.close) {
          return `${d}: This time slot overlaps with another shift. Please select a different time (Shift ${i + 1} and Shift ${j + 1}).`;
        }
      }
    }
  }

  return "";
};

/**
 * Given a shop, a booking date string (YYYY-MM-DD) and a chosen time (HH:MM),
 * returns an object with:
 *   - isInsideShift: boolean – true if the time falls within any shift on that day
 *   - shifts: the shifts array for that day
 *   - dayIsClosed: true if the day is marked closed
 *   - closestBefore: { time: "HH:MM", label } – last valid close before chosen time (end of preceding shift)
 *   - closestAfter:  { time: "HH:MM", label } – open of the next shift that starts after chosen time
 *   - tomorrow: { date: "YYYY-MM-DD", time, label, dayName } – first shift open of next open day
 *   - prevDay:  { date: "YYYY-MM-DD", time, label, dayName } – last open day before dateStr that is >= today
 */
export const getTimeSlotSuggestions = (shop, dateStr, chosenTime) => {
  if (!shop || !dateStr || !chosenTime) return null;

  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDate = new Date(y, m - 1, d);
  const weekday = JS_DAY[jsDate.getDay()];
  const sched = scheduleOf(shop);
  const dayObj = sched[weekday];

  if (!dayObj || dayObj.closed) {
    return { isInsideShift: false, dayIsClosed: true, shifts: [], closestBefore: null, closestAfter: null, tomorrow: _nextOpenDay(sched, dateStr), prevDay: _prevOpenDay(sched, dateStr) };
  }

  const shifts = normalizeDayShifts(dayObj).sort((a, b) => a.open.localeCompare(b.open));
  const isInsideShift = shifts.some((s) => chosenTime >= s.open && chosenTime < s.close);

  if (isInsideShift) return { isInsideShift: true, shifts, dayIsClosed: false, closestBefore: null, closestAfter: null, tomorrow: null, prevDay: null };

  // Find the latest shift that closes before or at chosenTime
  let closestBefore = null;
  for (const s of shifts) {
    if (s.close <= chosenTime) {
      closestBefore = { time: s.close, label: _fmt(s.close) + " (end of shift)" };
    }
  }

  // Find the earliest shift that opens after chosenTime
  let closestAfter = null;
  for (const s of shifts) {
    if (s.open > chosenTime) {
      closestAfter = { time: s.open, label: _fmt(s.open) + " (next shift)" };
      break;
    }
  }

  // If no "after" today (all shifts done), suggest first shift open
  if (!closestAfter && shifts.length > 0) {
    closestAfter = { time: shifts[0].open, label: _fmt(shifts[0].open) + " (first shift)" };
  }

  const tomorrow = _nextOpenDay(sched, dateStr);
  const prevDay = _prevOpenDay(sched, dateStr);

  return { isInsideShift: false, dayIsClosed: false, shifts, closestBefore, closestAfter, tomorrow, prevDay };
};

// Format HH:MM to human-readable 12h string
const _fmt = (time) => {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
};

// Get the first open shift of the next open day after dateStr
const _nextOpenDay = (sched, dateStr) => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  for (let i = 1; i <= 7; i++) {
    const next = new Date(y, m - 1, d + i);
    const wd = JS_DAY[next.getDay()];
    const day = sched[wd];
    if (!day || day.closed) continue;
    const shifts = normalizeDayShifts(day).sort((a, b) => a.open.localeCompare(b.open));
    if (!shifts.length) continue;
    const nextStr = toLocalDateString(next);
    return { date: nextStr, time: shifts[0].open, label: _fmt(shifts[0].open), dayName: wd };
  }
  return null;
};

// Get the last open day BEFORE dateStr that is still >= today (not in the past)
// Returns the last shift's open time so the customer can book a fresh slot that day.
const _prevOpenDay = (sched, dateStr) => {
  if (!dateStr) return null;
  const today = toLocalDateString();
  const [y, m, d] = dateStr.split("-").map(Number);
  for (let i = 1; i <= 7; i++) {
    const prev = new Date(y, m - 1, d - i);
    const prevStr = toLocalDateString(prev);
    // Don't suggest dates in the past
    if (prevStr < today) return null;
    const wd = JS_DAY[prev.getDay()];
    const day = sched[wd];
    if (!day || day.closed) continue;
    const shifts = normalizeDayShifts(day).sort((a, b) => a.open.localeCompare(b.open));
    if (!shifts.length) continue;
    // Suggest the first shift of that day (earliest available slot)
    return { date: prevStr, time: shifts[0].open, label: _fmt(shifts[0].open), dayName: wd };
  }
  return null;
};

export const todayHoursText = (shop, date = new Date()) => {
  const annual = annualScheduleForDate(shop, date);
  if (annual?.type === "closed") {
    return annual.note ? `Closed: ${annual.note}` : "Closed";
  }
  if (annual && ["half_day", "special_hours"].includes(annual.type)) {
    const label = annual.type === "half_day" ? "Half day" : "Special hours";
    return `${label}: ${formatShiftDisplay(annual)}${annual.note ? ` (${annual.note})` : ""}`;
  }
  const d = JS_DAY[date.getDay()];
  const e = scheduleOf(shop)[d];
  if (e.closed) return `${d}: Closed`;
  const shifts = normalizeDayShifts(e);
  return `${d}: ${shifts.map(formatShiftDisplay).join(", ")}`;
};
