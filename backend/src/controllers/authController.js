import {
  requestOtp,
  verifyOtp,
  passwordLogin,
  shopLogin,
} from "../models/authModel.js";

export const requestOtpController = async (req, res) => {
  try {
    res.json(await requestOtp(req.body));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

export const verifyOtpController = async (req, res) => {
  try {
    res.json(await verifyOtp(req.body));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

export const passwordLoginController = async (req, res) => {
  try {
    res.json(await passwordLogin(req.body));
  } catch (e) {
    res.status(401).json({ message: e.message });
  }
};

export const shopLoginController = async (req, res) => {
  try {
    res.json(await shopLogin(req.body));
  } catch (e) {
    res.status(401).json({ message: e.message });
  }
};


export const listUsersController = async (req, res) => {
  try {
    const { pool } = await import("../config/db.js");
    const [rows] = await pool.query(
      "SELECT id,name,email,role,status,created_at,updated_at FROM users WHERE role IN ('owner','customer') ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
