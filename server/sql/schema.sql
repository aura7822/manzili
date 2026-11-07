-- House Rent Management System schema (PostgreSQL 14+). Idempotent: safe to re-run.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  CREATE TYPE user_role      AS ENUM ('admin', 'landlord', 'caretaker');
  CREATE TYPE unit_status    AS ENUM ('vacant', 'occupied', 'maintenance');
  CREATE TYPE lease_status   AS ENUM ('draft', 'active', 'expired', 'terminated');
  CREATE TYPE deposit_status AS ENUM ('pending', 'held', 'partially_refunded', 'refunded');
  CREATE TYPE invoice_status AS ENUM ('pending', 'partial', 'paid', 'overdue', 'void');
  CREATE TYPE payment_method AS ENUM ('mpesa', 'card', 'bank_transfer', 'cash');
  CREATE TYPE txn_status     AS ENUM ('pending', 'success', 'failed', 'cancelled', 'refunded');
  CREATE TYPE notify_channel AS ENUM ('sms', 'email', 'whatsapp');
  CREATE TYPE notify_status  AS ENUM ('queued', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(20),
  password_hash TEXT NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  role          user_role NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS properties (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id),
  name         VARCHAR(150) NOT NULL,
  slug         VARCHAR(100) NOT NULL UNIQUE,
  address      TEXT NOT NULL,
  city         VARCHAR(100),
  total_floors SMALLINT CHECK (total_floors > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS units (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number  VARCHAR(20) NOT NULL,
  floor_number SMALLINT NOT NULL DEFAULT 0,
  bedrooms     SMALLINT NOT NULL DEFAULT 1 CHECK (bedrooms >= 0),
  monthly_rent NUMERIC(12,2) NOT NULL CHECK (monthly_rent >= 0),
  status       unit_status NOT NULL DEFAULT 'vacant',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, unit_number)
);

CREATE TABLE IF NOT EXISTS tenants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name         VARCHAR(150) NOT NULL,
  phone             VARCHAR(20) NOT NULL UNIQUE,   -- normalised: 2547XXXXXXXX
  email             VARCHAR(255),
  national_id       VARCHAR(30) NOT NULL UNIQUE,
  emergency_contact VARCHAR(150),
  emergency_phone   VARCHAR(20),
  preferred_channel notify_channel NOT NULL DEFAULT 'sms',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          UUID NOT NULL REFERENCES units(id),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  start_date       DATE NOT NULL,
  end_date         DATE,
  rent_amount      NUMERIC(12,2) NOT NULL CHECK (rent_amount >= 0),
  rent_due_day     SMALLINT NOT NULL DEFAULT 5 CHECK (rent_due_day BETWEEN 1 AND 28),
  deposit_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  deposit_status   deposit_status NOT NULL DEFAULT 'pending',
  deposit_refunded NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_refunded >= 0),
  status           lease_status NOT NULL DEFAULT 'draft',
  terminated_on    DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date > start_date),
  CHECK (deposit_refunded <= deposit_amount),
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'active')
);

CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(30) NOT NULL UNIQUE,
  lease_id       UUID NOT NULL REFERENCES leases(id),
  billing_period DATE NOT NULL,
  due_date       DATE NOT NULL,
  amount_due     NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status         invoice_status NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lease_id, billing_period)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  BIGSERIAL PRIMARY KEY,
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  method              payment_method NOT NULL,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status              txn_status NOT NULL DEFAULT 'pending',
  payer_phone         VARCHAR(20),
  checkout_request_id VARCHAR(100) UNIQUE,
  provider_reference  VARCHAR(100) UNIQUE,
  receipt_number      VARCHAR(40) UNIQUE,
  failure_reason      TEXT,
  recorded_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           BIGSERIAL PRIMARY KEY,
  provider     VARCHAR(30) NOT NULL,
  event_id     VARCHAR(150) NOT NULL,
  payload      JSONB NOT NULL,
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  error        TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  channel    notify_channel NOT NULL,
  kind       VARCHAR(30) NOT NULL,
  message    TEXT NOT NULL,
  status     notify_status NOT NULL DEFAULT 'queued',
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGSERIAL PRIMARY KEY,
  category    VARCHAR(20) NOT NULL,   -- mpesa | payment | tenant | unit | message | broadcast | finance | auth | system
  action      VARCHAR(40) NOT NULL,
  message     TEXT NOT NULL,
  meta        JSONB,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archives (
  id                  BIGSERIAL PRIMARY KEY,
  property_id         UUID REFERENCES properties(id) ON DELETE CASCADE,
  property_name       VARCHAR(150) NOT NULL,
  unit_number         VARCHAR(20) NOT NULL,
  unit_type           VARCHAR(12),
  tenant_name         VARCHAR(150) NOT NULL,
  phone               VARCHAR(20),
  email               VARCHAR(255),
  national_id         VARCHAR(30),
  lease_start         DATE,
  rent_amount         NUMERIC(12,2),
  total_paid          NUMERIC(12,2) NOT NULL DEFAULT 0,
  outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  vacated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_at            TIMESTAMPTZ NOT NULL,   -- auto-deleted after this moment
  vacated_by          UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS maintenance_spend (
  id          BIGSERIAL PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  month       DATE NOT NULL,              -- first day of the month
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  note        VARCHAR(300),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, month)
);

CREATE TABLE IF NOT EXISTS price_rules (
  id           BIGSERIAL PRIMARY KEY,
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_type    VARCHAR(12) NOT NULL CHECK (unit_type IN
                 ('single', 'bedsitter', 'studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_bedroom')),
  floor_number SMALLINT,                 -- NULL = applies to every floor
  monthly_rent NUMERIC(12,2) NOT NULL CHECK (monthly_rent >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_rules ON price_rules (property_id, unit_type, COALESCE(floor_number, -9999));

-- Upgrades for databases created by earlier versions of this schema.
ALTER TABLE units ADD COLUMN IF NOT EXISTS unit_type VARCHAR(12);
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_unit_type_check;
ALTER TABLE units ADD CONSTRAINT units_unit_type_check CHECK (unit_type IS NULL OR unit_type IN
  ('single', 'bedsitter', 'studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_bedroom'));
ALTER TABLE archives ALTER COLUMN unit_type TYPE VARCHAR(20);
ALTER TABLE archives ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE archives ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE units DROP COLUMN IF EXISTS size_sqm;
ALTER TABLE leases ALTER COLUMN end_date DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_units_property_status ON units (property_id, status);
CREATE INDEX IF NOT EXISTS idx_leases_unit_status    ON leases (unit_id, status);
CREATE INDEX IF NOT EXISTS idx_leases_tenant         ON leases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due   ON invoices (status, due_date);
CREATE INDEX IF NOT EXISTS idx_txn_invoice           ON transactions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_txn_status_initiated  ON transactions (status, initiated_at);
CREATE INDEX IF NOT EXISTS idx_notif_invoice_kind    ON notifications (invoice_id, kind);
CREATE INDEX IF NOT EXISTS idx_activity_created      ON activity_log (id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_category     ON activity_log (category, id DESC);
CREATE INDEX IF NOT EXISTS idx_archives_purge        ON archives (purge_at);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','properties','units','tenants','leases','invoices']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated') THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        t, t);
    END IF;
  END LOOP;
END $$;
