import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const configured = Boolean(
  process.env.EMAIL_HOST &&
  process.env.EMAIL_USER &&
  process.env.EMAIL_APP_PASSWORD &&
  !process.env.EMAIL_USER.includes("your-gmail") &&
  !process.env.EMAIL_APP_PASSWORD.includes("your-16-character"),
);

const transport = configured
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 465),
      secure: String(process.env.EMAIL_SECURE || "true") === "true",
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    })
  : null;

export const emailConfigured = configured;

export async function sendOtpEmail(to, otp) {
  if (!transport) return false;

  await transport.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject: "Your Barber Queue verification code",
    text: `Your Barber Queue OTP is ${otp}. It expires in ${process.env.OTP_TTL_MINUTES || 5} minutes.`,
    html: `<p>Your Barber Queue verification code is:</p><h2>${otp}</h2><p>This code expires in ${process.env.OTP_TTL_MINUTES || 5} minutes.</p>`,
  });

  return true;
}

export async function sendCustomerContactEmail(to, data) {
  if (!transport) return false;
  const subject = `Queue update | ${data.shopName || "Barber Queue"} | #${data.token || ""}`;
  await transport.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject,
    text: `Dear ${data.customerName || "Customer"},\n\n${data.message}\n\nBooking details\nToken: #${data.token || "—"}\nShop: ${data.shopName || "—"}\nBarber: ${data.barber || "—"}\nService: ${data.services || "—"}\nStatus: ${data.status || "—"}\n\nRegards,\nBarber Queue Team\n\nThis is an automated notification. Please do not reply to this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#33281f"><h2 style="margin-bottom:8px">Queue update</h2><p>Dear ${data.customerName || "Customer"},</p><p>${String(data.message || "").replace(/\n/g, "<br>")}</p><h3>Booking details</h3><p><b>Token:</b> #${data.token || "—"}<br><b>Shop:</b> ${data.shopName || "—"}<br><b>Barber:</b> ${data.barber || "—"}<br><b>Service:</b> ${data.services || "—"}<br><b>Status:</b> ${data.status || "—"}</p><p>Regards,<br>Barber Queue Team</p><p style="font-size:12px;color:#777">This is an automated notification. Please do not reply to this email.</p></div>`,
  });
  return true;
}

export async function sendBookingNotificationEmail(to, data) {
  if (!transport) return false;
  const subject = data.forSomeoneElse
    ? `${data.bookedBy || "A customer"} booked a slot for you | ${data.shopName || "Barber Queue"}`
    : `Your Barber Queue booking | #${data.token || ""}`;
  const greeting = data.forSomeoneElse
    ? `Dear ${data.recipientName || "Customer"},`
    : `Dear ${data.recipientName || "Customer"},`;
  const intro = data.forSomeoneElse
    ? `${data.bookedBy || "A customer"} has booked a slot for you at ${data.shopName || "the barber shop"}.`
    : `Your queue booking at ${data.shopName || "the barber shop"} has been confirmed.`;
  await transport.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject,
    text: `${greeting}\n\n${intro}\n\nBooking details\nToken: #${data.token || "—"}\nShop: ${data.shopName || "—"}\nBarber: ${data.barber || "—"}\nServices: ${data.services || "—"}\nAmount: ₹${data.amount ?? "—"}\n\nRegards,\nBarber Queue Team\n\nThis is an automated notification. Please do not reply to this email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#33281f"><h2>Booking confirmation</h2><p>${greeting}</p><p>${intro}</p><h3>Booking details</h3><p><b>Token:</b> #${data.token || "—"}<br><b>Shop:</b> ${data.shopName || "—"}<br><b>Barber:</b> ${data.barber || "—"}<br><b>Services:</b> ${data.services || "—"}<br><b>Amount:</b> ₹${data.amount ?? "—"}</p><p>Regards,<br>Barber Queue Team</p><p style="font-size:12px;color:#777">This is an automated notification. Please do not reply to this email.</p></div>`,
  });
  return true;
}
