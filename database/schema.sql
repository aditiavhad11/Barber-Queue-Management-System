CREATE DATABASE IF NOT EXISTS barber_queue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE barber_queue;

CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  role ENUM('customer','owner','admin') NOT NULL,
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE otp_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  role ENUM('customer','owner','admin') NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_email (email),
  INDEX idx_otp_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE shops (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  contact VARCHAR(40) NOT NULL,
  address VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  hours_open TIME NOT NULL,
  hours_close TIME NOT NULL,
  availability_json JSON NOT NULL,
  policies_json JSON NOT NULL,
  status ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
  active TINYINT(1) NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  login_email VARCHAR(190) NOT NULL UNIQUE,
  login_password_hash VARCHAR(255) NOT NULL,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  upi_qr_url TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shop_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_shop_owner (owner_id),
  INDEX idx_shop_status (status, active)
) ENGINE=InnoDB;

CREATE TABLE shop_photos (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  url TEXT NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_photo_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE services (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_service_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE barbers (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  gender VARCHAR(40),
  experience_years INT UNSIGNED DEFAULT 0,
  specialization VARCHAR(180),
  rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  status ENUM('Available','On Break','Unavailable') NOT NULL DEFAULT 'Available',
  photo_url TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_barber_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE barber_services (
  barber_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  PRIMARY KEY (barber_id, service_id),
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE customers (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  shop_id CHAR(36) NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_shop (customer_id, shop_id),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE queue_entries (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  barber_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  token VARCHAR(20) NOT NULL,
  status ENUM('waiting','your_turn','in_service','completed','skipped','no_show','cancelled') NOT NULL DEFAULT 'waiting',
  payment_status ENUM('pending','successful','failed','refunded') NOT NULL DEFAULT 'pending',
  payment_amount DECIMAL(10,2) NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  INDEX idx_queue_shop_barber (shop_id, barber_id, status),
  INDEX idx_queue_customer (customer_id, status)
) ENGINE=InnoDB;

CREATE TABLE payments (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  queue_id CHAR(36),
  customer_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'mock',
  status ENUM('successful','failed','cancelled','refunded') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id) REFERENCES queue_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_payment_shop (shop_id, status)
) ENGINE=InnoDB;

CREATE TABLE refunds (
  id CHAR(36) PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('requested','approved','processed','rejected') NOT NULL DEFAULT 'requested',
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE reviews (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  queue_id CHAR(36) NOT NULL UNIQUE,
  rating TINYINT UNSIGNED NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (rating BETWEEN 1 AND 5),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_id) REFERENCES queue_entries(id) ON DELETE CASCADE,
  INDEX idx_review_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE complaints (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  shop_id CHAR(36) NOT NULL,
  issue TEXT NOT NULL,
  status ENUM('open','investigating','resolved','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36),
  shop_id CHAR(36),
  tone ENUM('info','ok','alert','warn') NOT NULL DEFAULT 'info',
  text TEXT NOT NULL,
  read_at DATETIME NULL,
  ref_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_notification_ref (ref_id),
  INDEX idx_notification_user (user_id, created_at),
  INDEX idx_notification_shop (shop_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id CHAR(36),
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(60),
  entity_id CHAR(36),
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

-- Customer payment submissions. Only an owner ACCEPT moves a row into the queue.
CREATE TABLE payment_bookings (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  barber_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  service_ids_json JSON NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  beneficiary_json JSON NOT NULL,
  beneficiary_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'upi_qr',
  status ENUM('payment_submitted','accepted','rejected','created','paid','failed','cancelled') NOT NULL DEFAULT 'payment_submitted',
  failure_reason VARCHAR(255) NULL,
  payer_name VARCHAR(120) NULL,
  payment_submitted_at DATETIME NULL,
  payment_reference VARCHAR(120) NULL,
  token VARCHAR(20) NULL,
  queue_id VARCHAR(60) NULL,
  refund_id VARCHAR(64) NULL,
  refund_status VARCHAR(30) NULL,
  decline_reason VARCHAR(255) NULL,
  declined_until DATETIME NULL,
  paid_at DATETIME NULL,
  accepted_at DATETIME NULL,
  queue_status VARCHAR(20) NULL,
  skipped_at DATETIME NULL,
  skip_count INT NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_shop_token (shop_id, token),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_booking_shop_status (shop_id, status),
  INDEX idx_booking_customer (customer_id, status),
  INDEX idx_booking_request (customer_id, request_hash, status)
) ENGINE=InnoDB;

-- Server-side queue state and persistent reviews (see migrations/add_queue_reviews.sql)
ALTER TABLE payment_bookings
  ADD COLUMN queue_status VARCHAR(20) NULL,
  ADD COLUMN skipped_at DATETIME NULL,
  ADD COLUMN skip_count INT NOT NULL DEFAULT 0,
  ADD COLUMN completed_at DATETIME NULL;
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
