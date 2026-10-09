import { ALL_DAYS } from "../../utils/closedDays";
import { to12Hour, from12Hour } from "../../utils/time";

// One row per weekday: opening time, closing time and a Close Shop toggle.
// "Apply Monday timing to all" copies Monday's opening/closing to every other day.
export default function WeeklyHours({ schedule, onChange, error }) {
  const setDay = (d, patch) =>
    onChange({ ...schedule, [d]: { ...schedule[d], ...patch } });
  const setTime = (d, key, time, period) =>
    setDay(d, { [key]: from12Hour(time, period) });
  const applyMonday = () =>
    onChange(
      Object.fromEntries(
        ALL_DAYS.map((d) => [
          d,
          {
            ...schedule[d],
            open: schedule.Mon.open,
            close: schedule.Mon.close,
            closed: schedule.Mon.closed,
          },
        ]),
      ),
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label">Opening hours for each day</p>
        <button type="button" className="btn-ghost" onClick={applyMonday}>
          Apply Monday timing to all days
        </button>
      </div>
      {ALL_DAYS.map((d) => {
        const o = to12Hour(schedule[d].open);
        const c = to12Hour(schedule[d].close);
        const closed = schedule[d].closed;
        return (
          <div
            key={d}
            className="grid grid-cols-[56px_1fr_1fr_auto] md:grid-cols-[56px_1fr_80px_1fr_80px_auto] gap-2 items-end"
          >
            <span className="text-sm pb-3">{d}</span>
            <label className="text-sm">
              Opens
              <input
                type="time"
                disabled={closed}
                className="input"
                value={o.time}
                onChange={(e) => setTime(d, "open", e.target.value, o.period)}
              />
            </label>
            <label className="text-sm">
              &nbsp;
              <select
                disabled={closed}
                className="input"
                value={o.period}
                onChange={(e) => setTime(d, "open", o.time, e.target.value)}
              >
                <option>AM</option>
                <option>PM</option>
              </select>
            </label>
            <label className="text-sm">
              Closes
              <input
                type="time"
                disabled={closed}
                className="input"
                value={c.time}
                onChange={(e) => setTime(d, "close", e.target.value, c.period)}
              />
            </label>
            <label className="text-sm">
              &nbsp;
              <select
                disabled={closed}
                className="input"
                value={c.period}
                onChange={(e) => setTime(d, "close", c.time, e.target.value)}
              >
                <option>AM</option>
                <option>PM</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setDay(d, { closed: !closed })}
              className={`px-3 py-3 text-xs border ${closed ? "border-khaki" : "border-coffee bg-olive text-cream"}`}
            >
              {closed ? "Closed" : "Open"}
            </button>
          </div>
        );
      })}
      {error && <p className="text-sm text-rose">{error}</p>}
    </div>
  );
}
