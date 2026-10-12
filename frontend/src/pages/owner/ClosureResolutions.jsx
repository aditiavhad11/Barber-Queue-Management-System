import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { api } from "../../services/api";
import { PageHead, Empty, StatusBadge } from "../../components/common/ui";
import { useOwner } from "../../hooks/useOwnerStore";

const ResolutionRow = ({ booking, action, busy, onAction }) => (
  <div className="flex flex-wrap items-center justify-between gap-4 py-4 border-b border-khaki">
    <div>
      <b>{booking.customerName || "Customer"}</b>
      <p className="text-sm text-coffee/70">
        {booking.shopName} · {booking.barberName} · Token {booking.token || "-"}
      </p>
      <p className="text-xs text-coffee/55">
        Amount ₹{booking.amount} · Booking {booking.id}
      </p>
    </div>
    <div className="flex items-center gap-3">
      <StatusBadge s={booking.refundStatus === "requested" ? "Refund requested" : "Waiting"} />
      <button
        className="btn text-xs !py-2"
        disabled={busy}
        onClick={() => onAction(booking, action)}
      >
        {action === "rejoin" ? (
          <><CheckCircle2 size={14} className="inline mr-1" /> Rejoin in queue</>
        ) : (
          <><RotateCcw size={14} className="inline mr-1" /> Complete refund</>
        )}
      </button>
    </div>
  </div>
);

export default function ClosureResolutions() {
  const { currentShopId } = useOwner();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/bookings/closure-resolutions", {
        toastOnError: false,
      });
      setRows(response.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentShopId) load();
  }, [currentShopId]);

  const resolve = async (booking, action) => {
    setBusy(booking.id);
    try {
      await api.patch(`/bookings/${booking.id}/queue-status`, { action });
      await load();
    } finally {
      setBusy("");
    }
  };

  const waiting = rows.filter(
    (booking) =>
      booking.queueStatus === "Emergency Closed" &&
      booking.refundStatus !== "requested",
  );
  const refunds = rows.filter((booking) => booking.refundStatus === "requested");

  return (
    <div className="fade">
      <PageHead
        title="Closure resolutions"
        sub="Resolve customers affected by an emergency closure without deleting their booking records."
      />
      <section className="mb-8">
        <h2 className="text-2xl mb-2">Waiting to reopen</h2>
        {loading ? (
          <p className="text-sm text-coffee/60">Loading...</p>
        ) : !waiting.length ? (
          <Empty title="No customers waiting" text="Customers who choose to wait will appear here." />
        ) : (
          waiting.map((booking) => (
            <ResolutionRow
              key={booking.id}
              booking={booking}
              action="rejoin"
              busy={busy === booking.id}
              onAction={resolve}
            />
          ))
        )}
      </section>
      <section>
        <h2 className="text-2xl mb-2">Refund requests</h2>
        {loading ? (
          <p className="text-sm text-coffee/60">Loading...</p>
        ) : !refunds.length ? (
          <Empty title="No refund requests" text="Requested refunds will appear here." />
        ) : (
          refunds.map((booking) => (
            <ResolutionRow
              key={booking.id}
              booking={booking}
              action="refund_complete"
              busy={busy === booking.id}
              onAction={resolve}
            />
          ))
        )}
      </section>
    </div>
  );
}
