import { useState } from "react";
import {
  toLocalDateString,
  getTemporaryClosure,
  formatDateDisplay,
} from "../../utils/closedDays";
import { Modal } from "../common/ui";
import { AlertTriangle, Calendar, CheckCircle2, Clock } from "lucide-react";

export default function EmergencyClosure({ shop, onUpdate }) {
  const closure = getTemporaryClosure(shop);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const todayStr = toLocalDateString();

  const addDays = (baseDateStr, days) => {
    const [y, m, d] = (baseDateStr || todayStr).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return toLocalDateString(date);
  };

  const [startDate, setStartDate] = useState(
    closure.startDate || todayStr,
  );
  const [endDate, setEndDate] = useState(
    closure.endDate || addDays(todayStr, 4),
  );
  const [reason, setReason] = useState(closure.reason || "");

  const openModal = () => {
    setStartDate(closure.startDate || todayStr);
    setEndDate(closure.endDate || addDays(todayStr, 4));
    setReason(closure.reason || "");
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!startDate) return;
    setSaving(true);
    try {
      const currentAvail = shop?.availability || {};
      const nextAvail = {
        ...currentAvail,
        temporaryClosure: {
          active: true,
          startDate,
          endDate: endDate || startDate,
          reason: reason.trim(),
        },
      };
      await onUpdate(nextAvail);
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    setSaving(true);
    try {
      const currentAvail = shop?.availability || {};
      const nextAvail = {
        ...currentAvail,
        temporaryClosure: {
          ...(currentAvail.temporaryClosure || {}),
          active: false,
        },
      };
      await onUpdate(nextAvail);
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
              <div className="p-2 bg-rose/20 text-rose rounded-md shrink-0 mt-0.5">
                <AlertTriangle size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-rose text-lg">
                    Emergency Closure Active
                  </h3>
                  <span className="px-2 py-0.5 text-xs bg-rose/20 text-rose font-medium rounded">
                    Shop Closed
                  </span>
                </div>
                <p className="text-sm text-coffee/90 mt-1">
                  Closed from <b>{formatDateDisplay(closure.startDate)}</b> until{" "}
                  <b>{formatDateDisplay(closure.endDate) || "further notice"}</b>
                </p>
                <p className="text-sm text-coffee/80 mt-1">
                  <b>Reason:</b>{" "}
                  {closure.reason ? (
                    <span>&ldquo;{closure.reason}&rdquo;</span>
                  ) : (
                    <span className="italic text-coffee/60">
                      None provided (shown to customers without reason)
                    </span>
                  )}
                </p>
                <div className="mt-3 p-2.5 rounded bg-cream/70 border border-khaki text-xs text-coffee/80">
                  <span className="font-medium text-coffee">
                    Customer view:
                  </span>{" "}
                  &ldquo;
                  {closure.endDate
                    ? `Closed until ${formatDateDisplay(closure.endDate)}`
                    : "Temporarily closed"}
                  {closure.reason ? ` · Reason: ${closure.reason}` : ""}
                  &rdquo;
                </div>
              </div>
            </div>

            <div className="flex md:flex-col gap-2 shrink-0">
              <button
                type="button"
                className="btn !py-2 !px-4 text-xs bg-olive text-cream hover:bg-olive/90"
                onClick={handleReopen}
                disabled={saving}
              >
                <CheckCircle2 size={14} className="mr-1 inline" />
                {saving ? "Updating..." : "Reopen Shop Now"}
              </button>
              <button
                type="button"
                className="btn-ghost !py-2 !px-4 text-xs"
                onClick={openModal}
                disabled={saving}
              >
                Edit Dates / Reason
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 border border-khaki bg-card rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-coffee/80" />
              <h4 className="font-medium text-coffee text-base">
                Emergency & Temporary Closure
              </h4>
            </div>
            <p className="text-xs text-coffee/70 mt-1">
              Need to close for 4-5 days (e.g. personal emergency, renovation, or vacation)?
              Set dates and an optional reason to inform customers and pause bookings.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost !py-2 !px-4 text-xs whitespace-nowrap shrink-0 border border-khaki hover:border-coffee"
            onClick={openModal}
          >
            <Calendar size={14} className="mr-1 inline" />
            Set Emergency Closure
          </button>
        </div>
      )}

      {modalOpen && (
        <Modal
          title="Emergency / Temporary Closure"
          onClose={() => setModalOpen(false)}
          actions={
            <button
              type="button"
              className="btn text-xs !py-2 !px-4"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Confirm & Close Shop"}
            </button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-coffee/70">
              Customers will see an emergency closure alert on your shop profile,
              and new queue tokens will be paused for this duration.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-coffee mb-1">
                  Closure Start Date
                </label>
                <input
                  type="date"
                  className="input w-full text-xs"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-coffee mb-1">
                  Reopening / End Date
                </label>
                <input
                  type="date"
                  className="input w-full text-xs"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <span className="block text-xs text-coffee/70 mb-1.5 font-medium">
                Quick duration presets:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "2 Days", days: 2 },
                  { label: "4 Days", days: 4 },
                  { label: "5 Days", days: 5 },
                  { label: "1 Week", days: 7 },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="px-2.5 py-1 text-xs border border-khaki rounded hover:border-coffee bg-cream/40"
                    onClick={() => setEndDate(addDays(startDate, item.days))}
                  >
                    +{item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-coffee mb-1">
                Reason for Closure (Optional)
              </label>
              <textarea
                rows={2}
                className="input w-full text-xs"
                placeholder="e.g. Family emergency, shop renovation, medical leave (or leave blank for no reason)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-[11px] text-coffee/60 mt-1">
                Leave blank if you prefer to close without showing a specific reason.
              </p>
            </div>

            <div className="p-3 bg-cream/60 border border-khaki rounded text-xs">
              <span className="font-medium text-coffee">
                Live customer preview:
              </span>
              <div className="mt-1 text-rose font-medium">
                Temporarily closed until {formatDateDisplay(endDate) || "further notice"}
                {reason.trim() ? ` · Reason: "${reason.trim()}"` : ""}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
