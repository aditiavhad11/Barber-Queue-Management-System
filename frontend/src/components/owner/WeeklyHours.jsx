import {
  ALL_DAYS,
  MAX_SHIFTS_PER_DAY,
  normalizeDayShifts,
} from "../../utils/closedDays";
import { to12Hour, from12Hour } from "../../utils/time";
import { Plus, Trash2, Clock } from "lucide-react";

export default function WeeklyHours({ schedule, onChange, error }) {
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
  };

  const removeShift = (d, index) => {
    const current = getShifts(d);
    if (current.length <= 1) return;
    const filtered = current.filter((_, idx) => idx !== index);
    setDayShifts(d, filtered);
  };

  const toggleDay = (d) => {
    const isClosed = !schedule[d]?.closed;
    onChange({
      ...schedule,
      [d]: {
        ...schedule[d],
        closed: isClosed,
      },
    });
  };

  const applyMonday = () => {
    const mon = schedule.Mon || {};
    const monShifts = getShifts("Mon");
    onChange(
      Object.fromEntries(
        ALL_DAYS.map((d) => [
          d,
          {
            ...schedule[d],
            shifts: JSON.parse(JSON.stringify(monShifts)),
            open: mon.open || monShifts[0]?.open || "09:00",
            close:
              mon.close ||
              monShifts[monShifts.length - 1]?.close ||
              "21:00",
            closed: Boolean(mon.closed),
          },
        ]),
      ),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">Opening hours & shifts</p>
          <p className="text-xs text-coffee/70">
            Set custom shifts for each day (up to {MAX_SHIFTS_PER_DAY} shifts). Tap Open/Closed to toggle a day.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost !text-xs !py-1.5"
          onClick={applyMonday}
        >
          Apply Monday timing to all days
        </button>
      </div>

      <div className="space-y-3">
        {ALL_DAYS.map((d) => {
          const shifts = getShifts(d);
          const closed = Boolean(schedule[d]?.closed);

          return (
            <div
              key={d}
              className={`border rounded-lg p-3.5 transition-colors ${
                closed
                  ? "border-khaki/60 bg-khaki/10 opacity-75"
                  : "border-khaki bg-card/40"
              }`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-khaki/40 gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm w-10">{d}</span>
                  {!closed && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-khaki/40 text-coffee/80 font-medium">
                      {shifts.length}{" "}
                      {shifts.length === 1 ? "shift" : "shifts"}
                    </span>
                  )}
                  {closed && (
                    <span className="text-xs text-rose font-medium">
                      Closed all day
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {!closed && shifts.length < MAX_SHIFTS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => addShift(d)}
                      className="text-xs px-2.5 py-1 rounded border border-khaki hover:border-coffee flex items-center gap-1 bg-cream/30 text-coffee"
                      title="Add another shift for this day (up to 6)"
                    >
                      <Plus size={13} />
                      <span>Add shift</span>
                    </button>
                  )}
                  {!closed && shifts.length >= MAX_SHIFTS_PER_DAY && (
                    <span className="text-[11px] text-coffee/60 px-1">
                      Max {MAX_SHIFTS_PER_DAY} shifts
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`px-3 py-1 text-xs border rounded transition-colors ${
                      closed
                        ? "border-khaki text-coffee/70 bg-cream/50"
                        : "border-coffee bg-olive text-cream font-medium"
                    }`}
                  >
                    {closed ? "Closed" : "Open"}
                  </button>
                </div>
              </div>

              {!closed && (
                <div className="space-y-2.5 pt-2.5">
                  {shifts.map((s, idx) => {
                    const o = to12Hour(s.open);
                    const c = to12Hour(s.close);

                    return (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center gap-2 p-2 rounded bg-cream/20 border border-khaki/30"
                      >
                        <span className="text-xs font-medium text-coffee/80 min-w-[50px] flex items-center gap-1">
                          <Clock size={12} className="text-coffee/60" />
                          Shift {idx + 1}
                        </span>

                        <div className="flex items-center gap-1.5 flex-1 min-w-[240px]">
                          <label className="text-xs flex items-center gap-1">
                            <span className="text-coffee/70">From:</span>
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
                                  o.period,
                                )
                              }
                            />
                            <select
                              disabled={closed}
                              className="input !py-1 !px-1.5 text-xs"
                              value={o.period}
                              onChange={(e) =>
                                updateShiftTime(
                                  d,
                                  idx,
                                  "open",
                                  o.time,
                                  e.target.value,
                                )
                              }
                            >
                              <option>AM</option>
                              <option>PM</option>
                            </select>
                          </label>

                          <span className="text-coffee/40 text-xs px-1">→</span>

                          <label className="text-xs flex items-center gap-1">
                            <span className="text-coffee/70">To:</span>
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
                                  c.period,
                                )
                              }
                            />
                            <select
                              disabled={closed}
                              className="input !py-1 !px-1.5 text-xs"
                              value={c.period}
                              onChange={(e) =>
                                updateShiftTime(
                                  d,
                                  idx,
                                  "close",
                                  c.time,
                                  e.target.value,
                                )
                              }
                            >
                              <option>AM</option>
                              <option>PM</option>
                            </select>
                          </label>
                        </div>

                        {shifts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeShift(d, idx)}
                            className="p-1.5 text-rose/70 hover:text-rose hover:bg-rose/10 rounded transition-colors"
                            title={`Remove Shift ${idx + 1}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-3 rounded bg-rose/10 border border-rose/30 text-rose text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
