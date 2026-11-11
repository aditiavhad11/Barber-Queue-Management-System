import { AppError } from "../utils/AppError.js";
import { writeAuditLog } from "./auditLogService.js";

export const BOOKING_STATUSES = Object.freeze([
  "payment_submitted",
  "accepted",
  "rejected",
  "created",
  "paid",
  "failed",
  "cancelled",
]);

export const QUEUE_STATUSES = Object.freeze([
  "Waiting",
  "Your Turn",
  "In Service",
  "Scheduled",
  "Prebooked",
  "Emergency Closed",
  "Completed",
  "Skipped",
  "No Show",
  "Cancelled",
]);

const BOOKING_TRANSITIONS = new Map([
  [null, new Set(["payment_submitted"])],
  ["payment_submitted", new Set(["accepted", "rejected", "cancelled", "failed"])],
  ["accepted", new Set()],
  ["rejected", new Set()],
  ["created", new Set(["paid", "failed", "cancelled"])],
  ["paid", new Set(["accepted", "failed", "cancelled"])],
  ["failed", new Set()],
  ["cancelled", new Set()],
]);

const QUEUE_TRANSITIONS = new Map([
  [null, new Set(["Waiting", "Scheduled", "Prebooked"])],
  ["Waiting", new Set(["Your Turn", "In Service", "Completed", "Skipped", "No Show", "Cancelled", "Emergency Closed"])],
  ["Your Turn", new Set(["Waiting", "In Service", "Completed", "Skipped", "No Show", "Cancelled", "Emergency Closed"])],
  ["In Service", new Set(["Completed", "No Show", "Cancelled", "Emergency Closed"])],
  ["Scheduled", new Set(["Waiting", "Cancelled", "Emergency Closed"])],
  ["Prebooked", new Set(["Waiting", "Cancelled", "Emergency Closed"])],
  ["Emergency Closed", new Set(["Waiting", "Cancelled"])],
  ["Skipped", new Set(["Waiting", "Cancelled"])],
  ["Completed", new Set()],
  ["No Show", new Set()],
  ["Cancelled", new Set()],
]);

export function assertBookingStatusTransition(from, to) {
  if (!BOOKING_STATUSES.includes(to))
    throw AppError.conflict("Invalid booking status.", "INVALID_BOOKING_STATUS");
  if (from === to) return;
  if (!BOOKING_TRANSITIONS.get(from)?.has(to)) {
    throw AppError.conflict(
      `Booking cannot transition from ${from || "unset"} to ${to}.`,
      "INVALID_BOOKING_TRANSITION",
    );
  }
}

export function assertQueueStatusTransition(from, to) {
  if (!QUEUE_STATUSES.includes(to))
    throw AppError.conflict("Invalid queue status.", "INVALID_QUEUE_STATUS");
  if (from === to) return;
  if (!QUEUE_TRANSITIONS.get(from ?? null)?.has(to)) {
    throw AppError.conflict(
      `Queue entry cannot transition from ${from || "unset"} to ${to}.`,
      "INVALID_QUEUE_TRANSITION",
    );
  }
}

export async function recordBookingTransition(
  connection,
  {
    bookingId,
    toBookingStatus,
    toQueueStatus,
    actorId = null,
    actorRole = "system",
    action = "booking_status_changed",
    metadata = {},
    current = null,
  },
) {
  let state = current;
  if (!state && bookingId) {
    const [rows] = await connection.query(
      "SELECT status,queue_status FROM payment_bookings WHERE id=? FOR UPDATE",
      [bookingId],
    );
    state = rows[0];
  }
  if (!state)
    throw AppError.notFound("Booking not found.", "BOOKING_NOT_FOUND");

  const nextBookingStatus = toBookingStatus ?? state.status;
  const currentQueueStatus =
    state.queue_status ?? (state.status === "accepted" ? "Waiting" : null);
  const nextQueueStatus = toQueueStatus === undefined ? state.queue_status : toQueueStatus;
  if (toBookingStatus !== undefined)
    assertBookingStatusTransition(state.status, nextBookingStatus);
  if (toQueueStatus !== undefined)
    assertQueueStatusTransition(currentQueueStatus, nextQueueStatus);

  const changed =
    state.status !== nextBookingStatus || currentQueueStatus !== nextQueueStatus;
  if (changed) {
    await writeAuditLog(connection, {
      actorId,
      actorRole,
      action,
      entityType: "payment_booking",
      entityId: bookingId,
      metadata: {
        ...metadata,
        before: { bookingStatus: state.status, queueStatus: currentQueueStatus },
        after: { bookingStatus: nextBookingStatus, queueStatus: nextQueueStatus },
      },
    });
  }
  return state;
}
