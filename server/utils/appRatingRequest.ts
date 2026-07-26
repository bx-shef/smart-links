// Pure parser for the POST /api/app-rating body (unit-tested; the route stays a thin edge).

export type RatingAction = 'prompted' | 'opened'

/** Extract a valid rating action from an untrusted request body, or null. */
export function parseRatingAction(body: unknown): RatingAction | null {
  const action = (body as { action?: unknown } | null)?.action
  return action === 'prompted' || action === 'opened' ? action : null
}
