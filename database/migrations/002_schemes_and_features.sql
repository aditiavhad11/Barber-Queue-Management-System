-- =====================================================================
-- Migration 002: Schemes, Reviews, Co-Owners, Edits, and Emergency Closures
-- Adds schemes offers, reviews, service edits, and single source of truth for emergency closures
-- =====================================================================

CREATE TABLE IF NOT EXISTS schemes (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NULL,
  terms TEXT NULL,
  offer_type VARCHAR(20) NOT NULL DEFAULT 'discount',
  buy_quantity INT UNSIGNED NULL,
  free_quantity INT UNSIGNED NULL,
  required_service_quantities_json JSON NULL,
  reward_service_id CHAR(36) NULL,
  reward_service_ids_json JSON NULL,
  max_reward_count INT UNSIGNED NULL,
  discount_type ENUM('percentage','fixed') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  all_services TINYINT(1) NOT NULL DEFAULT 1,
  service_ids_json JSON NOT NULL,
  all_barbers TINYINT(1) NOT NULL DEFAULT 1,
  barber_ids_json JSON NOT NULL,
  minimum_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  maximum_discount DECIMAL(10,2) NULL,
  usage_limit INT UNSIGNED NULL,
  per_customer_limit INT UNSIGNED NULL,
  promo_code VARCHAR(32) NULL,
  new_customer_only TINYINT(1) NOT NULL DEFAULT 0,
  happy_hour_start_time TIME NULL,
  happy_hour_end_time TIME NULL,
  happy_hour_days_json JSON NULL,
  status ENUM('draft','active','paused') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  UNIQUE KEY uq_scheme_shop_code (shop_id,promo_code),
  INDEX idx_scheme_shop_status (shop_id,status,starts_at,ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_reviews (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  queue_id VARCHAR(60) NOT NULL UNIQUE,
  rating TINYINT UNSIGNED NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_booking_review_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shop_co_owners (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  title VARCHAR(60) NOT NULL DEFAULT 'Co-Owner',
  password_hash VARCHAR(255) NOT NULL,
  permissions_json JSON NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_co_owner_shop (shop_id),
  INDEX idx_co_owner_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_unavailability (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  unavailable_date DATE NOT NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_service_unavailable_date (service_id, unavailable_date),
  INDEX idx_service_unavailability_shop_date (shop_id, unavailable_date),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_service_edits (
  id CHAR(36) PRIMARY KEY,
  request_key CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  shop_id CHAR(36) NOT NULL,
  barber_id CHAR(36) NOT NULL,
  old_service_ids_json JSON NOT NULL,
  requested_service_ids_json JSON NOT NULL,
  amount_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
  proposed_total DECIMAL(10,2) NOT NULL,
  proposed_duration INT UNSIGNED NOT NULL,
  payment_reference VARCHAR(120) NULL,
  payer_name VARCHAR(120) NULL,
  status ENUM('payment_review','refund_review','applied','rejected') NOT NULL,
  payment_status ENUM('not_required','submitted','verified','declined') NOT NULL DEFAULT 'not_required',
  refund_status ENUM('not_required','requested','shop_confirmed') NOT NULL DEFAULT 'not_required',
  resolution_note VARCHAR(255) NULL,
  resolved_by CHAR(64) NULL,
  resolved_by_role ENUM('owner','shop','co_owner') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  UNIQUE KEY uq_booking_service_edit_request (customer_id, request_key),
  UNIQUE KEY uq_booking_service_edit_payment_ref (payment_reference),
  INDEX idx_booking_service_edit_pending (shop_id, status, created_at),
  INDEX idx_booking_service_edit_booking (booking_id, created_at),
  FOREIGN KEY (booking_id) REFERENCES payment_bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Single Source of Truth for Emergency Closures
CREATE TABLE IF NOT EXISTS emergency_closures (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  closure_type ENUM('hours','days') NOT NULL DEFAULT 'days',
  start_at DATETIME NOT NULL,
  end_at DATETIME NULL,
  reason VARCHAR(255) NULL,
  status ENUM('active','ended','expired') NOT NULL DEFAULT 'active',
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_emergency_closure_shop_period (shop_id, start_at, end_at, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergency_closure_notifications (
  closure_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (closure_id, booking_id),
  FOREIGN KEY (closure_id) REFERENCES emergency_closures(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES payment_bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

