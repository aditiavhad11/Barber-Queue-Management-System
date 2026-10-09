# Barber Queue – Final Requirement Fixes

This build preserves the existing password + OTP authentication flow and adds the requested queue/business fixes.

- Multiple active customer queue tickets remain visible in My Queue.
- Queue position is authoritative for status: position 1 = Your Turn; position > 1 = Waiting.
- ETA is calculated from active customers ahead and their service durations.
- A customer can have one active booking for themselves at a time, but can book someone else while their own booking is active.
- Someone-else bookings require name, mobile and email; booking confirmation is sent to that recipient when SMTP is configured.
- Owner contact messages are sent to the booking recipient (beneficiary email for someone-else bookings, otherwise the customer's registered email).
- Owner Skip moves the customer to the end of that barber's queue without deleting the ticket.
- Sequential tokens use A001, A002, ... per shop.
- Multiple services are grouped into one booking/ticket with combined amount and duration.
- Additional services can be added to an active ticket.
- Barber profile photos persist through the backend and are visible in customer barber cards.
- Barber creation/editing persists profile data and assigned services through the backend.
- Customer can choose Review or Report an Issue after a completed service.
- Customer complaints are visible to Admin in the Complaints section.
- Admin Shop Approvals shows owner, contact, login email, address, exact coordinates, photos, services/pricing/duration, barbers, availability and policies.
- Admin Suspend/Reactivate uses the backend status API; development CORS accepts localhost ports such as Vite 5174.
- Notification timestamps use actual createdAt values.
- Existing Cloudinary shop photo support is preserved.
- Shop latitude/longitude remain editable and independent from the typed address.
