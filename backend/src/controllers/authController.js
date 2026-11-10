import {
  requestOtp,
  verifyOtp,
  resetPassword,
  passwordLogin,
  shopLogin,
} from "../models/authModel.js";
import { AppError } from "../utils/AppError.js";

export const requestOtpController = async (req, res) => {
  try {
    res.json(await requestOtp(req.body));
  } catch (e) {
    throw AppError.badRequest(e.message, "OTP_REQUEST_FAILED");
  }
};

export const verifyOtpController = async (req, res) => {
  try {
    res.json(await verifyOtp(req.body));
  } catch (e) {
    throw AppError.badRequest(
      "Unable to verify code. Check details or request another code.",
      "OTP_VERIFY_FAILED",
    );
  }
};

export const resetPasswordController = async (req, res) => {
  try {
    res.json(await resetPassword(req.body));
  } catch (e) {
    const message = e.message.startsWith("Password must")
      ? e.message
      : "Unable to reset password. Check the code and try again.";
    throw AppError.badRequest(message, "PASSWORD_RESET_FAILED");
  }
};

export const passwordLoginController = async (req, res) => {
  try {
    res.json(await passwordLogin(req.body));
  } catch (e) {
    throw AppError.unauthorized("Invalid email or password.", "INVALID_CREDENTIALS");
  }
};

export const shopLoginController = async (req, res) => {
  try {
    res.json(await shopLogin(req.body));
  } catch (e) {
    throw AppError.unauthorized("Invalid shop or manager credentials.", "INVALID_CREDENTIALS");
  }
};

export const listUsersController = async (req, res) => {
  const { pool } = await import("../config/db.js");
  const [rows] = await pool.query(
    "SELECT id,name,email,role,status,created_at,updated_at FROM users WHERE role IN ('owner','customer') ORDER BY created_at DESC",
  );
  res.json(rows);
};
