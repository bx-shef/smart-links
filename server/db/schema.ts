// Postgres schema (idempotent). Applied on boot by the migrate plugin.
//
// app_rating — per-portal «оцените приложение» state, one row per portal.
//   portal_key  — the trusted portal key: member_id once the portal is installed via OAuth (S4),
//                 the verified host for a portal we only ever see through the frame. Generic TEXT
//                 so both shapes fit without a migration.
//   prompted_at — when the modal was last shown (throttles the next prompt).
//   opened_at   — when the user clicked «Оценить» and we opened the Market page. While set, the
//                 modal is suppressed until an owner manually verifies the review.
//   reviewed    — set true once a real Market review is confirmed → terminal, never prompt again.
//
// portal_tokens — one row per installed portal (S4, Market OAuth).
//   refresh_token_enc is AES-256-GCM at rest (server/utils/secretCrypto.ts) because it is the
//   long-lived credential — it mints access tokens for a portal for ~180 days, so a database dump
//   must not hand it over. access_token is stored as-is: it expires within the hour and is
//   re-derived from the encrypted one anyway.
//   application_token authenticates LATER events from this portal — notably ONAPPUNINSTALL, which
//   carries no auth block of its own.
//
// portal_tombstone — event-ordering guard. Bitrix neither orders nor retries its outgoing events,
//   so a delayed ONAPPINSTALL can land AFTER the ONAPPUNINSTALL that superseded it and silently
//   resurrect a portal the customer already removed — reinstating credentials nobody consented to.
//   Recording the uninstall's `ts` lets a later install compare and refuse. deleted_ts is a Bitrix
//   event ts in unix SECONDS.
//
//   Growth is bounded by sweeping rows older than TOMBSTONE_TTL_DAYS: the guard only has to
//   outlive a late retry of the same uninstall (hours), not forever, and without a sweep we would
//   keep one row per permanently-removed portal for the life of the database.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_rating (
  portal_key  TEXT PRIMARY KEY,
  prompted_at TIMESTAMPTZ,
  opened_at   TIMESTAMPTZ,
  reviewed    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_tokens (
  member_id         TEXT PRIMARY KEY,
  domain            TEXT NOT NULL,
  client_endpoint   TEXT NOT NULL DEFAULT '',
  access_token      TEXT NOT NULL DEFAULT '',
  refresh_token_enc TEXT NOT NULL DEFAULT '',
  application_token TEXT NOT NULL DEFAULT '',
  expires_in        INTEGER NOT NULL DEFAULT 3600,
  issued_at_ms      BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A frame request arrives with a domain, not a member_id, so the lookup runs host -> member_id.
CREATE INDEX IF NOT EXISTS portal_tokens_domain_idx ON portal_tokens (domain);

CREATE TABLE IF NOT EXISTS portal_tombstone (
  member_id  TEXT PRIMARY KEY,
  deleted_ts BIGINT NOT NULL
);
`
