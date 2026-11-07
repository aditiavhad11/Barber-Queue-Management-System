/**
 * Standard Application Error class for consistent error responses.
 *
 * Supported call signatures:
 * 1. new AppError(status, code, data, message)   - e.g. new AppError(409, "SLOT_TAKEN", { bookingId })
 * 2. new AppError(message, status, code, data)   - e.g. new AppError("Slot taken", 409, "SLOT_TAKEN", { bookingId })
 * 3. new AppError({ message, status, code, data })
 */
export class AppError extends Error {
  constructor(firstArg, secondArg, thirdArg, fourthArg) {
    let status = 500;
    let code = "INTERNAL_ERROR";
    let data = null;
    let message = "An unexpected error occurred.";

    if (firstArg && typeof firstArg === "object" && !(firstArg instanceof Error)) {
      status = Number(firstArg.status || firstArg.statusCode) || 500;
      code = firstArg.code || "INTERNAL_ERROR";
      data = firstArg.data || null;
      message = firstArg.message || message;
    } else if (typeof firstArg === "number") {
      // Signature: (status, code, data, message)
      status = firstArg;
      code = typeof secondArg === "string" ? secondArg : "ERROR";
      data = (thirdArg !== undefined && thirdArg !== null) ? thirdArg : null;
      message =
        typeof fourthArg === "string"
          ? fourthArg
          : data && typeof data === "object" && data.message
            ? data.message
            : typeof secondArg === "string"
              ? secondArg
              : message;
    } else {
      // Signature: (message, status, code, data)
      message = typeof firstArg === "string" ? firstArg : message;
      if (typeof secondArg === "number") {
        status = secondArg;
      }
      if (typeof thirdArg === "string") {
        code = thirdArg;
      }
      if (fourthArg !== undefined && fourthArg !== null) {
        data = fourthArg;
      } else if (thirdArg && typeof thirdArg === "object") {
        data = thirdArg;
      }
    }

    super(message);
    this.name = "AppError";
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.data = data;
    this.isOperational = true;

    // Attach custom data properties directly to error instance for backward compatibility
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if (data.bookingId !== undefined && this.bookingId === undefined) {
        this.bookingId = data.bookingId;
      }
      if (data.amount !== undefined && this.amount === undefined) {
        this.amount = data.amount;
      }
      if (data.errors !== undefined && this.errors === undefined) {
        this.errors = data.errors;
      }
    }

    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = "Bad request", code = "BAD_REQUEST", data = null) {
    return new AppError(message, 400, code, data);
  }

  static unauthorized(message = "Unauthorized", code = "UNAUTHORIZED", data = null) {
    return new AppError(message, 401, code, data);
  }

  static forbidden(message = "Forbidden", code = "FORBIDDEN", data = null) {
    return new AppError(message, 403, code, data);
  }

  static notFound(message = "Not found", code = "NOT_FOUND", data = null) {
    return new AppError(message, 404, code, data);
  }

  static conflict(message = "Conflict", code = "CONFLICT", data = null) {
    return new AppError(message, 409, code, data);
  }

  static tooManyRequests(message = "Too many requests", code = "TOO_MANY_REQUESTS", data = null) {
    return new AppError(message, 429, code, data);
  }

  static internal(message = "Internal server error", code = "INTERNAL_ERROR", data = null) {
    return new AppError(message, 500, code, data);
  }
}

export default AppError;

