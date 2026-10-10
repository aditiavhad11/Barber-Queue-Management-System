import { to12Hour } from "./time.js";

export const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// availability.days is the list of OPEN days. A day missing from the list is a "Close Shop" day.
// Shops saved before this option existed have no list, so they stay open every day.
export const toLocalDateString = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

export const isShopOpenNow = (shop, date = new Date()) => {
  if (getTemporaryClosure(shop, date).isClosed) return false;
  const openFlag =
    shop?.availability?.isOpen !== undefined
      ? shop.availability.isOpen
      : shop?.open !== undefined
        ? shop.open
        : shop?.isOpen !== undefined
          ? shop.isOpen
          : true;
  if (!Boolean(openFlag) || isClosedToday(shop, date)) return false;

  const d = JS_DAY[date.getDay()];
  const sched = scheduleOf(shop)[d];
  if (!sched || sched.closed) return false;

  const currentH = String(date.getHours()).padStart(2, "0");
  const currentM = String(date.getMinutes()).padStart(2, "0");
  const now = `${currentH}:${currentM}`;

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
          return `${d}: Shift ${i + 1} (${a.open}-${a.close}) and Shift ${j + 1} (${b.open}-${b.close}) overlap.`;
        }
      }
    }
  }

  return "";
};

export const todayHoursText = (shop, date = new Date()) => {
  const d = JS_DAY[date.getDay()];
  const e = scheduleOf(shop)[d];
  if (e.closed) return `${d}: Closed`;
  const shifts = normalizeDayShifts(e);
  return `${d}: ${shifts.map(formatShiftDisplay).join(", ")}`;
};
