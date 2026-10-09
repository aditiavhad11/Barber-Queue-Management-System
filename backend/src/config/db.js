import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
export const pool = mysql.createPool({ host: (process.env.DB_HOST || "localhost").trim(), port: Number(process.env.DB_PORT || 3306), user: (process.env.DB_USER || "root").trim(), password: process.env.DB_PASSWORD || "", database: (process.env.DB_NAME || "barber_queue").trim(), waitForConnections: true, connectionLimit: 10, decimalNumbers: true });
export async function healthcheck(){ const [rows] = await pool.query("SELECT 1 AS ok"); return rows[0]?.ok === 1; }
