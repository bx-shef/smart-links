// Postgres schema (idempotent). Applied on boot by the migrate plugin.
//
// app_rating — per-portal «оцените приложение» state, one row per portal.
//   portal_key  — the trusted portal key: the verified host today, member_id after the OAuth
//                 phase (S4). Generic TEXT so the key source can change without a migration.
//   prompted_at — when the modal was last shown (throttles the next prompt).
//   opened_at   — when the user clicked «Оценить» and we opened the Market page. While set, the
//                 modal is suppressed until an owner manually verifies the review.
//   reviewed    — set true once a real Market review is confirmed → terminal, never prompt again.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_rating (
  portal_key  TEXT PRIMARY KEY,
  prompted_at TIMESTAMPTZ,
  opened_at   TIMESTAMPTZ,
  reviewed    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`
