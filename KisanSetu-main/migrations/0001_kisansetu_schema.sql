CREATE SEQUENCE IF NOT EXISTS kisan_token_seq START 1;

CREATE TABLE IF NOT EXISTS farmer_profiles (
  user_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  village TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','hi','mr')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farmer_produce (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  crop_name TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg','quintal')),
  quantity_kg NUMERIC(14,2) NOT NULL CHECK (quantity_kg > 0),
  harvest_date DATE,
  perishability TEXT NOT NULL DEFAULT 'LOW' CHECK (perishability IN ('LOW','MEDIUM','HIGH')),
  urgency TEXT NOT NULL DEFAULT 'NORMAL' CHECK (urgency IN ('NORMAL','HIGH','CRITICAL')),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produce_user_created ON farmer_produce(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS procurement_centres (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  operating_days TEXT[] NOT NULL DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'],
  opening_time TIME NOT NULL DEFAULT '08:00',
  closing_time TIME NOT NULL DEFAULT '17:00',
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_duration_minutes BETWEEN 10 AND 240),
  max_farmers_day INTEGER NOT NULL DEFAULT 100 CHECK (max_farmers_day > 0),
  max_quantity_kg_day NUMERIC(14,2) NOT NULL DEFAULT 20000 CHECK (max_quantity_kg_day > 0),
  max_farmers_slot INTEGER NOT NULL DEFAULT 10 CHECK (max_farmers_slot > 0),
  max_quantity_kg_slot NUMERIC(14,2) NOT NULL DEFAULT 2500 CHECK (max_quantity_kg_slot > 0),
  emergency_reserved_kg NUMERIC(14,2) NOT NULL DEFAULT 2000 CHECK (emergency_reserved_kg >= 0),
  emergency_max_farmers_day INTEGER NOT NULL DEFAULT 10 CHECK (emergency_max_farmers_day >= 0),
  emergency_priority_enabled BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (opening_time < closing_time),
  CHECK (emergency_reserved_kg <= max_quantity_kg_day)
);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  produce_id BIGINT NOT NULL REFERENCES farmer_produce(id),
  centre_id BIGINT NOT NULL REFERENCES procurement_centres(id),
  procurement_date DATE NOT NULL,
  slot_start TIME NOT NULL,
  slot_end TIME NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg','quintal')),
  quantity_kg NUMERIC(14,2) NOT NULL CHECK (quantity_kg > 0),
  is_emergency BOOLEAN NOT NULL DEFAULT false,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','CHECKED_IN','WAITING','IN_PROGRESS','QUALITY_TESTING','PROCUREMENT','COMPLETED','CANCELLED','NO_SHOW')),
  quality_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (quality_status IN ('PENDING','TESTING','PASSED','REJECTED')),
  quality_grade TEXT NOT NULL DEFAULT '',
  quality_remarks TEXT NOT NULL DEFAULT '',
  quality_tested_at TIMESTAMPTZ,
  procurement_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (procurement_status IN ('PENDING','IN_PROGRESS','COMPLETED')),
  procurement_remarks TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','PROCESSING','PAID','FAILED')),
  payment_amount NUMERIC(14,2),
  payment_reference TEXT NOT NULL DEFAULT '',
  payment_remarks TEXT NOT NULL DEFAULT '',
  payment_date TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_start < slot_end)
);
CREATE INDEX IF NOT EXISTS idx_bookings_centre_date_slot ON bookings(centre_id, procurement_date, slot_start, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_user_created ON bookings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_queue ON bookings(centre_id, procurement_date, slot_start, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_booking_per_farmer_date ON bookings(user_id, procurement_date) WHERE status NOT IN ('COMPLETED','CANCELLED','NO_SHOW');

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  booking_id BIGINT REFERENCES bookings(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'info',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_events (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id),
  actor_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id, created_at DESC);