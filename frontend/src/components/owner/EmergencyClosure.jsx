import { useEffect, useState } from "react";
import { Calendar, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal, StatusBadge } from "../common/ui";
import { api } from "../../services/api";
import {
  formatDateDisplay,
  getTemporaryClosure,
  toLocalDateString,
} from "../../utils/closedDays";

const localDateTime = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const displayTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "further notice";

export default function EmergencyClosure({ shop, onUpdate }) {
  const closure = getTemporaryClosure(shop);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("hours");
  const [startAt, setStartAt] = useState(localDateTime());
  const [endAt, setEndAt] = useState(localDateTime(new Date(Date.now() + 2 * 3600000)));
  const [startDate, setStartDate] = useState(toLocalDateString());
  const [endDate, setEndDate] = useState(toLocalDateString(new Date(Date.now() + 4 * 86400000)));
  const [duration, setDuration] = useState("2");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState([]);
  const affectedCount = Object.values(shop?.queues || {}).flat().filter((entry) =>
    ["Waiting", "Your Turn", "In Service", "Prebooked"].includes(entry.status),
  ).length;

  const loadHistory = async () => {
    if (!shop?.id) return;
    try {
      const response = await api.get(`/shops/${shop.id}/emergency-closures`);
      setHistory(response.data || []);
    } catch (error) {
      console.error("Could not load emergency closure history:", error);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [shop?.id]);

  const openModal = () => {
    setMode(closure.startAt ? "hours" : "days");
    setStartAt(closure.startAt ? localDateTime(new Date(closure.startAt)) : localDateTime());
    setEndAt(closure.endAt ? localDateTime(new Date(closure.endAt)) : localDateTime(new Date(Date.now() + 2 * 3600000)));
    setStartDate(closure.startDate || toLocalDateString());
    setEndDate(closure.endDate || toLocalDateString(new Date(Date.now() + 4 * 86400000)));
    setReason(closure.reason || "");
    setModalOpen(true);
  };

  const chooseDuration = (hours) => {
    setDuration(String(hours));
    setEndAt(localDateTime(new Date(new Date(startAt).getTime() + hours * 3600000)));
  };

  const handleSave = async (event) => {
    event?.preventDefault();
    const next =
      mode === "hours"
        ? {
            active: true,
            type: "hours",
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString(),
            startDate: startAt.slice(0, 10),
            endDate: endAt.slice(0, 10),
            reason: reason.trim(),
          }
        : {
            active: true,
            type: "days",
            startDate,
            endDate,
            reason: reason.trim(),
          };
    if (mode === "hours" && new Date(next.endAt) <= new Date(next.startAt)) return;
    if (mode === "days" && endDate < startDate) return;
    setSaving(true);
    try {
      const startsInFuture =
        mode === "hours"
          ? new Date(startAt) > new Date()
          : startDate > toLocalDateString();
      await onUpdate({
        ...(shop.availability || {}),
        isOpen: startsInFuture ? shop.availability?.isOpen !== false : false,
        temporaryClosure: next,
      });
      setModalOpen(false);
      await loadHistory();
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    setSaving(true);
    try {
      await onUpdate({ ...(shop.availability || {}), isOpen: true, temporaryClosure: null });
      await loadHistory();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6">
      {closure.isClosed ? (
        <div className="p-5 border border-rose/40 bg-rose/10 rounded-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-rose mt-1" size={20} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-rose text-lg">Emergency Closure Active</h3>
                  <StatusBadge s="Emergency Closed" />
                </div>
                <p className="text-sm mt-1">
                  Closed from <b>{closure.startAt ? displayTime(closure.startAt) : formatDateDisplay(closure.startDate)}</b>{" "}
                  until <b>{closure.endAt ? displayTime(closure.endAt) : formatDateDisplay(closure.endDate)}</b>
                </p>
                <p className="text-sm mt-1"><b>Reason:</b> {closure.reason || "Not provided"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn !py-2 !px-4 text-xs" onClick={handleReopen} disabled={saving}>
                <CheckCircle2 size={14} className="mr-1 inline" /> Reopen Shop Now
              </button>
              <button className="btn-ghost !py-2 !px-4 text-xs" onClick={openModal} disabled={saving}>Edit</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 border border-khaki bg-card rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div><h4 className="font-medium flex items-center gap-2"><Clock size={16} /> Emergency & Temporary Closure</h4><p className="text-xs text-coffee/70 mt-1">Pause bookings for a few hours or several days and notify affected customers.</p></div>
          <button className="btn-ghost !py-2 !px-4 text-xs border border-khaki" onClick={openModal}><Calendar size={14} className="mr-1 inline" /> Set Emergency Closure</button>
        </div>
      )}

      {modalOpen && (
        <Modal title="Emergency / Temporary Closure" onClose={() => setModalOpen(false)} actions={<button className="btn text-xs !py-2 !px-4" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Confirm & Close Shop"}</button>}>
          <div className="space-y-4">
            <div className="flex gap-2">
              {["hours", "days"].map((item) => <button key={item} type="button" className={`btn-ghost text-xs ${mode === item ? "border-coffee bg-cream" : ""}`} onClick={() => setMode(item)}>{item === "hours" ? "Hours-based" : "Day-based"}</button>)}
            </div>
            {mode === "hours" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs">Closure starts<input type="datetime-local" className="input w-full mt-1" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label>
                  <label className="text-xs">Reopens at<input type="datetime-local" className="input w-full mt-1" value={endAt} min={startAt} onChange={(e) => setEndAt(e.target.value)} /></label>
                </div>
                <div className="flex flex-wrap gap-2">{[1, 2, 3, 4].map((hours) => <button key={hours} type="button" className="btn-ghost text-xs" onClick={() => chooseDuration(hours)}>{hours} hour{hours > 1 ? "s" : ""}</button>)}</div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">Start date<input type="date" className="input w-full mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
                <label className="text-xs">End date<input type="date" className="input w-full mt-1" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
              </div>
            )}
            <label className="text-xs">Reason for closure<textarea rows={2} className="input w-full mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Emergency, renovation, medical leave..." /></label>
            <div className="p-3 bg-cream/60 border border-khaki rounded text-xs">
              <b>Confirmation:</b> notify approximately <b>{affectedCount}</b> currently scheduled or waiting customer(s). The shop will reopen automatically when this period ends unless another closure applies.
            </div>
          </div>
        </Modal>
      )}
      {history.length > 0 && <details className="mt-4 text-xs"><summary className="cursor-pointer text-coffee/70">View past emergency closures</summary><div className="mt-2 space-y-1">{history.slice(0, 5).map((item) => <div key={item.id} className="border-b border-khaki py-1">{displayTime(item.startAt)} - {displayTime(item.endAt)} · {item.status}</div>)}</div></details>}
    </div>
  );
}
