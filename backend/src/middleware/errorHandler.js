import { AppError } from "../utils/AppError.js";

/**
 * Central Express error handling middleware.
 * Ensures consistent error JSON shape across all endpoints:
 * {
 *   message: string,
 *   code: string,
 *   data?: any,
 *   bookingId?: string,
 *   amount?: number,
 *   errors?: Array<{ field: string, message: string }>
 * }
 */
export function errorHandler(err, _req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Handle Zod validation errors
  if (err.name === "ZodError" || Array.isArray(err.issues)) {
    const fieldErrors = (err.issues || []).map((issue) => ({
      field: issue.path.join(".") || "root",
      message: issue.message,
    }));
    return res.status(400).json({
      message: fieldErrors[0]?.message || "Validation failed.",
      code: "VALIDATION_ERROR",
      errors: fieldErrors,
      data: { errors: fieldErrors },
    });
  }

  // Handle malformed JSON body parse error
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      message: "Malformed JSON payload in request body.",
      code: "INVALID_JSON",
    });
  }

  // Handle MySQL errors
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      message: err.message || "A record with these details already exists.",
      code: "DUPLICATE_ENTRY",
    });
  }

  const status = Number(err.status || err.statusCode) || 500;
  const isServerFault = status >= 500;

  if (isServerFault && process.env.NODE_ENV !== "test") {
    console.error("Central Error Handler caught:", err);
  }

  const code =
    err.code || (isServerFault ? "INTERNAL_SERVER_ERROR" : "ERROR");
  const message =
    err.message || (isServerFault ? "Internal server error." : "Something went wrong.");

  const response = {
    message,
    code,
  };

  if (err.data !== undefined && err.data !== null) {
    response.data = err.data;
  }

  // Guarantee backwards compatibility for bookingId, amount, and errors
  const bookingId =
    err.bookingId ?? (err.data && typeof err.data === "object" ? err.data.bookingId : undefined);
  if (bookingId !== undefined) {
    response.bookingId = bookingId;
  }

  const amount =
    err.amount ?? (err.data && typeof err.data === "object" ? err.data.amount : undefined);
  if (amount !== undefined) {
    response.amount = amount;
  }

  const errors =
    err.errors ?? (err.data && typeof err.data === "object" ? err.data.errors : undefined);
  if (errors !== undefined) {
    response.errors = errors;
  }

  res.status(status).json(response);
}

export default errorHandler;

