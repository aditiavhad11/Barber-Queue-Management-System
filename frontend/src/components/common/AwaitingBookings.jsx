import { Link } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";

// Payment submissions that the shop owner has not accepted yet. They are not in a queue until accepted.
export default function AwaitingBookings() {
  const { myBookings } = useOwner();
  const waiting = (myBookings || []).filter(
    (b) => b.status === "payment_submitted",
  );
  if (!waiting.length) return null;
  return (
    <div className="border border-brass bg-card p-5 mb-8">
      <p className="label !text-gold-light">Waiting for the shop</p>
      {waiting.map((b) => (
        <div
          key={b.id}
          className="flex flex-wrap items-center justify-between gap-3 mt-3"
        >
          <p className="text-sm">
            {b.shopName}: {b.services.map((x) => x.name).join(" + ")} with{" "}
            {b.barberName}, ₹{b.amount}. Payment submitted, waiting for the shop
            to confirm.
          </p>
          <Link to={`/app/queue/payment/${b.id}`} className="btn-ghost !py-2">
            View status
          </Link>
        </div>
      ))}
    </div>
  );
}
