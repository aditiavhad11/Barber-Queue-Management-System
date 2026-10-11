import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  annualSchedulesOf,
  formatDateDisplay,
  toLocalDateString,
} from "../../utils/closedDays";

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => toLocalDateString(new Date());
const typeLabel = {
  closed: "Closed",
  half_day: "Half Day",
  special_hours: "Special Hours",
};

export default function AnnualSchedule({ shop, shops = [], onSave }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState([]);
  const [kind, setKind] = useState("closed");
  const [open, setOpen] = useState("09:00");
  const [close, setClose] = useState("14:00");
  const [note, setNote] = useState("");
  const [applyMode, setApplyMode] = useState("current");
  const [targetIds, setTargetIds] = useState([]);
  const [message, setMessage] = useState("");
  const schedules = annualSchedulesOf(shop);
  const [today] = useState(todayKey);
  const otherShops = shops.filter((s) => s.ownerId === shop.ownerId && s.id !== shop.id);
  const grid = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    return [
      ...Array.from({ length: first }, () => null),
      ...Array.from({ length: days }, (_, i) => dateKey(y, m, i + 1)),
    ];
  }, [month]);
  const affectedIds =
    applyMode === "all"
      ? otherShops.map((s) => s.id)
      : applyMode === "custom"
        ? targetIds
        : [];
  const toggle = (key) => {
    if (!key || key < today) return;
    setSelected((p) =>
      p.includes(key) ? p.filter((x) => x !== key) : [...p, key].sort(),
    );
    setMessage("");
  };
  const apply = () => {
    if (!selected.length) return setMessage("Select at least one future date.");
    if (kind !== "closed" && close <= open)
      return setMessage("Closing time must be after opening time.");
    const entry = {
      type: kind,
      open,
      close,
      note: note.trim(),
    };
    const ids = [shop.id, ...affectedIds];
    ids.forEach((id) => onSave(id, selected, entry));
    setMessage(
      `${selected.length} date${selected.length === 1 ? "" : "s"} updated for ${ids.length} shop${ids.length === 1 ? "" : "s"}.`,
    );
    setSelected([]);
  };
  const remove = (date) => {
    if (date < today) return;
    onSave(shop.id, [date], null);
    setMessage(`${formatDateDisplay(date, true)} schedule removed.`);
  };

  return (
    <div className="border border-khaki rounded-md p-4 mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label flex items-center gap-2">
            <CalendarDays size={15} />
            Annual calendar
          </p>
          <h3 className="text-2xl">
            {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </h3>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn-ghost" type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mt-4 text-center text-xs label">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 mt-2">
        {grid.map((key, i) => {
          const item = key ? schedules[key] : null;
          const past = key && key < today;
          const picked = selected.includes(key);
          return (
            <button
              key={key || `blank-${i}`}
              type="button"
              disabled={!key || past}
              onClick={() => toggle(key)}
              title={item?.note || typeLabel[item?.type] || ""}
              className={`min-h-20 border rounded-md p-1 text-left text-xs ${picked ? "border-brass bg-brass/15" : "border-khaki"} ${past ? "opacity-40" : "hover:bg-ivory/10"}`}
            >
              {key && (
                <>
                  <span className="font-semibold">{Number(key.slice(-2))}</span>
                  {item && (
                    <span className="block mt-1 text-[11px]">
                      {typeLabel[item.type]}
                      {item.type !== "closed" ? ` ${item.open}-${item.close}` : ""}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="grid md:grid-cols-5 gap-3 mt-4">
        <label className="block text-sm md:col-span-2">
          Schedule type
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="closed">Closed</option>
            <option value="half_day">Half Day</option>
            <option value="special_hours">Special Hours</option>
          </select>
        </label>
        <label className="block text-sm">
          Open
          <input className="input" type="time" value={open} disabled={kind === "closed"} onChange={(e) => setOpen(e.target.value)} />
        </label>
        <label className="block text-sm">
          Close
          <input className="input" type="time" value={close} disabled={kind === "closed"} onChange={(e) => setClose(e.target.value)} />
        </label>
        <label className="block text-sm md:col-span-5">
          Reason or note
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {otherShops.length > 0 && (
        <div className="mt-4 border-t border-khaki pt-4">
          <label className="block text-sm">
            Apply to other shops
            <select className="input" value={applyMode} onChange={(e) => setApplyMode(e.target.value)}>
              <option value="current">Only {shop.name}</option>
              <option value="all">All other shops</option>
              <option value="custom">Choose shops</option>
            </select>
          </label>
          {applyMode === "custom" && (
            <div className="flex flex-wrap gap-3 mt-3">
              {otherShops.map((s) => (
                <label key={s.id} className="text-sm flex items-center gap-2">
                  <input type="checkbox" checked={targetIds.includes(s.id)} onChange={(e) => setTargetIds((p) => e.target.checked ? [...p, s.id] : p.filter((id) => id !== s.id))} />
                  {s.name}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-coffee/60 mt-2">
            Affected shops: {[shop, ...otherShops.filter((s) => affectedIds.includes(s.id))].map((s) => s.name).join(", ")}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3 mt-4">
        <button className="btn" type="button" onClick={apply}>
          Save selected dates
        </button>
        <button className="btn-ghost" type="button" onClick={() => setSelected([])}>
          Clear selection
        </button>
      </div>
      {message && <p className="text-sm mt-3">{message}</p>}
      <div className="mt-5 space-y-2">
        {Object.entries(schedules)
          .filter(([date]) => date >= today)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, 12)
          .map(([date, item]) => (
            <div key={date} className="flex flex-wrap items-center justify-between gap-2 border-t border-khaki pt-2 text-sm">
              <span>
                {formatDateDisplay(date, true)}: {typeLabel[item.type]}
                {item.type !== "closed" ? ` ${item.open}-${item.close}` : ""}
                {item.note ? ` - ${item.note}` : ""}
              </span>
              <button className="btn-ghost text-rose" type="button" onClick={() => remove(date)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
