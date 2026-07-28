import { createHash } from 'node:crypto'

/**
 * Pseudonymous, stable identifier for a portal, for logs.
 *
 * A `member_id` identifies a customer's portal and does not belong in a log file. But logging
 * nothing identifying at all makes diagnosis impossible: "2 of 7 refreshes failed" cannot be acted
 * on if there is no way to tell which portal failed, or whether the same one fails every day.
 * A short hash gives correlation without carrying the identifier itself.
 */
export function portalHash(memberId: string): string {
  const id = (memberId ?? '').trim().toLowerCase()
  if (!id) return 'anon'
  return createHash('sha256').update(id).digest('hex').slice(0, 12)
}
