import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveOfferStatus,
  hasActiveNewCustomerOfferReservation,
  hasSuccessfulCompletedBooking,
  isOfferValueWithinCap,
  isSuccessfulCompletedBooking,
} from "../src/utils/offerEligibility.js";

test("only accepted/paid completed queue bookings count as a successful booking", () => {
  assert.equal(isSuccessfulCompletedBooking({ status: "accepted", queue_status: "Completed" }), true);
  assert.equal(isSuccessfulCompletedBooking({ status: "paid", queue_status: "Completed" }), true);
  assert.equal(hasSuccessfulCompletedBooking([
    { status: "payment_submitted", queue_status: null },
    { status: "rejected", queue_status: null },
    { status: "failed", queue_status: null },
    { status: "cancelled", queue_status: "Cancelled" },
    { status: "accepted", queue_status: "Waiting" },
    { status: "accepted", queue_status: "No Show" },
  ]), false);
  assert.equal(hasSuccessfulCompletedBooking([{ status: "accepted", queue_status: "Completed" }]), true);
});

test("pending and active new-customer bookings reserve benefits without counting as completed", () => {
  assert.equal(hasActiveNewCustomerOfferReservation([{ status: "payment_submitted" }]), true);
  assert.equal(hasActiveNewCustomerOfferReservation([{ status: "accepted", queue_status: "Waiting" }]), true);
  assert.equal(hasActiveNewCustomerOfferReservation([{ status: "accepted", queue_status: "Cancelled" }]), false);
  assert.equal(hasActiveNewCustomerOfferReservation([{ status: "rejected", queue_status: null }]), false);
  assert.equal(hasActiveNewCustomerOfferReservation([{ status: "failed", queue_status: null }]), false);
});

test("configured maximum reward value caps are enforced while an omitted cap stays unlimited", () => {
  assert.equal(isOfferValueWithinCap(250, 250), true);
  assert.equal(isOfferValueWithinCap(250.01, 250), false);
  assert.equal(isOfferValueWithinCap(900, null), true);
});

test("offer status uses the server timestamp for scheduled, active, expired, and inactive states", () => {
  const serverNow = "2026-10-29T12:00:00Z";
  assert.equal(effectiveOfferStatus({ status: "active", startsAt: "2026-10-30T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", serverNow }), "scheduled");
  assert.equal(effectiveOfferStatus({ status: "active", startsAt: "2026-10-29T11:00:00Z", endsAt: "2026-10-29T12:00:00Z", serverNow }), "active");
  assert.equal(effectiveOfferStatus({ status: "active", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-29T11:59:59Z", serverNow }), "expired");
  assert.equal(effectiveOfferStatus({ status: "paused", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", serverNow }), "paused");
  assert.equal(effectiveOfferStatus({ status: "active", startsAt: null, endsAt: "2026-11-01T00:00:00Z", serverNow }), "scheduled");
  assert.equal(effectiveOfferStatus({ status: "active", startsAt: "2026-10-01T00:00:00Z", endsAt: null, serverNow }), "expired");
});
