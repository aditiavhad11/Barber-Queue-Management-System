-- Migration 003: Composite indexes for queue and booking performance
-- These fill the gap between the existing (shop_id, status) index and the
-- real query shapes used by listQueue, acceptBooking, and scheduledQueueService.

-- Queue status queries (listQueue, acceptBooking, setQueueStatus):
--   WHERE shop_id=? AND barber_id=? AND status='accepted'
--     AND queue_status IN ('Waiting','Your Turn','In Service','Scheduled')
--   Also used by ROW_NUMBER() OVER (PARTITION BY shop_id, barber_id ...)
ALTER TABLE payment_bookings
  ADD INDEX IF NOT EXISTS idx_booking_queue
    (shop_id, barber_id, status, queue_status);

-- Scheduled booking queries (scheduledQueueService, prebookings):
--   WHERE shop_id=? AND barber_id=? AND booking_date=?
--     AND queue_status NOT IN ('Cancelled','Completed','No Show','Emergency Closed')
ALTER TABLE payment_bookings
  ADD INDEX IF NOT EXISTS idx_booking_scheduled
    (shop_id, barber_id, booking_date, queue_status);

-- Appointment overlap check (acceptBookingCore):
--   WHERE shop_id=? AND barber_id=? AND booking_date=?
--     AND scheduled_time IS NOT NULL AND scheduled_time > TIME(NOW())
--   (covered by idx_booking_scheduled above, included here for clarity)

-- Scheme usage / offer eligibility queries (schemeService.evaluateScheme):
--   WHERE scheme_id=? AND (status='payment_submitted' OR status IN ('accepted','paid'))
ALTER TABLE payment_bookings
  ADD INDEX IF NOT EXISTS idx_booking_scheme
    (scheme_id, status, created_at);

-- Token uniqueness / next-free-token scan (acceptBookingCore):
--   WHERE shop_id=? AND token REGEXP '^A[0-9]+$'
--   A prefix on shop_id+token makes the REGEXP scan shop-scoped.
ALTER TABLE payment_bookings
  ADD INDEX IF NOT EXISTS idx_booking_token
    (shop_id, token);

-- Reviews aggregate (listApproved now uses AVG/COUNT instead of full rows):
--   GROUP BY shop_id -> already covered by idx_booking_review_shop in 002
--   but also queried by shop detail: WHERE shop_id=? ORDER BY created_at DESC
ALTER TABLE booking_reviews
  ADD INDEX IF NOT EXISTS idx_review_shop_date
    (shop_id, created_at DESC);

-- Shops list (listApproved with search):
--   WHERE status='approved' AND active=1 ORDER BY name ASC
ALTER TABLE shops
  ADD INDEX IF NOT EXISTS idx_shop_approved_name
    (status, active, name);

