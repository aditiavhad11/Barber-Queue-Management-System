import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBookingStatusTransition,
  assertQueueStatusTransition,
  BOOKING_STATUSES,
  QUEUE_STATUSES,
} from "../src/services/bookingStateMachine.js";
import { writeAuditLog } from "../src/services/auditLogService.js";
import { pool } from "../src/config/db.js";
import { findBookings } from "../src/models/bookingModel.js";
import { recordBookingTransition } from "../src/services/bookingStateMachine.js";

test.after(async () => {
  await pool.end();
});

test("booking state machine permits existing payment lifecycle transitions", () => {
  assert.ok(BOOKING_STATUSES.includes("payment_submitted"));
  assert.doesNotThrow(() => assertBookingStatusTransition("payment_submitted", "accepted"));
  assert.doesNotThrow(() => assertBookingStatusTransition("payment_submitted", "rejected"));
  assert.doesNotThrow(() => assertBookingStatusTransition("payment_submitted", "cancelled"));
  assert.doesNotThrow(() => assertBookingStatusTransition(null, "payment_submitted"));
});

test("booking state machine rejects backward and terminal transitions", () => {
  assert.throws(
    () => assertBookingStatusTransition("accepted", "payment_submitted"),
    (error) => error.code === "INVALID_BOOKING_TRANSITION",
  );
  assert.throws(
    () => assertBookingStatusTransition("accepted", "completed"),
    (error) => error.code === "INVALID_BOOKING_STATUS",
  );
  assert.throws(
    () => assertBookingStatusTransition("rejected", "accepted"),
    (error) => error.code === "INVALID_BOOKING_TRANSITION",
  );
});

test("queue state machine permits live, scheduled and emergency workflows", () => {
  assert.ok(QUEUE_STATUSES.includes("Emergency Closed"));
  assert.doesNotThrow(() => assertQueueStatusTransition(null, "Prebooked"));
  assert.doesNotThrow(() => assertQueueStatusTransition("Waiting", "Your Turn"));
  assert.doesNotThrow(() => assertQueueStatusTransition("In Service", "Completed"));
  assert.doesNotThrow(() => assertQueueStatusTransition("Emergency Closed", "Waiting"));
  assert.doesNotThrow(() => assertQueueStatusTransition("Scheduled", "Emergency Closed"));
});

test("queue state machine rejects backward and terminal transitions", () => {
  assert.throws(
    () => assertQueueStatusTransition("Completed", "Waiting"),
    (error) => error.code === "INVALID_QUEUE_TRANSITION",
  );
  assert.throws(
    () => assertQueueStatusTransition("Cancelled", "Your Turn"),
    (error) => error.code === "INVALID_QUEUE_TRANSITION",
  );
  assert.throws(
    () => assertQueueStatusTransition("Waiting", "invented"),
    (error) => error.code === "INVALID_QUEUE_STATUS",
  );
});

test("audit log stores actor identity for non-user actors in metadata", async () => {
  let captured;
  const connection = {
    async query(sql, params) {
      captured = { sql, params };
      return [{ affectedRows: 1 }, []];
    },
  };
  await writeAuditLog(connection, {
    actorId: "co-owner-1",
    actorRole: "co_owner",
    action: "queue_status_changed",
    entityType: "payment_booking",
    entityId: "booking-1",
    metadata: { before: "Waiting", after: "Your Turn" },
  });
  assert.equal(captured.params[0], null);
  assert.equal(captured.params[1], "queue_status_changed");
  assert.deepEqual(JSON.parse(captured.params[4]).actor, {
    id: "co-owner-1",
    role: "co_owner",
  });
});

test("transition recorder locks current state and audits before/after details", async () => {
  const statements = [];
  const connection = {
    async query(sql, params) {
      statements.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT status,queue_status"))
        return [[{ status: "accepted", queue_status: "Waiting" }], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  await recordBookingTransition(connection, {
    bookingId: "booking-1",
    toQueueStatus: "Your Turn",
    actorId: "owner-1",
    actorRole: "owner",
    action: "queue_called",
  });
  assert.match(statements[0].sql, /FOR UPDATE/);
  const audit = statements.find((statement) => statement.sql.includes("INSERT INTO audit_logs"));
  assert.ok(audit);
  const metadata = JSON.parse(audit.params[4]);
  assert.deepEqual(metadata.before, { bookingStatus: "accepted", queueStatus: "Waiting" });
  assert.deepEqual(metadata.after, { bookingStatus: "accepted", queueStatus: "Your Turn" });
});

test("accepted legacy records with null queue status transition from Waiting", async () => {
  const statements = [];
  const connection = {
    async query(sql, params) {
      statements.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT status,queue_status"))
        return [[{ status: "accepted", queue_status: null }], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  await recordBookingTransition(connection, {
    bookingId: "legacy-booking",
    toQueueStatus: "Cancelled",
    actorRole: "owner",
  });
  const audit = statements.find((statement) => statement.sql.includes("INSERT INTO audit_logs"));
  assert.equal(JSON.parse(audit.params[4]).before.queueStatus, "Waiting");
});

test("booking query model excludes soft-deleted payment records", async () => {
  const originalQuery = pool.query;
  let executedSql = "";
  pool.query = async (sql) => {
    executedSql = String(sql);
    return [[], []];
  };
  try {
    await findBookings("b.customer_id=? OR b.shop_id=?", ["customer-1", "shop-1"], "LIMIT 10");
    assert.match(executedSql, /WHERE \(b\.customer_id=\? OR b\.shop_id=\?\) AND b\.deleted_at IS NULL/);
  } finally {
    pool.query = originalQuery;
  }
});
