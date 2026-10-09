import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../services/api";
import { useOwner } from "../../hooks/useOwnerStore";

const FINAL = ["accepted", "rejected"];
const TIMEOUT_MS = 15 * 60 * 1000;

export default function PaymentStatus() {
  const { bookingId } = useParams();
  const { refreshBookings } = useOwner();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer;

    const load = async () => {
      try {
        const { data } = await api.get(`/bookings/${bookingId}`);
        if (stopped) return;

        setBooking(data);
        setError("");

        const submittedAt = new Date(data.paymentSubmittedAt || data.createdAt || Date.now()).getTime();
        setTimedOut(data.status === "payment_submitted" && Date.now() - submittedAt >= TIMEOUT_MS);

        if (FINAL.includes(data.status)) {
          refreshBookings();
          return;
        }
      } catch (e) {
        if (stopped) return;
        if (e.response?.status === 404) {
          setError("This booking could not be found.");
          return;
        }
      }

      timer = setTimeout(load, 4000);
    };

    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [bookingId]);

  if (error) {
    return (
      <div className="fade max-w-xl mx-auto border border-khaki bg-card p-8">
        <p className="label">Booking</p>
        <p className="mt-2">{error}</p>
        <Link to="/app/shops" className="btn mt-6">Find a barber</Link>
      </div>
    );
  }

  if (!booking) {
    return <div className="max-w-xl mx-auto py-16 text-center text-soft">Checking your booking...</div>;
  }

  const accepted = booking.status === "accepted";
  const rejected = booking.status === "rejected";
  const waiting = booking.status === "payment_submitted";
  const services = (booking.services || []).map((x) => x.name).join(" + ");

  const heading = accepted
    ? "You are in the queue"
    : rejected
      ? "Payment not received"
      : timedOut
        ? "The shop has not confirmed yet"
        : "The shop is checking your payment";

  const text = accepted
    ? `${booking.shopName} has accepted your payment.`
    : rejected
      ? "Payment was not received. Please try again. You can book this shop again after 30 minutes."
      : timedOut
        ? "The shop has not confirmed yet. Please try again."
        : "Payment submitted. The shop is checking your payment. This page updates automatically.";

  return (
    <div className="fade max-w-xl mx-auto border border-khaki bg-card p-8 md:p-10">
      <div className="flex items-center justify-between gap-3">
        <p className="label !text-gold-light">UPI payment</p>
        <span className="text-xs text-hint">₹{Number(booking.amount).toFixed(2)}</span>
      </div>

      <h1 className="text-4xl mt-3 flex items-center gap-4">
        {waiting && !timedOut && <span className="pay-spinner pay-spinner-lg" aria-label="Processing" />}
        {heading}
      </h1>

      <p className="text-soft mt-2">{text}</p>

      {accepted && booking.token && (
        <div className="mt-6">
          <p className="label">Token</p>
          <div className="font-serif text-7xl text-gold mt-1">#{booking.token}</div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-5 text-sm mt-8 pt-6 border-t border-khaki">
        <div><dt className="label">Shop</dt><dd className="mt-1">{booking.shopName}</dd></div>
        <div><dt className="label">Barber</dt><dd className="mt-1">{booking.barberName}</dd></div>
        <div><dt className="label">Services</dt><dd className="mt-1">{services}</dd></div>
        <div><dt className="label">Amount</dt><dd className="mt-1">₹{Number(booking.amount).toFixed(2)}</dd></div>
        <div><dt className="label">Payer</dt><dd className="mt-1">{booking.payerName || booking.customerName}</dd></div>
        <div><dt className="label">Submitted</dt><dd className="mt-1">{new Date(booking.paymentSubmittedAt || booking.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</dd></div>
      </dl>

      {waiting && !timedOut && (
        <p className="text-xs text-hint mt-6">Checking every few seconds. You do not need to refresh.</p>
      )}

      <div className="flex flex-wrap gap-3 mt-8">
        {accepted && <Link to="/app/queue" className="btn">Track my queue</Link>}
        {(rejected || timedOut) && <Link to={`/app/book/${booking.shopId}`} className="btn">Try again</Link>}
        <Link to="/app/payments" className="btn-ghost">View payments</Link>
      </div>
    </div>
  );
}
