import type { UfSmartLinkType } from '#shared/types/base'

/**
 * Information-block types a Bitrix24 portal keeps Lists under.
 *
 * Verified on a live portal: `lists.get` answers each of these separately, and the same portal can
 * have none under `lists` while having five under `bitrix_processes`. There is no "any type" value.
 */
export const IBLOCK_TYPE_IDS = ['lists', 'bitrix_processes', 'lists_socnet'] as const

export type IblockTypeId = typeof IBLOCK_TYPE_IDS[number]

/** What a target with no explicit type falls back to — the universal Lists section. */
export const DEFAULT_IBLOCK_TYPE_ID: IblockTypeId = 'lists'

/**
 * Sections `lists.get` will enumerate from an application context with no further coordinates.
 *
 * `lists_socnet` is excluded because workgroup and project lists are scoped to a group, and
 * `lists.get` errors without its id — which this app never has. Those lists are still usable: the
 * settings screen resolves their section from the list id via `lists.get.iblock.type.id`.
 */
export const ENUMERABLE_IBLOCK_TYPES: readonly IblockTypeId[] = ['lists', 'bitrix_processes']

/**
 * Resolve the `IBLOCK_TYPE_ID` to send with a `lists.element.get` call.
 *
 * This exists because the value used to be `target.entityMode` — our own two-way discriminator,
 * whose 'lists' branch happens to spell one of the three real iblock types. On a portal whose
 * lists live under any of the other two, every lookup came back «Неверный тип информационного
 * блока»: a hard error, so the placement showed a failure rather than an empty list, and the
 * "target is a List element" half of the feature simply did not work. Confirmed against a live
 * portal by calling `lists.element.get` with a valid IBLOCK_ID and the wrong type.
 *
 * Unknown values are passed through rather than rejected: portals can carry custom iblock types,
 * and the REST error for a genuinely wrong one is clearer than us guessing a default.
 */
export function resolveIblockTypeId(target: Pick<UfSmartLinkType['target'], 'iblockTypeId'>): string {
  // The typeof check is not belt-and-braces. Settings come back from `app.option.get` as whatever
  // JSON is stored against the portal, and nothing validates them per field on the way in — so a
  // hand-edited or half-migrated option can put a number or an object here, and `.trim()` on it
  // throws inside the placement's load path.
  const configured = typeof target.iblockTypeId === 'string' ? target.iblockTypeId.trim() : ''
  return configured || DEFAULT_IBLOCK_TYPE_ID
}
