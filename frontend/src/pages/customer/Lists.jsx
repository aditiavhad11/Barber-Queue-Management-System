import { useState } from "react";
import { useOwner } from "../../hooks/useOwnerStore";
import { Trash2 } from "lucide-react";
import { Badge, Empty } from "../../components/common/ui";
import { relativeTime } from "../../utils/relativeTime";
export function Bookings() {
  const { customerPayments, customerQueue } = useOwner();
  const grouped = new Map();
  customerPayments.forEach((p) => {
    const key = p.queueId || p.id;
    if (!grouped.has(key))
      grouped.set(key, {
        ...p,
        price: Number(p.amount || 0),
        service: p.service || "Service",
        _payments: 1,
      });
    else {
      const x = grouped.get(key);
      x.price += Number(p.amount || 0);
      x.service = x.service.includes(p.service)
        ? x.service
        : `${x.service} + ${p.service}`;
      x._payments += 1;
    }
  });
  const rows = [...grouped.values()].map((p) => {
    const liveEntry =
      customerQueue?.entry?.id === p.queueId ? customerQueue.entry : null;
    const displayStatus = liveEntry
      ? liveEntry.status === "Cancelled" || liveEntry.status === "No Show"
        ? "Cancelled"
        : liveEntry.status === "Completed"
          ? "Completed"
          : "Upcoming"
      : p.status === "Successful"
        ? "Completed"
        : p.status === "Cancelled" || p.status === "Refunded"
          ? "Cancelled"
          : p.status;
    return { ...p, status: displayStatus };
  });
  const live = customerQueue
    ? [
        {
          id: customerQueue.entry.id,
          shop: customerQueue.shop.name,
          service: (customerQueue.entry.services || [customerQueue.service])
            .map((x) => x?.name)
            .filter(Boolean)
            .join(" + "),
          barber: customerQueue.barber.name,
          date: new Date(
            customerQueue.entry.createdAt || Date.now(),
          ).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          price: customerQueue.entry.paymentAmount,
          status: "Upcoming",
        },
      ]
    : [];
  const all = [
    ...live,
    ...rows.filter(
      (r) => !live.some((x) => x.id === r.queueId || x.id === r.id),
    ),
  ].filter((b, i, a) => a.findIndex((x) => x.id === b.id) === i);
  return (
    <div className="fade">
      <h1 className="text-5xl mb-6">Bookings</h1>
      {!all.length ? (
        <Empty
          title="No bookings"
          text="Your queue payments and completed visits will appear here."
        />
      ) : (
        all.map((b) => (
          <div
            key={b.id}
            className="flex flex-wrap justify-between gap-2 py-4 border-b border-khaki"
          >
            <div>
              <b>{b.shop}</b>
              <p className="text-sm text-coffee/70">
                {b.service} with {b.barber} · {b.date}
              </p>
            </div>
            <div className="flex items-center gap-3">
              ₹{b.price}
              <Badge
                tone={
                  b.status === "Cancelled"
                    ? "alert"
                    : b.status === "Upcoming"
                      ? "info"
                      : "ok"
                }
              >
                {b.status}
              </Badge>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
export function Payments() {
  const { customerPayments } = useOwner();
  const [selected, setSelected] = useState(null);
  const total = customerPayments
    .filter((p) => p.status === "Successful")
    .reduce((n, p) => n + Number(p.amount || 0), 0);

  return (
    <div className="fade">
      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <p className="label">Payment history</p>
          <h1 className="text-5xl">My Payments</h1>
        </div>
        <div className="text-right">
          <p className="label">Successful spend</p>
          <p className="font-serif text-3xl">₹{total}</p>
        </div>
      </div>

      {!customerPayments.length ? (
        <Empty
          title="No payments yet"
          text="Your booking payments will appear here."
        />
      ) : (
        <div className="border-t border-khaki">
          {customerPayments.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p)}
              className="w-full text-left flex flex-wrap justify-between gap-3 py-4 border-b border-khaki hover:bg-olive/5"
            >
              <div>
                <b>{p.shop || "Shop"}</b>
                <p className="text-sm text-coffee/65">
                  {p.service} · {p.barber}
                </p>
                <p className="text-xs text-coffee/50">
                  {p.id} · {p.date}, {p.time}
                </p>
              </div>
              <div className="text-right">
                <b>₹{p.amount}</b>
                <p
                  className={`text-xs mt-1 ${p.status === "Successful" ? "text-olive" : p.status === "Cancelled" ? "text-rose" : "text-gold"}`}
                >
                  {p.status}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 bg-black/70 grid place-items-center z-50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-card border border-khaki max-w-lg w-full p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="label">Transaction details</p>
                <h2 className="text-3xl">{selected.shop || "Shop"}</h2>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>

            <div className="space-y-3 mt-6 text-sm">
              <Row k="Transaction ID" v={selected.id} />
              <Row k="Service" v={selected.service} />
              <Row k="Barber" v={selected.barber} />
              <Row k="Amount" v={`₹${selected.amount}`} />
              <Row k="Payment method" v={selected.paymentMethod || "UPI QR"} />
              <Row k="Status" v={selected.status} />
              <Row k="Date" v={`${selected.date}, ${selected.time}`} />
              {selected.queueId && <Row k="Queue" v={selected.queueId} />}
            </div>

            {(selected.status === "Successful" ||
              selected.status === "Cancelled") && (
              <div className="border-t border-khaki mt-6 pt-6">
                <div className="border border-brass/40 bg-brass/10 p-5">
                  <p className="label">PAYMENT</p>
                  <h3 className="font-serif text-2xl mt-1">
                    {selected.status === "Cancelled"
                      ? "Payment cancelled"
                      : "Payment details"}
                  </h3>
                  <p className="text-sm text-coffee/70 mt-2">
                    Payment status and booking details are shown here.
                  </p>
                  {selected.status === "Cancelled" && (
                    <div className="mt-4 border border-khaki bg-mist/40 p-3 text-sm">
                      <span className="label">Payment</span>
                      <p className="font-medium mt-1">Cancelled</p>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <a
                    className="btn"
                    href={
                      selected.shopContact
                        ? `tel:${selected.shopContact}`
                        : undefined
                    }
                    onClick={(e) => {
                      if (!selected.shopContact) e.preventDefault();
                    }}
                  >
                    Call Owner
                  </a>
                  {selected.shopContact ? (
                    <span className="text-sm text-coffee/65">
                      {selected.shopContact}
                    </span>
                  ) : (
                    <span className="text-sm text-rose">
                      Owner phone number is not available.
                    </span>
                  )}
                </div>

                <p className="text-xs text-coffee/50 mt-3">
                  Share transaction ID <b>{selected.id}</b> with the shop owner.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-5 border-b border-khaki/60 pb-2">
    <span className="text-coffee/60">{k}</span>
    <b className="text-right">{v}</b>
  </div>
);
export const Notifications = () => {
  const { notifications, removeNotification } = useOwner();
  return (
    <div className="fade">
      <h1 className="text-5xl mb-6">Notifications</h1>
      {!notifications.length ? (
        <Empty title="All caught up" text="No notifications." />
      ) : (
        notifications.map((n) => (
          <div
            key={n.id}
            className={`py-4 border-b border-khaki pl-3 border-l-2 flex justify-between gap-3 ${n.tone === "alert" ? "border-l-rose" : n.tone === "ok" ? "border-l-olive" : "border-l-brass"}`}
          >
            <div>
              <p>{n.text}</p>
              <p className="text-xs text-coffee/60">
                {n.shop ? `${n.shop} · ` : ""}
                {relativeTime(n.createdAt || n.time)}
              </p>
            </div>
            <button
              type="button"
              className="text-coffee/50 hover:text-rose"
              title="Delete notification"
              onClick={() => removeNotification(n.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))
      )}
    </div>
  );
};
export const Profile = () => {
  const { customer } = useOwner();
  return (
    <div className="fade max-w-lg">
      <h1 className="text-5xl mb-6">Profile</h1>
      <div className="space-y-4">
        <input className="input" defaultValue={customer?.name || ""} />
        <input
          className="input"
          defaultValue={customer?.email || ""}
          disabled
        />
        <input className="input" placeholder="Mobile number (for bookings)" />
        <button className="btn">Save</button>
      </div>
    </div>
  );
};
export const Settings = () => (
  <div className="fade">
    <h1 className="text-5xl mb-4">Settings</h1>
    <p className="text-coffee/70">
      Account settings are secured by your authenticated session.
    </p>
  </div>
);
