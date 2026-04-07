CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  app_version TEXT,
  expo_push_token TEXT,
  push_permission_granted BOOLEAN NOT NULL DEFAULT FALSE,
  device_label TEXT,
  device_os_version TEXT,
  last_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_customer_id ON devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_registered_at ON devices(last_registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_devices_last_opened_at ON devices(last_opened_at DESC);

CREATE TABLE IF NOT EXISTS app_opens (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_opens_device_id ON app_opens(device_id);
CREATE INDEX IF NOT EXISTS idx_app_opens_customer_id ON app_opens(customer_id);
CREATE INDEX IF NOT EXISTS idx_app_opens_opened_at ON app_opens(opened_at DESC);

CREATE TABLE IF NOT EXISTS push_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience_label TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_campaigns_created_at ON push_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_campaigns_status ON push_campaigns(status);

CREATE TABLE IF NOT EXISTS push_deliveries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  status TEXT NOT NULL,
  expo_ticket_id TEXT,
  expo_receipt_id TEXT,
  receipt_status TEXT,
  error_code TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  receipt_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_campaign_id ON push_deliveries(campaign_id);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_device_id ON push_deliveries(device_id);
CREATE INDEX IF NOT EXISTS idx_push_deliveries_status ON push_deliveries(status);
