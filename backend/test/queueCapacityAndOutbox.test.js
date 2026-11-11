import test from "node:test";
import assert from "node:assert/strict";
import { localDateKey } from "../src/utils/time.js";
import {
  hasQueueCapacity,
  QUEUE_ERRORS,
  validateQueueCapacity,
} from "../src/services/queueCapacityService.js";
import { executeBookingAcceptance } from "../src/services/bookingAcceptService.js";
import { MYSQL_SESSION_TIME_ZONE } from "../src/config/db.js";
import {
  minutesUntilAppointment,
  nowTimeIST,
  todayIST,
} from "../src/utils/time.js";
import {
  createRedisConnectionOptions,
  emergencyClosureJobId,
  enqueuePendingEmergencyClosureNotifications,
  processEmergencyClosureNotificationJob,
  stopEmergencyClosureWorker,
} from "../src/jobs/emergencyClosureQueue.js";

test.after(async () => {
  await stopEmergencyClosureWorker();
});

function createCapacityDatabase(queueLimit) {
  const bookings = [];
  let locked = false;
  const waiters = [];
  const releaseLock = () => {
    const next = waiters.shift();
    if (next) next();
    else locked = false;
  };
  const acquireLock = async () => {
    if (!locked) {
      locked = true;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
  };
  const createConnection = () => {
    let inTransaction = false;
    let holdsLock = false;
    return {
      async beginTransaction() {
        inTransaction = true;
      },
      async query(sql, params = []) {
        if (String(sql).includes("FROM barbers")) {
          if (String(sql).includes("FOR UPDATE")) {
            await acquireLock();
            holdsLock = true;
          }
          return [[{ id: "barber-1", queue_limit: queueLimit }], []];
        }
        if (String(sql).includes("SUM(CASE WHEN status='accepted'")) {
          const excludeId = params.length > 3 ? params[3] : null;
          const eligible = bookings.filter(
            (booking) =>
              booking.id !== excludeId &&
              booking.bookingDate === params[2] &&
              (booking.status === "accepted" || booking.status === "payment_submitted"),
          );
          return [[{
            committed_count: eligible.filter((booking) => booking.status === "accepted").length,
            reserved_count: eligible.filter((booking) => booking.status === "payment_submitted").length,
          }], []];
        }
        if (String(sql).includes("INSERT INTO payment_bookings")) {
          bookings.push({
            id: params[0],
            bookingDate: params[1],
            status: "payment_submitted",
          });
          return [{ affectedRows: 1 }, []];
        }
        return [[], []];
      },
      async commit() {
        inTransaction = false;
        if (holdsLock) {
          holdsLock = false;
          releaseLock();
        }
      },
      async rollback() {
        if (inTransaction) inTransaction = false;
        if (holdsLock) {
          holdsLock = false;
          releaseLock();
        }
      },
      release() {
        if (holdsLock) {
          holdsLock = false;
          releaseLock();
        }
      },
    };
  };
  return { bookings, createConnection };
}

test("queue capacity calculation uses one consistent count and error", async () => {
  assert.equal(hasQueueCapacity({ queueLimit: 2, committedCount: 1, reservedCount: 0 }), true);
  assert.equal(hasQueueCapacity({ queueLimit: 2, committedCount: 1, reservedCount: 1 }), false);
  const database = createCapacityDatabase(1);
  const connection = database.createConnection();
  database.bookings.push({ id: "pending-1", bookingDate: localDateKey(), status: "payment_submitted" });
  await assert.rejects(
    validateQueueCapacity(connection, {
      shopId: "shop-1",
      barberId: "barber-1",
      bookingDate: localDateKey(),
      lock: false,
    }),
    (error) => error.code === QUEUE_ERRORS.FULL.code && error.message === QUEUE_ERRORS.FULL.message,
  );
});

test("queue-full and appointment-overlap messages use distinct centralized codes", () => {
  assert.equal(QUEUE_ERRORS.FULL.code, "QUEUE_FULL");
  assert.match(QUEUE_ERRORS.FULL.message, /queue is full/i);
  assert.equal(QUEUE_ERRORS.APPOINTMENT_OVERLAP.code, "APPOINTMENT_OVERLAP");
  assert.doesNotMatch(QUEUE_ERRORS.APPOINTMENT_OVERLAP.message, /queue is full/i);
});

test("concurrent payment reservations serialize on the barber row and never exceed capacity", async () => {
  const database = createCapacityDatabase(1);
  const submit = async (id) => {
    const connection = database.createConnection();
    try {
      await connection.beginTransaction();
      await validateQueueCapacity(connection, {
        shopId: "shop-1",
        barberId: "barber-1",
        bookingDate: localDateKey(),
      });
      await connection.query("INSERT INTO payment_bookings", [id, localDateKey()]);
      await connection.commit();
      return id;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  const results = await Promise.allSettled([submit("payment-1"), submit("payment-2")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected")[0].reason.code, "QUEUE_FULL");
  assert.equal(database.bookings.length, 1);
});

test("booking acceptance commits or rolls back and always releases its connection", async () => {
  const makeConnection = () => {
    const calls = [];
    return {
      calls,
      async beginTransaction() { calls.push("begin"); },
      async commit() { calls.push("commit"); },
      async rollback() { calls.push("rollback"); },
      release() { calls.push("release"); },
    };
  };
  const acceptedConnection = makeConnection();
  const accepted = await executeBookingAcceptance(
    acceptedConnection,
    { id: "booking-1" },
    "A001",
    async () => ({ accepted: true }),
  );
  assert.deepEqual(accepted, { accepted: true });
  assert.deepEqual(acceptedConnection.calls, ["begin", "commit", "release"]);

  const failedConnection = makeConnection();
  await assert.rejects(
    executeBookingAcceptance(
      failedConnection,
      { id: "booking-2" },
      "",
      async () => { throw new Error("capacity lookup failed"); },
    ),
    /capacity lookup failed/,
  );
  assert.deepEqual(failedConnection.calls, ["begin", "rollback", "release"]);
});

test("closure email retries skip recipients already marked sent", async () => {
  const outbox = [
    { id: "booking-1", email: "one@example.test", emailSent: false },
    { id: "booking-2", email: "two@example.test", emailSent: false },
  ];
  const sentTo = [];
  let failSecond = true;
  const query = async (sql, params = []) => {
    if (String(sql).startsWith("SELECT n.booking_id"))
      return [outbox.filter((row) => !row.emailSent).map(({ id, email }) => ({ id, email }))];
    if (String(sql).includes("UPDATE emergency_closure_notifications")) {
      const row = outbox.find((item) => item.id === params[1]);
      if (!row.emailSent) {
        row.emailSent = true;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }
    throw new Error("Unexpected outbox query.");
  };
  const sendEmail = async (email) => {
    sentTo.push(email);
    if (email === "two@example.test" && failSecond) {
      failSecond = false;
      throw new Error("temporary SMTP failure");
    }
    return true;
  };
  const event = { shopId: "shop-1", closure: { id: "closure-1", reason: "repair" } };
  await assert.rejects(processEmergencyClosureNotificationJob(event, { query, sendEmail }), /temporary SMTP failure/);
  const result = await processEmergencyClosureNotificationJob(event, { query, sendEmail });
  assert.deepEqual(sentTo, ["one@example.test", "two@example.test", "two@example.test"]);
  assert.equal(result.bookingsProcessed, 1);
  assert.equal(outbox.every((row) => row.emailSent), true);
});

test("closure reconciliation deduplicates jobs and retries failed Redis jobs", async () => {
  const jobId = emergencyClosureJobId("shop-1", "closure-1");
  const jobs = new Map();
  let addCount = 0;
  let retryCount = 0;
  let failAdd = false;
  const queue = {
    async getJob(id) { return jobs.get(id) || null; },
    async add(name, data, options) {
      addCount += 1;
      if (failAdd) throw new Error("Redis unavailable");
      jobs.set(options.jobId, {
        async getState() { return "waiting"; },
      });
      return { id: options.jobId };
    },
  };
  const query = async () => [[{
    id: "closure-1",
    shop_id: "shop-1",
    reason: "repair",
    start_at: new Date(),
    end_at: null,
  }]];
  assert.equal(await enqueuePendingEmergencyClosureNotifications({ query, queue }), 1);
  assert.equal(await enqueuePendingEmergencyClosureNotifications({ query, queue }), 0);
  assert.equal(addCount, 1);

  jobs.set(jobId, {
    async getState() { return "failed"; },
    async retry(state) { assert.equal(state, "failed"); retryCount += 1; },
  });
  assert.equal(await enqueuePendingEmergencyClosureNotifications({ query, queue }), 1);
  assert.equal(retryCount, 1);

  jobs.delete(jobId);
  failAdd = true;
  await assert.rejects(enqueuePendingEmergencyClosureNotifications({ query, queue }), /Redis unavailable/);
  failAdd = false;
  assert.equal(await enqueuePendingEmergencyClosureNotifications({ query, queue }), 1);
});

test("Redis connection retries with capped backoff and stops retrying in tests", () => {
  const options = createRedisConnectionOptions({ NODE_ENV: "production" });
  assert.equal(options.retryStrategy(1), 1000);
  assert.equal(options.retryStrategy(100), 30000);
  assert.equal(createRedisConnectionOptions({ NODE_ENV: "test" }).retryStrategy(1), null);
});

test("application and database timezones agree across IST midnight", () => {
  assert.equal(MYSQL_SESSION_TIME_ZONE, "+00:00");
  const beforeMidnight = new Date("2026-11-08T18:29:59.000Z");
  const atMidnight = new Date("2026-11-08T18:30:00.000Z");
  assert.equal(todayIST(beforeMidnight), "2026-11-08");
  assert.equal(nowTimeIST(beforeMidnight), "23:59");
  assert.equal(todayIST(atMidnight), "2026-11-09");
  assert.equal(nowTimeIST(atMidnight), "00:00");
  assert.equal(minutesUntilAppointment("2026-11-09", "00:00", beforeMidnight), 0);
});
