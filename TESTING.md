# Handover testing checklist

## Notifications
- Admin announcements are targeted only to `owner` and `customer` sessions.
- Owner/shop operational notifications remain shop-scoped.
- Customer queue/payment notifications remain customer-scoped.

## Reviews
1. Customer joins a queue after mock payment.
2. Owner changes the queue status to `Completed`.
3. Customer opens **Reviews**.
4. The completed visit appears.
5. Customer submits a rating/review.
6. The review appears in the relevant shop's Owner/Admin review views.

## Payment visibility
A successful mock payment is stored against the selected `shopId`, `customerId` and `queueId`. It therefore appears in the customer's Bookings and the relevant Owner/Admin payment views.

## Storage
Frontend mock state uses `barberQueuePlatform:v11`. This intentionally starts the handover with a clean dataset rather than carrying previous demo records.

## Final shop-creation regression checks

1. Start MySQL and import `database/schema.sql`.
2. Configure `backend/.env` and start the backend on port 4000.
3. Start the frontend on Vite; `/api` is proxied to the backend.
4. Create/sign in as an Owner with email OTP.
5. Open **My Shops → Add New Shop**.
6. Enter opening/closing times using the explicit AM/PM selectors.
7. Submit. Confirm the shop is stored in MySQL `shops` and child rows are stored in `shop_photos`, `services`, `barbers`, and `barber_services`.
8. Refresh the Owner panel. The newly created shop remains selected and **Shop Overview** must show that shop, not "No shop created".
9. Create a second shop under the same Owner and switch between them. Each selected shop must drive the Owner pages.
10. Sign in as Admin. The submitted shop must appear in Shop Approvals. Approve/reject/suspend/reactivate and confirm the MySQL `shops.status` / `active` values change.
11. Delete a shop from Owner → My Shops and confirm its database row and cascading child rows are removed.

## UPI QR payment flow

1. Owner: open Payments for the selected shop and upload the shop's original UPI QR image.
2. Customer: select shop, services and barber.
3. Customer: open the Payment step and verify the exact amount shown beside the QR.
4. Customer: pay that exact amount in a UPI app, then press **Maine pay kar diya**.
5. Customer: stays on the processing page while the server polls the booking.
6. Owner: open Queue and verify the amount in the shop's UPI app.
7. Owner ACCEPT: the booking receives the existing token and enters the selected barber's queue.
8. Owner DECLINE: the booking is rejected and the same customer/beneficiary is blocked from rebooking that shop for 30 minutes.

### Required checks

- Double-click **Maine pay kar diya**: only one pending booking is created.
- Double-click owner ACCEPT or use two owner tabs: only one queue ticket/token is created.
- Wrong customer tries to open another customer's booking: API returns 404.
- Wrong owner tries to accept another owner's booking: API returns 404.
- Same shop + same amount within 15 minutes: the next booking gets the next unused paise amount.
- No QR uploaded: customer sees **This shop can't take bookings yet.**
- Pending booking older than 15 minutes: customer sees **Shop ne abhi confirm nahi kiya, dobara try karo**.
