import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { Empty } from "../../components/common/ui";
import { relativeTime } from "../../utils/relativeTime";
import { notifyError, notifySuccess } from "../../utils/toast";
export default function Complaints() {
  const { shops } = useOwner();
  const [customerComplaints, setCustomerComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [params] = useSearchParams();
  const presetShopId = params.get("shopId") || "";
  const presetQueueId = params.get("queueId") || "";
  const [open, setOpen] = useState(Boolean(presetShopId));
  const [f, setF] = useState({
    shopId: presetShopId,
    targetType: "staff",
    targetBarberId: "",
    issueType: "Service",
    subject: "",
    description: "",
  });
  const selectedShop = shops.find((s) => s.id === f.shopId);
  const staffMembers = selectedShop?.barbersList?.length
    ? selectedShop.barbersList
    : selectedShop?.barbers || [];
  useEffect(() => {
    api
      .get("/complaints/mine")
      .then(({ data }) => setCustomerComplaints(data || []))
      .catch((err) => setError(err.response?.data?.message || "Could not load complaints."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (presetShopId) setF((p) => ({ ...p, shopId: presetShopId }));
  }, [presetShopId]);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.shopId || !f.subject.trim() || !f.description.trim()) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/complaints", f);
      setCustomerComplaints((rows) => [data.complaint, ...rows]);
      setF({ shopId: "", targetType: "staff", targetBarberId: "", issueType: "Service", subject: "", description: "" });
      setOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "Could not submit your complaint.");
    } finally {
      setSaving(false);
    }
    if (!f.shopId || !f.subject.trim() || !f.description.trim()) {
      notifyError("Select a shop and fill in the subject and description.");
      return;
    }
    addComplaint(f);
    setF({ shopId: "", issueType: "Service", subject: "", description: "" });
    setOpen(false);
    notifySuccess("Your complaint has been submitted.");
  };
  return (
    <div className="fade max-w-3xl">
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <p className="label">Customer support</p>
          <h1 className="text-5xl">My Complaints</h1>
        </div>
        <button className="btn" onClick={() => setOpen(true)}>
          New Complaint
        </button>
      </div>
      {error && <p className="text-sm text-rose mb-4" role="alert">{error}</p>}
      {loading ? (
        <p className="text-sm text-coffee/70">Loading complaints...</p>
      ) : !customerComplaints.length ? (
        <Empty
          title="No complaints"
          text="Your complaints and their resolution status will appear here."
        />
      ) : (
        customerComplaints.map((c) => (
          <div key={c.id} className="border-b border-khaki py-5">
            <div className="flex justify-between gap-3">
              <div>
                <b>{c.subject || c.issueType}</b>
                <p className="text-sm text-coffee/60">
                  {c.shop} · {c.issueType}
                  {` · About ${c.targetName || c.targetType}`}
                </p>
              </div>
              <span className="text-xs border border-khaki px-2 py-1">
                {c.status}
              </span>
            </div>
            <p className="text-sm mt-3">{c.description}</p>
            <p className="text-xs text-coffee/50 mt-2">
              {relativeTime(c.createdAt)}
            </p>
            {c.resolvedAt && (
              <p className="text-xs text-olive mt-1">Resolved {relativeTime(c.resolvedAt)}</p>
            )}
          </div>
        ))
      )}
      {open && (
        <div className="fixed inset-0 bg-black/70 grid place-items-center z-50 p-4">
          <form
            onSubmit={submit}
            className="bg-card border border-khaki max-w-xl w-full p-7 space-y-3"
          >
            <h2 className="text-3xl">New Complaint</h2>
            <select
              className="input"
              required
              value={f.shopId}
              onChange={(e) => setF({ ...f, shopId: e.target.value })}
            >
              <option value="">Select shop</option>
              {shops
                .filter((s) => s.status === "approved")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <select
              className="input"
              required
              value={f.targetType}
              onChange={(e) => setF({ ...f, targetType: e.target.value, targetBarberId: "" })}
            >
              <option value="staff">Complaint about staff</option>
              <option value="owner">Complaint about shop owner</option>
            </select>
            {f.targetType === "staff" && (
              <select className="input" required value={f.targetBarberId}
                onChange={(e) => setF({ ...f, targetBarberId: e.target.value })}>
                <option value="">Select staff member</option>
                {staffMembers.map((barber) => (
                  <option key={barber.id} value={barber.id}>{barber.name}</option>
                ))}
              </select>
            )}
            <select
              className="input"
              value={f.issueType}
              onChange={(e) => setF({ ...f, issueType: e.target.value })}
            >
              <option>Service</option>
              <option>Queue</option>
              <option>Payment</option>
              <option>Staff</option>
              <option>Shop</option>
              <option>Other</option>
            </select>
            <input
              className="input"
              required
              placeholder="Subject"
              value={f.subject}
              onChange={(e) => setF({ ...f, subject: e.target.value })}
            />
            <textarea
              className="input"
              rows={5}
              required
              placeholder="Describe the issue"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
            {presetQueueId && (
              <p className="text-xs text-coffee/60">
                This complaint is linked to completed booking {presetQueueId}.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="btn" disabled={saving}>
                {saving ? "Submitting..." : "Submit complaint"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
