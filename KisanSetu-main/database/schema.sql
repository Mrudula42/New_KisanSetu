CREATE DATABASE IF NOT EXISTS kisansetu
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE kisansetu;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('FARMER', 'ADMIN') NOT NULL DEFAULT 'FARMER',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS farmer_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL DEFAULT '',
  village VARCHAR(120) NOT NULL DEFAULT '',
  district VARCHAR(120) NOT NULL DEFAULT '',
  preferred_language ENUM('en', 'hi', 'mr') NOT NULL DEFAULT 'en',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_farmer_profiles_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS farmer_produce (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  crop_name VARCHAR(80) NOT NULL,
  quantity DECIMAL(12, 2) NOT NULL,
  unit ENUM('kg', 'quintal') NOT NULL,
  quantity_kg DECIMAL(14, 2) NOT NULL,
  harvest_date DATE NULL,
  perishability ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'LOW',
  urgency ENUM('NORMAL', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'NORMAL',
  description VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_produce_user_created (user_id, created_at),
  CONSTRAINT fk_farmer_produce_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_produce_quantity CHECK (
    quantity > 0 AND quantity_kg > 0
    AND quantity_kg = quantity * CASE unit WHEN 'quintal' THEN 100 ELSE 1 END
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS procurement_centres (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(200) NOT NULL,
  operating_days JSON NOT NULL,
  opening_time TIME NOT NULL DEFAULT '08:00:00',
  closing_time TIME NOT NULL DEFAULT '17:00:00',
  slot_duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  max_farmers_day INT UNSIGNED NOT NULL DEFAULT 100,
  max_quantity_kg_day DECIMAL(14, 2) NOT NULL DEFAULT 20000,
  max_farmers_slot INT UNSIGNED NOT NULL DEFAULT 10,
  max_quantity_kg_slot DECIMAL(14, 2) NOT NULL DEFAULT 2500,
  emergency_reserved_kg DECIMAL(14, 2) NOT NULL DEFAULT 2000,
  emergency_max_farmers_day INT UNSIGNED NOT NULL DEFAULT 10,
  emergency_priority_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_procurement_centres_name (name),
  CONSTRAINT chk_centre_operating_days CHECK (JSON_TYPE(operating_days) = 'ARRAY'),
  CONSTRAINT chk_centre_hours CHECK (opening_time < closing_time),
  CONSTRAINT chk_centre_slot_duration CHECK (slot_duration_minutes BETWEEN 10 AND 240),
  CONSTRAINT chk_centre_capacity CHECK (
    max_farmers_day > 0 AND max_quantity_kg_day > 0
    AND max_farmers_slot > 0 AND max_quantity_kg_slot > 0
    AND emergency_reserved_kg <= max_quantity_kg_day
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  produce_id BIGINT UNSIGNED NOT NULL,
  centre_id BIGINT UNSIGNED NOT NULL,
  procurement_date DATE NOT NULL,
  slot_start TIME NOT NULL,
  slot_end TIME NOT NULL,
  quantity DECIMAL(12, 2) NOT NULL,
  unit ENUM('kg', 'quintal') NOT NULL,
  quantity_kg DECIMAL(14, 2) NOT NULL,
  is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  token VARCHAR(32) NOT NULL,
  status ENUM('BOOKED', 'CHECKED_IN', 'WAITING', 'IN_PROGRESS', 'QUALITY_TESTING', 'PROCUREMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'BOOKED',
  quality_status ENUM('PENDING', 'TESTING', 'PASSED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  quality_grade VARCHAR(40) NOT NULL DEFAULT '',
  quality_remarks VARCHAR(500) NOT NULL DEFAULT '',
  quality_tested_at DATETIME(3) NULL,
  procurement_status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
  procurement_remarks VARCHAR(500) NOT NULL DEFAULT '',
  payment_status ENUM('PENDING', 'PROCESSING', 'PAID', 'FAILED') NOT NULL DEFAULT 'PENDING',
  payment_amount DECIMAL(14, 2) NULL,
  payment_reference VARCHAR(120) NOT NULL DEFAULT '',
  payment_remarks VARCHAR(500) NOT NULL DEFAULT '',
  payment_date DATETIME(3) NULL,
  checked_in_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  active_procurement_date DATE GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('COMPLETED', 'CANCELLED', 'NO_SHOW') THEN NULL
      ELSE procurement_date
    END
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_token (token),
  UNIQUE KEY uq_active_booking_per_farmer_date (user_id, active_procurement_date),
  KEY idx_bookings_centre_date_slot (centre_id, procurement_date, slot_start, created_at),
  KEY idx_bookings_user_created (user_id, created_at),
  KEY idx_bookings_queue (centre_id, procurement_date, slot_start, status, created_at),
  CONSTRAINT fk_bookings_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_produce
    FOREIGN KEY (produce_id) REFERENCES farmer_produce (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bookings_centre
    FOREIGN KEY (centre_id) REFERENCES procurement_centres (id) ON DELETE RESTRICT,
  CONSTRAINT chk_booking_slot CHECK (slot_start < slot_end),
  CONSTRAINT chk_booking_quantity CHECK (quantity > 0 AND quantity_kg > 0),
  CONSTRAINT chk_booking_payment CHECK (payment_amount IS NULL OR payment_amount >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  booking_id BIGINT UNSIGNED NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  category ENUM('info', 'success', 'urgent') NOT NULL DEFAULT 'info',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_user_created (user_id, created_at),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  details VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_booking_events_booking (booking_id, created_at),
  CONSTRAINT fk_booking_events_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_events_actor
    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;
