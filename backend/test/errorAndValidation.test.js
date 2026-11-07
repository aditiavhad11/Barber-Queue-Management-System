process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AppError } from "../src/utils/AppError.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { validate } from "../src/middleware/validate.js";
import {
  createReviewSchema,
  createComplaintSchema,
  updateComplaintStatusSchema,
} from "../src/schemas/index.js";

test("AppError supports polymorphic constructor signatures and static helpers", () => {
  // Signature: (status, code, data)
  const err1 = new AppError(409, "SLOT_UNAVAILABLE", { bookingId: "b-123", amount: 250 });
  assert.equal(err1.status, 409);
  assert.equal(err1.code, "SLOT_UNAVAILABLE");
  assert.equal(err1.bookingId, "b-123");
  assert.equal(err1.amount, 250);

  // Signature: (message, status, code, data)
  const err2 = new AppError("Shop is currently closed.", 409, "SHOP_CLOSED", { shopId: 10 });
  assert.equal(err2.message, "Shop is currently closed.");
  assert.equal(err2.status, 409);
  assert.equal(err2.code, "SHOP_CLOSED");
  assert.deepEqual(err2.data, { shopId: 10 });

  // Signature: ({ message, status, code, data })
  const err3 = new AppError({ message: "Bad input", status: 400, code: "INVALID", data: { field: "x" } });
  assert.equal(err3.status, 400);
  assert.equal(err3.code, "INVALID");
  assert.equal(err3.message, "Bad input");

  // Static factories
  assert.equal(AppError.badRequest("Invalid data").status, 400);
  assert.equal(AppError.unauthorized().status, 401);
  assert.equal(AppError.forbidden().status, 403);
  assert.equal(AppError.notFound("Offer not found", "OFFER_NOT_FOUND").status, 404);
  assert.equal(AppError.conflict("Slot taken").status, 409);
  assert.equal(AppError.tooManyRequests().status, 429);
  assert.equal(AppError.internal().status, 500);
});

test("errorHandler middleware formats standard, Zod, and AppError responses consistently", () => {
  const createMockRes = () => {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  // 1. AppError with bookingId and amount
  const res1 = createMockRes();
  const appErr = new AppError("Payment already in progress.", 409, "PAYMENT_PENDING", {
    bookingId: "book-99",
    amount: 500,
  });
  errorHandler(appErr, {}, res1, () => {});
  assert.equal(res1.statusCode, 409);
  assert.equal(res1.body.message, "Payment already in progress.");
  assert.equal(res1.body.code, "PAYMENT_PENDING");
  assert.equal(res1.body.bookingId, "book-99");
  assert.equal(res1.body.amount, 500);

  // 2. Zod validation error
  const res2 = createMockRes();
  let zodError;
  try {
    z.object({ name: z.string().min(3) }).parse({ name: "a" });
  } catch (e) {
    zodError = e;
  }
  errorHandler(zodError, {}, res2, () => {});
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(res2.body.errors));
  assert.equal(res2.body.errors[0].field, "name");

  // 3. MySQL duplicate entry error
  const res3 = createMockRes();
  const mysqlErr = new Error("Duplicate entry 'test@email.com' for key 'users.email'");
  mysqlErr.code = "ER_DUP_ENTRY";
  errorHandler(mysqlErr, {}, res3, () => {});
  assert.equal(res3.statusCode, 409);
  assert.equal(res3.body.code, "DUPLICATE_ENTRY");

  // 4. Fallback internal error
  const res4 = createMockRes();
  const genericErr = new Error("Unexpected crash");
  errorHandler(genericErr, {}, res4, () => {});
  assert.equal(res4.statusCode, 500);
  assert.equal(res4.body.code, "INTERNAL_SERVER_ERROR");
});

test("validate middleware validates and parses schemas correctly", () => {
  const schema = z.object({
    rating: z.coerce.number().min(1).max(5),
  });

  const middleware = validate(schema);

  // Valid body
  let nextCalled = false;
  let receivedError = null;
  const req1 = { body: { rating: "4" } };
  middleware(req1, {}, (err) => {
    nextCalled = true;
    receivedError = err;
  });
  assert.equal(nextCalled, true);
  assert.equal(receivedError, undefined);
  assert.equal(req1.body.rating, 4); // coerced number

  // Invalid body
  let nextError = null;
  const req2 = { body: { rating: "10" } };
  middleware(req2, {}, (err) => {
    nextError = err;
  });
  assert.ok(nextError);
  assert.equal(nextError.name, "ZodError");
});

test("zod schemas for complaints and reviews enforce domain rules", () => {
  // Review rating must be 1 to 5
  assert.throws(() => createReviewSchema.parse({ shopId: "s1", queueId: "q1", rating: 6 }));
  assert.doesNotThrow(() => createReviewSchema.parse({ shopId: "s1", queueId: "q1", rating: 5 }));

  // Staff complaints require targetBarberId
  assert.throws(() =>
    createComplaintSchema.parse({
      shopId: "s1",
      targetType: "staff",
      subject: "Poor cut",
      description: "Hair was cut badly and unevenly.",
    }),
  );

  // Owner complaints must not have targetBarberId
  assert.throws(() =>
    createComplaintSchema.parse({
      shopId: "s1",
      targetType: "owner",
      targetBarberId: "barber-1",
      subject: "Overcharging",
      description: "Prices were not clearly displayed at all.",
    }),
  );

  // Valid owner complaint
  assert.doesNotThrow(() =>
    createComplaintSchema.parse({
      shopId: "s1",
      targetType: "owner",
      subject: "Overcharging",
      description: "Prices were not clearly displayed at all.",
    }),
  );

  // Complaint status transition validation
  assert.throws(() => updateComplaintStatusSchema.parse({ status: "invalid_status" }));
  assert.doesNotThrow(() => updateComplaintStatusSchema.parse({ status: "investigating" }));
});
