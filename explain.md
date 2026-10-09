# Barber Queue Management System

A multi-role web app that replaces physical waiting lines at barbershops. Customers book a service online, pay via UPI, and get a live queue token with an estimated wait time. Shop owners manage their shop, barbers, services, and the live queue. An admin approves shops and handles complaints.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, React Router 7, Tailwind CSS 3, Axios, lucide-react |
| Backend | Node.js, Express 5 (ES modules), JWT, bcryptjs, Nodemailer |
| Database | MySQL (`mysql2`) |
| Media | Cloudinary (shop/barber photos, uploaded from the frontend) |
| Email | Gmail SMTP (OTP, booking confirmations, owner-to-customer messages) |

## Roles

- **Customer** (`/app/*`): browse approved shops, book services, pay, track queue, review/complain.
- **Owner** (`/owner/*`): create and manage shops, barbers, services, hours, policies, queue, payments, earnings.
- **Shop** (`/shop/*`): shop-level staff login (separate `shop-login`), same operational pages as owner, scoped to one shop.
- **Admin** (`/admin/*`): approve/reject/suspend shops, view owners and customers, handle complaints.

## Core Flow

1. Customer signs in (password or email OTP) and picks a shop.
2. Selects services and a barber (can book for someone else with name, mobile, email).
3. Requests a payment quote, pays via the owner's UPI QR, and submits payment (`payment_submitted`).
4. Owner sees it under pending bookings and accepts or rejects it.
5. On accept, a queue ticket is created (tokens per shop: A001, A002, ...).
6. Customer tracks the position in **My Queue**: position 1 means "Your Turn", otherwise "Waiting".
7. Owner marks the ticket in service, completed, skipped (moved to the end of that barber's queue), or no-show.
8. After completion, the customer can leave a review or report an issue (goes to admin).

## Key Business Rules

- Wait time (ETA) = sum of service durations of active customers ahead (`frontend/src/utils/eta.js`). `useLiveWait` counts it down each minute and persists it in `localStorage`.
- Multiple services are grouped into one ticket with combined price and duration; extra services can be added to an active ticket.
- A customer can have only one active booking for themselves, but can book for others in parallel.
- New shops start as `pending` and only appear to customers after admin approval (`approved`; also `rejected`, `suspended`).
- Owner contact messages go to the booking recipient (beneficiary email, else the customer's email).

## Authentication

- Register with name, email, password, then verify via OTP. Login with password or OTP.
- bcrypt-hashed passwords; JWT stored in the browser (`localStorage`).
- `auth` middleware verifies the Bearer token; `requireRole(...)` enforces role access per route.
- Admin identity is set by `ADMIN_EMAIL` in `backend/.env`.
- If SMTP is not configured, a dev fallback OTP (`DEV_OTP=123456`) is used. Never rely on it in production.

## Project Structure

```
backend/src/
  server.js              Express app, CORS, route mounting, error handler
  config/                db.js (MySQL pool), mail.js, ensureSchema.js (auto-adds columns/tables at startup)
  middleware/auth.js     JWT auth + role guard
  routes/                auth, shops, bookings, reviews, notifications, admin
  controllers/           business logic per domain (shop, booking, payment, review, notification, auth)
  models/                authModel.js, bookingModel.js
frontend/src/
  App.jsx                All routes, grouped by role layout
  layouts/               Public, Customer, Owner, Shop, Admin
  pages/                 customer/, owner/, admin/, auth/, public/
  components/            common/ (ShopCard, LiveWait...), owner/ (PhotoUploader, WeeklyHours, LocationPicker, UpiSettings)
  hooks/                 useAuth, useOwnerStore, useLiveWait
  services/              api.js (Axios), upload.js (Cloudinary)
  utils/                 eta, time, location, closedDays, relativeTime
database/
  schema.sql             Full schema
  migrations/            password auth, UPI QR payment, queue reviews
```

## API Overview (`/api`)

| Prefix | Purpose |
|---|---|
| `/auth` | request-otp, verify-otp, login-password, shop-login, user listing (admin) |
| `/shops` | CRUD for shops, services, barbers; admin status change; resubmit after rejection |
| `/bookings` | payment-quote, payment-submit, mine, pending, queue, accept/reject, UPI settings |
| `/reviews` | create review (customer), list approved |
| `/notifications` | contact customer, booking notifications |
| `/admin` | admin listings (shops, etc.) |
| `/health` | DB healthcheck |

## Database (MySQL, `barber_queue`)

Main tables: `users`, `otp_codes`, `shops`, `shop_photos`, `services`, `barbers`, `barber_services`, `customers`, `queue_entries`, `payments`, `refunds`, `reviews`, `booking_reviews`, `complaints`, `notifications`, `audit_logs`, `payment_bookings`.

Queue ticket statuses: `waiting`, `your_turn`, `in_service`, `completed`, `skipped`, `no_show`, `cancelled`.

## Running Locally

1. Create the MySQL DB `barber_queue` and import `database/schema.sql`.
2. `cp backend/.env.example backend/.env` and set `JWT_SECRET`, DB credentials, and optionally Gmail SMTP.
3. `cp frontend/.env.example frontend/.env` and set Cloudinary values if using photo uploads.
4. Backend: `cd backend && npm install && npm run dev` (port 4000, check `/api/health`).
5. Frontend: `cd frontend && npm install && npm run dev` (port 5173).
6. On Windows, `START.bat` launches both.

## Notes

- Server exits at startup if `JWT_SECRET` is missing.
- `ensureSchema` patches the DB on boot, so older databases mostly upgrade themselves.
- Other docs in the repo: `IMPLEMENTED_REQUIREMENTS.md`, `PASSWORD_LOGIN_SETUP.md`, `TESTING.md`, `START-README.txt`.
