const COMPLETED_BOOKING_STATUSES = new Set(["accepted", "paid"]);
const TERMINAL_UNSUCCESSFUL_QUEUE_STATUSES = new Set(["Cancelled", "No Show"]);
export const NEW_CUSTOMER_RESERVATION_MINUTES = 15;

export function isSuccessfulCompletedBooking(booking) {
  return COMPLETED_BOOKING_STATUSES.has(String(booking?.status || ""))
    && String(booking?.queue_status || "") === "Completed";
}

export function hasSuccessfulCompletedBooking(bookings = []) {
  return bookings.some(isSuccessfulCompletedBooking);
}

// Pending submissions and active accepted bookings reserve a one-time offer so
// parallel bookings cannot consume it repeatedly. Cancelled/failed/no-show rows
// remain eligible until a booking is actually completed.
export function hasActiveNewCustomerOfferReservation(bookings = []) {
  return bookings.some((booking) => booking?.status === "payment_submitted"
    || ((booking?.status === "accepted" || booking?.status === "paid")
      && !TERMINAL_UNSUCCESSFUL_QUEUE_STATUSES.has(String(booking?.queue_status || ""))));
}

export function isOfferValueWithinCap(value, maximumValue) {
  return maximumValue == null || Number(value) <= Number(maximumValue);
}

export function effectiveOfferStatus({ status, startsAt, endsAt, serverNow }) {
  if (status === "draft" || status === "paused") return status;
  const now = Date.parse(serverNow);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(now) || !Number.isFinite(start) || start > now) return "scheduled";
  if (!Number.isFinite(end) || end < now) return "expired";
  return status === "active" ? "active" : status;
}
