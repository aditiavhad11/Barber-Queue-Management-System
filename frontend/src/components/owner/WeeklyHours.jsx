import { useState, useRef } from "react";
import {
  ALL_DAYS,
  MAX_SHIFTS_PER_DAY,
  normalizeDayShifts,
} from "../../utils/closedDays";
import { to12Hour, from12Hour } from "../../utils/time";
import {
  Plus,
  Minus,
  Trash2,
  Clock,
  Copy,
  Check,
  AlertCircle,
  Calendar,
  Sparkles,
  Undo2,
  RotateCcw,
} from "lucide-react";

export default function WeeklyHours({ schedule, onChange, error }) {
  // Determine initially visible days:
  // If schedule already has days other than Monday open (e.g. revisiting existing shop), display all configured days.
  // Otherwise, start initially with Monday.
  const [visibleDays, setVisibleDays] = useState(() => {
    const hasOtherConfiguredDays = ALL_DAYS.some(
      (d) => d !== "Mon" && schedule?.[d] && !schedule[d]?.closed
    );
    return hasOtherConfiguredDays ? [...ALL_DAYS] : ["Mon"];
  });

  const [mondayTimingAdded, setMondayTimingAdded] = useState(() => {
    const mon = schedule?.Mon;
    const hasOtherOpenDays = ALL_DAYS.some(
      (d) => d !== "Mon" && schedule?.[d] && !schedule[d]?.closed
    );
    return Boolean(
      hasOtherOpenDays || (mon && !mon.closed && mon.shifts?.length > 0)
    );
  });

  // History stack for full flexibility to go back to previous state
  const [history, setHistory] = useState([]);
  const [notification, setNotification] = useState("");

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 3500);
  };

  // Push current state to history before making a state modification
  const pushHistory = () => {
    setHistory((prev) => [
      ...prev.slice(-10), // keep last 10 states
      {
        schedule: JSON.parse(JSON.stringify(schedule)),
        visibleDays: [...visibleDays],
        mondayTimingAdded,
      },
    ]);
  };

  // Revert back to the previous state
  const handleUndo = () => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    onChange(previous.schedule);
    setVisibleDays(previous.visibleDays);
    setMondayTimingAdded(previous.mondayTimingAdded);
    showNotification("Reverted to previous state.");
  };

  const getShifts = (d) => normalizeDayShifts(schedule[d]);

  const setDayShifts = (d, nextShifts, patch = {}) => {
    const limited = nextShifts.slice(0, MAX_SHIFTS_PER_DAY);
    const earliest = limited[0]?.open || "09:00";
    const latest = limited[limited.length - 1]?.close || "21:00";
    onChange({
      ...schedule,
      [d]: {
        ...schedule[d],
        shifts: limited,
        open: earliest,
        close: latest,
        ...patch,
      },
    });
  };

  const updateShiftTime = (d, index, key, timeVal, periodVal) => {
    pushHistory();
    const current = getShifts(d);
    const updated = current.map((s, idx) => {
      if (idx !== index) return s;
      return {
        ...s,
        [key]: from12Hour(timeVal, periodVal),
      };
    });
    setDayShifts(d, updated);
  };

  const addShift = (d) => {
    pushHistory();
    const current = getShifts(d);
    if (current.length >= MAX_SHIFTS_PER_DAY) return;

    const last = current[current.length - 1];
    let nextOpen = "16:00";
    let nextClose = "21:00";

    if (last && last.close < "21:00") {
      const [h, m] = last.close.split(":").map(Number);
      const startH = Math.min(h + 1, 22);
      const endH = Math.min(startH + 4, 23);
      nextOpen = `${String(startH).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
      nextClose = `${String(endH).padStart(2, "0")}:00`;
    }

    setDayShifts(d, [...current, { open: nextOpen, close: nextClose }]);
    showNotification(`Shift added for ${d}. Click Undo or Remove Shift to revert.`);
  };

  const removeShift = (d, index) => {
    pushHistory();
    const current = getShifts(d);
    if (current.length <= 1) return;
    const filtered = current.filter((_, idx) => idx !== index);
    setDayShifts(d, filtered);
    showNotification(`Removed shift from ${d}. Click Undo to restore.`);
  };

  // Toggle day open / Weekly Off
  const toggleWeeklyOff = (d) => {
    pushHistory();
    const isNowClosed = !schedule[d]?.closed;
    onChange({
      ...schedule,
      [d]: {
        ...schedule[d],
        closed: isNowClosed,
      },
    });
    showNotification(
      isNowClosed
        ? `${d} set to Weekly Off. Click Open Day or Undo to restore.`
        : `${d} marked as Open.`
    );
  };

  // Remove a day from the visible list and reset to closed
  const removeDay = (d) => {
    if (d === "Mon") {
      toggleWeeklyOff("Mon");
      return;
    }
    pushHistory();
    onChange({
      ...schedule,
      [d]: {
        ...schedule[d],
        closed: true,
      },
    });
    setVisibleDays((prev) => prev.filter((item) => item !== d));
    showNotification(`Removed ${d}. Click Undo to restore.`);
  };

  // Step 1: Add Monday's Timing button handler
  const handleAddMondayTiming = () => {
    pushHistory();
    const mon = schedule.Mon || {};
    const shifts = getShifts("Mon");
    const updatedShifts =
      shifts.length > 0 ? shifts : [{ open: "09:00", close: "21:00" }];

    onChange({
      ...schedule,
      Mon: {
        ...mon,
        closed: false,
        shifts: updatedShifts,
        open: updatedShifts[0].open,
        close: updatedShifts[updatedShifts.length - 1].close,
      },
    });
    setMondayTimingAdded(true);
    showNotification("Monday's timing configured successfully.");
  };

  // Step 2: Use Same Timing for Remaining Days
  const applyMondayToRemainingDays = () => {
    pushHistory();
    const mon = schedule.Mon || {};
    const monShiftsCopy = getShifts("Mon");
    const next = { ...schedule };

    for (const d of ALL_DAYS) {
      if (d !== "Mon") {
        next[d] = {
          ...schedule[d],
          shifts: JSON.parse(JSON.stringify(monShiftsCopy)),
          open: mon.open || monShiftsCopy[0]?.open || "09:00",
          close:
            mon.close ||
            monShiftsCopy[monShiftsCopy.length - 1]?.close ||
            "21:00",
          closed: false,
        };
      }
    }

    onChange(next);
    setVisibleDays([...ALL_DAYS]);
    setMondayTimingAdded(true);
    showNotification(
      "Monday's timings applied to all remaining days."
    );
  };

  // Step 3: Add next day's timing manually
  const remainingDays = ALL_DAYS.filter((d) => !visibleDays.includes(d));
  const nextDayToAdd = remainingDays[0];

  const handleAddNextDay = () => {
    if (!nextDayToAdd) return;
    pushHistory();
    const monShifts = getShifts("Mon");
    const defaultShifts =
      monShifts.length > 0
        ? JSON.parse(JSON.stringify(monShifts))
        : [{ open: "09:00", close: "21:00" }];

    onChange({
      ...schedule,
      [nextDayToAdd]: {
        ...schedule[nextDayToAdd],
        closed: false,
        shifts: schedule[nextDayToAdd]?.shifts?.length
          ? schedule[nextDayToAdd].shifts
          : defaultShifts,
        open: schedule[nextDayToAdd]?.open || defaultShifts[0].open,
        close:
          schedule[nextDayToAdd]?.close ||
          defaultShifts[defaultShifts.length - 1].close,
      },
    });
    setVisibleDays((prev) => [...prev, nextDayToAdd]);
    showNotification(`Added ${nextDayToAdd}'s timing. Click Remove or Undo to revert.`);
  };

  // Check if Monday has valid times entered
  const monShifts = getShifts("Mon");
  const monHasValidTiming =
    !schedule["Mon"]?.closed &&
    monShifts.length > 0 &&
    monShifts.every((s) => s.open && s.close && s.close > s.open);

  const showApplyToAllButton =
    (mondayTimingAdded || monHasValidTiming) && remainingDays.length > 0;

  return (
    <div className="space-y-4">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-khaki/30">
        <div>
          <p className="label flex items-center gap-1.5 text-base">
            <Calendar size={18} className="text-gold" />
            Weekly Opening Hours &amp; Shifts
          </p>
          <p className="text-xs text-coffee/70">
            Configure flexible opening hours for all seven days. You can apply
            Monday&apos;s timing to all days, add/remove days, or revert changes anytime.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Undo / Back Sign Button */}
          {history.length > 0 && (
            <button
              type="button"
              className="p-1.5 rounded-lg border border-khaki/80 text-coffee bg-card/60 transition-all duration-200 hover:opacity-75 hover:bg-cream/50 active:scale-95 flex items-center justify-center shadow-xs"
              onClick={handleUndo}
              title="Undo previous action"
              aria-label="Undo"
            >
              <Undo2 size={16} className="text-gold" />
            </button>
          )}




        </div>
      </div>

      {notification && (
        <div className="p-2.5 rounded-lg bg-olive/10 border border-olive/30 text-olive text-xs flex items-center justify-between gap-2 transition-all">
          <div className="flex items-center gap-2">
            <Check size={14} />
            <span>{notification}</span>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              className="underline font-semibold hover:text-olive/80 flex items-center gap-1"
            >
              <Undo2 size={12} /> Undo
            </button>
          )}
        </div>
      )}

      {/* Days List */}
      <div className="space-y-3">
        {visibleDays.map((d) => {
          const shifts = getShifts(d);
          const closed = Boolean(schedule[d]?.closed);
          const isMonday = d === "Mon";

          return (
            <div
              key={d}
              className={`border rounded-xl p-3.5 transition-all ${
                closed
                  ? "border-khaki/50 bg-khaki/10 opacity-80"
                  : isMonday
                    ? "border-gold/60 bg-gold/5 shadow-sm"
                    : "border-khaki/70 bg-card/40"
              }`}
            >
              {/* Day Header Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-khaki/30">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`font-bold text-sm tracking-wide ${
                      isMonday ? "text-gold" : "text-coffee"
                    }`}
                  >
                    {d}
                    {isMonday && (
                      <span className="ml-1.5 text-[10px] font-normal px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">
                        Primary Day
                      </span>
                    )}
                  </span>

                  {!closed ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-olive/15 text-olive font-medium border border-olive/20">
                      Open &bull; {shifts.length}{" "}
                      {shifts.length === 1 ? "shift" : "shifts"}
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose/15 text-rose font-semibold border border-rose/30">
                      Weekly Off / Closed
                    </span>
                  )}
                </div>

                {/* Day Action Buttons */}
                <div className="flex items-center gap-2">
                  {/* Step 1: Add Monday's Timing Button */}
                  {isMonday && !mondayTimingAdded && !closed && (
                    <button
                      type="button"
                      onClick={handleAddMondayTiming}
                      className="text-xs px-2.5 py-1 rounded bg-gold text-cream font-medium hover:bg-gold/90 transition-colors flex items-center gap-1 shadow-sm"
                      title="Set and confirm Monday's opening hours"
                    >
                      <Sparkles size={13} />
                      Add Monday&apos;s Timing
                    </button>
                  )}

                  {!closed && shifts.length < MAX_SHIFTS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => addShift(d)}
                      className="text-xs px-2.5 py-1 rounded border border-khaki hover:border-coffee flex items-center gap-1 bg-cream/40 text-coffee transition-colors"
                      title={`Add another shift for ${d} (up to ${MAX_SHIFTS_PER_DAY})`}
                    >
                      <Plus size={13} />
                      <span>Add shift</span>
                    </button>
                  )}

                  {/* Toggle Weekly Off / Open Day */}
                  <button
                    type="button"
                    onClick={() => toggleWeeklyOff(d)}
                    className={`px-2.5 py-1 text-xs border rounded-lg transition-colors flex items-center gap-1 font-medium ${
                      closed
                        ? "border-olive/50 bg-olive text-cream hover:bg-olive/90"
                        : "border-rose/40 bg-rose/10 text-rose hover:bg-rose/20"
                    }`}
                    title={
                      closed
                        ? `Restore ${d} to Open state`
                        : `Mark ${d} as Weekly Off / Closed`
                    }
                  >
                    {closed ? (
                      <>
                        <Plus size={13} />
                        <span>Open Day</span>
                      </>
                    ) : (
                      <>
                        <Minus size={13} />
                        <span>Weekly Off</span>
                      </>
                    )}
                  </button>

                  {/* Remove Day Button (for Tue-Sun) to go back to previous state */}
                  {!isMonday && (
                    <button
                      type="button"
                      onClick={() => removeDay(d)}
                      className="p-1.5 text-rose/70 hover:text-rose hover:bg-rose/10 rounded-lg border border-khaki/40 transition-colors"
                      title={`Remove ${d} and revert to previous state`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Shifts Body */}
              {!closed ? (
                <div className="space-y-2.5 pt-3">
                  {shifts.map((s, idx) => {
                    const o = to12Hour(s.open);
                    const c = to12Hour(s.close);

                    // Overlap validation
                    const hasOverlap = shifts.some((other, otherIdx) => {
                      if (otherIdx === idx) return false;
                      return s.open < other.close && other.open < s.close;
                    });

                    // Invalid range validation
                    const isInvalidRange = s.close <= s.open;

                    return (
                      <div
                        key={idx}
                        className={`flex flex-col sm:flex-row sm:items-center gap-2.5 p-2.5 rounded-lg border transition-colors ${
                          hasOverlap || isInvalidRange
                            ? "bg-rose/10 border-rose/40"
                            : "bg-cream/25 border-khaki/30"
                        }`}
                      >
                        <div className="flex items-center justify-between sm:justify-start gap-2 min-w-[75px]">
                          <span className="text-xs font-semibold text-coffee/80 flex items-center gap-1">
                            <Clock size={12} className="text-coffee/60" />
                            Shift {idx + 1}
                          </span>

                          {shifts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeShift(d, idx)}
                              className="sm:hidden p-1 text-rose/70 hover:text-rose hover:bg-rose/10 rounded"
                              title={`Remove Shift ${idx + 1} and go back`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Timing Controls with Segmented AM/PM Buttons (No Merged Dropdown Arrows!) */}
                        <div className="flex flex-wrap items-center gap-2.5 flex-1">
                          {/* FROM TIME */}
                          <div className="text-xs flex items-center gap-1.5">
                            <span className="text-coffee/70 font-medium">From:</span>
                            <input
                              type="time"
                              disabled={closed}
                              className="input !py-1 !px-2 text-xs"
                              value={o.time}
                              onChange={(e) =>
                                updateShiftTime(
                                  d,
                                  idx,
                                  "open",
                                  e.target.value,
                                  o.period
                                )
                              }
                            />
                            {/* Segmented AM/PM Button Group */}
                            <div className="inline-flex items-center rounded-md border border-khaki/60 p-0.5 bg-cream/50 shadow-xs">
                              <button
                                type="button"
                                disabled={closed}
                                onClick={() =>
                                  updateShiftTime(d, idx, "open", o.time, "AM")
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                                  o.period === "AM"
                                    ? "bg-olive text-cream shadow-xs"
                                    : "text-coffee/60 hover:text-coffee hover:bg-cream/80"
                                }`}
                                title="Set to AM"
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                disabled={closed}
                                onClick={() =>
                                  updateShiftTime(d, idx, "open", o.time, "PM")
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                                  o.period === "PM"
                                    ? "bg-olive text-cream shadow-xs"
                                    : "text-coffee/60 hover:text-coffee hover:bg-cream/80"
                                }`}
                                title="Set to PM"
                              >
                                PM
                              </button>
                            </div>
                          </div>

                          <span className="text-coffee/40 text-xs hidden sm:inline">&rarr;</span>

                          {/* TO TIME */}
                          <div className="text-xs flex items-center gap-1.5">
                            <span className="text-coffee/70 font-medium">To:</span>
                            <input
                              type="time"
                              disabled={closed}
                              className="input !py-1 !px-2 text-xs"
                              value={c.time}
                              onChange={(e) =>
                                updateShiftTime(
                                  d,
                                  idx,
                                  "close",
                                  e.target.value,
                                  c.period
                                )
                              }
                            />
                            {/* Segmented AM/PM Button Group */}
                            <div className="inline-flex items-center rounded-md border border-khaki/60 p-0.5 bg-cream/50 shadow-xs">
                              <button
                                type="button"
                                disabled={closed}
                                onClick={() =>
                                  updateShiftTime(d, idx, "close", c.time, "AM")
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                                  c.period === "AM"
                                    ? "bg-olive text-cream shadow-xs"
                                    : "text-coffee/60 hover:text-coffee hover:bg-cream/80"
                                }`}
                                title="Set to AM"
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                disabled={closed}
                                onClick={() =>
                                  updateShiftTime(d, idx, "close", c.time, "PM")
                                }
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                                  c.period === "PM"
                                    ? "bg-olive text-cream shadow-xs"
                                    : "text-coffee/60 hover:text-coffee hover:bg-cream/80"
                                }`}
                                title="Set to PM"
                              >
                                PM
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Shift Overlap or Invalid Range Alert */}
                        {hasOverlap && (
                          <div className="w-full sm:w-auto text-[11px] text-rose font-medium flex items-center gap-1">
                            <AlertCircle size={13} className="shrink-0" />
                            <span>This time slot overlaps with another shift. Please select a different time.</span>
                          </div>
                        )}

                        {isInvalidRange && !hasOverlap && (
                          <div className="w-full sm:w-auto text-[11px] text-rose font-medium flex items-center gap-1">
                            <AlertCircle size={13} className="shrink-0" />
                            <span>Closing time must be after opening time.</span>
                          </div>
                        )}

                        {shifts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeShift(d, idx)}
                            className="hidden sm:inline-flex p-1.5 text-rose/70 hover:text-rose hover:bg-rose/10 rounded transition-colors"
                            title={`Remove Shift ${idx + 1} and go back to previous count`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="pt-2 text-xs text-coffee/60 italic flex items-center justify-between">
                  <span>
                    Shop is marked as Weekly Off on this day.
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleWeeklyOff(d)}
                    className="text-xs text-olive font-semibold hover:underline"
                  >
                    Click to Open &rarr;
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Manual Day Addition Area if days remain unadded */}
      {remainingDays.length > 0 && (
        <div className="p-3 rounded-xl border border-dashed border-khaki/80 bg-cream/20 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-coffee/80">
            <span className="font-semibold">{remainingDays.length}</span> days
            remaining to configure ({remainingDays.join(", ")}).
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddNextDay}
              className="btn-ghost !text-xs !py-1.5 flex items-center gap-1"
            >
              <Plus size={14} className="text-gold" />
              Add Next Day ({nextDayToAdd})
            </button>
            {monHasValidTiming && (
              <button
                type="button"
                onClick={applyMondayToRemainingDays}
                className="btn-primary !text-xs !py-1.5 flex items-center gap-1"
              >
                <Copy size={13} />
                Use Same Timing for Remaining Days
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-rose/10 border border-rose/30 text-rose text-sm flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
