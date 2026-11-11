import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
export const MYSQL_SESSION_TIME_ZONE = "+00:00";
export const pool = mysql.createPool({
  host: (process.env.DB_HOST || "localhost").trim(),
  port: Number(process.env.DB_PORT || 3306),
  user: (process.env.DB_USER || "root").trim(),
  password: process.env.DB_PASSWORD || "",
  database: (process.env.DB_NAME || "barber_queue").trim(),
  timezone: "Z",
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
});
pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${MYSQL_SESSION_TIME_ZONE}'`, (error) => {
    if (error) console.error("Could not set MySQL session timezone to UTC:", error.message);
  });
});
export async function healthcheck() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
