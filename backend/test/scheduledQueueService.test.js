import test from "node:test";
import assert from "node:assert/strict";
import {
  minutesUntilAppointment,
  scheduledInsertionPlan,
  shouldInsertScheduledBooking,
} from "../src/services/scheduledQueueService.js";

const now = new Date("2026-10-17T10:00:00+05:30");

test("inserts a scheduled booking before its appointment when the queue reaches its threshold", () => {
  assert.equal(minutesUntilAppointment("2026-10-17", "10:30:00", now), 30);
  assert.equal(
    shouldInsertScheduledBooking({
      remainingQueueMinutes: 10,
      durationMinutes: 20,
      minutesUntil: 30,
    }),
    true,
  );
});

test("keeps a scheduled booking out while there is still safe slack", () => {
  assert.deepEqual(
    scheduledInsertionPlan({
      activeBookings: [{ duration_minutes: 10 }],
      scheduledBookings: [{ id: "scheduled-1", scheduled_time: "12:00:00", duration_minutes: 20 }],
      queueLimit: 3,
      bookingDate: "2026-10-17",
      now,
    }),
    [],
  );
});

test("plans multiple appointments in appointment order and respects capacity", () => {
  assert.deepEqual(
    scheduledInsertionPlan({
      activeBookings: [{ duration_minutes: 20 }],
      scheduledBookings: [
        { id: "late", scheduled_time: "10:45:00", duration_minutes: 15 },
        { id: "early", scheduled_time: "10:30:00", duration_minutes: 20 },
      ],
      queueLimit: 2,
      bookingDate: "2026-10-17",
      now,
    }),
    ["early"],
  );
});

test("does not plan a cancelled or completed booking because only scheduled rows are eligible", () => {
  assert.deepEqual(
    scheduledInsertionPlan({
      activeBookings: [],
      scheduledBookings: [],
      queueLimit: 2,
      bookingDate: "2026-10-17",
      now,
    }),
    [],
  );
});

test("a restart-safe scan produces the same idempotent plan for pending rows", () => {
  const input = {
    activeBookings: [],
    scheduledBookings: [
      { id: "pending", scheduled_time: "10:05:00", duration_minutes: 30 },
    ],
    queueLimit: 2,
    bookingDate: "2026-10-17",
    now,
  };
  assert.deepEqual(scheduledInsertionPlan(input), ["pending"]);
  assert.deepEqual(scheduledInsertionPlan(input), ["pending"]);
});
