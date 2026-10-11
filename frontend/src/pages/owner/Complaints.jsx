import { useEffect, useState } from "react";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { Empty, Modal, PageHead, StatusBadge } from "../../components/common/ui";
import { relativeTime } from "../../utils/relativeTime";

export default function OwnerComplaints() {
  const { currentShopId, sessionRole, shop } = useOwner();
  const shopId = sessionRole === "owner" ? currentShopId : shop?.id;
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/complaints/owner", { params: shopId ? { shopId } : {} })
      .then(({ data }) => {
        if (!cancelled) {
          setRows(data || []);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err.response?.data?.message || "Could not load complaints.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const updateStatus = async (complaint, status) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.patch(`/complaints/${complaint.id}/status`, {
        status,
      });
      const updated = {
        ...complaint,
        status: data.status,
        resolvedAt:
          data.status === "Resolved"
            ? complaint.resolvedAt || new Date().toISOString()
            : null,
      };
      setRows((items) => items.map((item) => item.id === updated.id ? updated : item));
      setSelected(updated);
      setMessage(
        data.changed
          ? data.status === "Resolved"
            ? "Complaint resolved. The customer was notified."
            : "Complaint status updated."
          : "This complaint already has that status.",
      );
    } catch (err) {
      setError(err.response?.data?.message || "Could not update complaint status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Complaints"
        sub="Complaints customers made about staff at your shop."
      />
      {error && <p className="text-sm text-rose mb-4" role="alert">{error}</p>}
      {message && <p className="text-sm text-olive mb-4" role="status">{message}</p>}
      {loading ? (
        <p className="text-sm text-coffee/70">Loading complaints...</p>
      ) : !rows.length ? (
        <Empty title="No complaints" text="Customer complaints for this shop will appear here." />
      ) : (
        <div className="border-t border-khaki">
          {rows.map((complaint) => (
            <button
              type="button"
              key={complaint.id}
              onClick={() => { setSelected(complaint); setMessage(""); }}
              className="w-full text-left flex flex-wrap items-center justify-between gap-3 py-4 border-b border-khaki"
            >
              <span>
                <b>{complaint.subject || complaint.issueType}</b>
                <span className="block text-sm text-coffee/70">
                  {complaint.customerName} · About {complaint.targetName || "staff"} · {complaint.issueType} · {relativeTime(complaint.createdAt)}
                </span>
              </span>
              <StatusBadge s={complaint.status} />
            </button>
          ))}
        </div>
      )}
      {selected && (
        <Modal
          title={selected.subject || "Complaint details"}
          onClose={() => setSelected(null)}
          actions={
            selected.status === "Resolved" || selected.status === "Closed" ? null : (
              <div className="flex gap-2">
                {selected.status !== "In Progress" && (
                  <button className="btn-ghost" disabled={busy} onClick={() => updateStatus(selected, "investigating")}>
                    Mark In Progress
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={() => updateStatus(selected, "resolved")}>
                  {busy ? "Saving..." : "Mark Resolved"}
                </button>
              </div>
            )
          }
        >
          <div className="space-y-3 text-sm">
            {error && <p className="text-rose" role="alert">{error}</p>}
            <p><b>Complaint ID:</b> {selected.id}</p>
            <p><b>Customer:</b> {selected.customerName}</p>
            <p><b>Issue type:</b> {selected.issueType}</p>
            <p><b>About staff member:</b> {selected.targetName || "Staff member"}</p>
            <p><b>Status:</b> {selected.status}</p>
            <p><b>Submitted:</b> {relativeTime(selected.createdAt)}</p>
            <div>
              <b>Description</b>
              <p className="mt-1 whitespace-pre-wrap">{selected.description}</p>
            </div>
            {selected.resolvedAt && <p><b>Resolved:</b> {relativeTime(selected.resolvedAt)}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
