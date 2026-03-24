-- Service booking: profiles, availability, bookings (run in Supabase SQL editor)

CREATE TABLE IF NOT EXISTS service_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_type text NOT NULL DEFAULT 'remote',
  location text,
  radius_miles int,
  timezone text NOT NULL DEFAULT 'America/New_York',
  duration_minutes int NOT NULL DEFAULT 60,
  buffer_minutes int NOT NULL DEFAULT 15,
  price_per_token double precision NOT NULL DEFAULT 1.0,
  currency text NOT NULL DEFAULT 'USD',
  service_description text,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_service_profiles_project ON service_profiles(project_id);

CREATE TABLE IF NOT EXISTS availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  is_booked boolean NOT NULL DEFAULT false,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, slot_date, slot_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_project_date ON availability_slots(project_id, slot_date);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES availability_slots(id) ON DELETE CASCADE,
  customer_wallet text NOT NULL,
  customer_email text,
  customer_name text,
  token_amount double precision NOT NULL DEFAULT 1,
  notes text,
  redemption_code text NOT NULL UNIQUE,
  qr_data text,
  status text NOT NULL DEFAULT 'confirmed',
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_project ON bookings(project_id);
CREATE INDEX IF NOT EXISTS idx_bookings_redemption ON bookings(redemption_code);
