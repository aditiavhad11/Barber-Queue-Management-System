import test from "node:test";
import assert from "node:assert/strict";
import { isWithinHappyHour } from "../src/utils/happyHour.js";

const date = "2026-10-29"; // Thursday in the shop's Asia/Kolkata timezone.
const window = { startTime: "12:00:00", endTime: "15:00:00", days: ["Thu"] };

test("scheduled appointments include the start and exclude the end of a same-day window", () => {
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "12:00" }), true);
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "14:00" }), true);
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "14:59" }), true);
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "15:00" }), false);
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "11:59" }), false);
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "15:01" }), false);
});

test("applicable days use the appointment date in the shop timezone", () => {
  assert.equal(isWithinHappyHour({ ...window, bookingDate: date, scheduledTime: "12:30" }), true);
  assert.equal(isWithinHappyHour({ ...window, bookingDate: "2026-10-30", scheduledTime: "12:30" }), false);
  assert.equal(isWithinHappyHour({ startTime: "12:00", endTime: "15:00", days: [], bookingDate: "2026-10-30", scheduledTime: "12:30" }), true);
});

test("overnight windows associate after-midnight appointments with the previous day's window", () => {
  const overnight = { startTime: "22:00", endTime: "02:00", days: ["Thu"] };
  assert.equal(isWithinHappyHour({ ...overnight, bookingDate: date, scheduledTime: "22:00" }), true);
  assert.equal(isWithinHappyHour({ ...overnight, bookingDate: date, scheduledTime: "23:59" }), true);
  assert.equal(isWithinHappyHour({ ...overnight, bookingDate: "2026-10-30", scheduledTime: "01:59" }), true);
  assert.equal(isWithinHappyHour({ ...overnight, bookingDate: "2026-10-30", scheduledTime: "02:00" }), false);
  assert.equal(isWithinHappyHour({ ...overnight, bookingDate: "2026-10-30", scheduledTime: "23:00" }), false);
});

test("unscheduled queue bookings use the server's current shop-local time", () => {
  const offer = { startTime: "12:00", endTime: "15:00", days: ["Thu"] };
  assert.equal(isWithinHappyHour({ ...offer, now: new Date("2026-10-29T06:30:00Z") }), true);
  assert.equal(isWithinHappyHour({ ...offer, now: new Date("2026-10-29T09:30:00Z") }), false);
});
