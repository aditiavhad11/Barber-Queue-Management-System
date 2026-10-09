# Barber Queue Platform

## Project structure

- `frontend/` — React + Vite customer, owner, shop and admin panels. Existing UI/design is preserved.
- `backend/` — Node.js + Express + MySQL API organized in MVC-style layers (`models`, `controllers`, `routes`, `middleware`, `config`).
- `database/schema.sql` — MySQL schema.

## Run frontend

```bash
cd frontend
npm install
npm run dev
```

## Run backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Configure MySQL and email OTP credentials in `backend/.env`.

## Notification rules

Admin platform announcements are targeted to **Owner + Customer** only. Owner/shop operational notifications remain scoped to their shop; customer queue/payment notifications remain scoped to the relevant customer.

## Customer reviews

Customers now have a **Reviews** item in their panel. A review can only be submitted for that customer's completed queue entry.

## Final shop persistence setup

The final frontend is wired to the included Express/MySQL backend. Start MySQL, import `database/schema.sql`, configure `backend/.env`, then start the backend on port 4000. Start the frontend on Vite (the included Vite proxy forwards `/api` to `http://localhost:4000`).

A shop created from Owner → My Shops → Add New Shop is persisted to MySQL, including its credentials, photos, services, barbers, hours, availability and policies. Owner shops are reloaded from MySQL after login/refresh. Admin approval/rejection/suspension/reactivation and Owner shop deletion also update MySQL.

Opening hours use an explicit AM/PM selector in the Owner create/edit forms. The database stores the normalized 24-hour `TIME` value so comparisons and ETA calculations remain reliable.

If an old browser session is open, clear the site's local storage once before testing the final clean flow. The current mock-state key is `barberQueuePlatform:v12`.

## UPI QR payments

Customers pay using the shop owner's original UPI QR image. The customer sees the exact uploaded image, sends the exact server-calculated amount, then taps **Maine pay kar diya**. The booking stays in **payment submitted** until the owner checks the shop's UPI app and accepts it. Only ACCEPT creates the existing queue ticket and token.

Owner payment setup is available under **Payments**. Upload a JPG, PNG or WEBP QR image. A shop without a QR cannot accept new bookings.

The server enforces duplicate-submission protection, a 30-minute rebooking block after a decline, server-side service pricing, owner/shop authorization, and small unused-paise amount differences when the same shop has another pending booking for the same amount within 15 minutes.
