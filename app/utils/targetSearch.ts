import type { UfSmartLinkType } from '#shared/types/base'

// Search-filter builders for the placement's target lookup, extracted from the 900-line handler
// page so the REST-visible shape is unit-testable. Everything here is pure: config + origin ids +
// the typed query in, a filter object out. The shapes are REST-facts, each verified live:
//  - CRM `crm.item.list` composes an OR block under a numeric key; Lists `lists.element.get` has
//    NO OR at all — the two-pass search (by ID, then by %NAME) lives in the caller for that reason.
//  - Lists client fields address CRM entities with prefixed ids (`CO_<id>` company, `C_<id>`
//    contact); CRM fields take the bare numeric id.

/**
 * Origin-entity ids the placement runs in (the card the field is rendered on). Values are
 * `undefined` until the origin card is read; the builders reproduce the page's long-standing
 * behavior of passing them through as-is — the `isFilterBy` gate is only enabled for configs
 * whose load populates them first. (A refactor keeps parity; tightening that contract would be a
 * behavior change and its own commit.)
 */
export interface OriginIds {
  companyId?: number
  contactId?: number
}

/**
 * Filter for the CRM branch of the target search (`crm.item.list`).
 *
 * The query is expected TRIMMED by the caller (both branches trim in one place): a copy-pasted
 * " 12 " must mean record number 12, a whitespace-only query must mean «no query». A non-empty
 * query becomes an OR of exact id and substring title — the id half is what makes pasting a
 * record number work at all.
 */
export function buildCrmSearchFilter(
  config: UfSmartLinkType,
  origin: OriginIds,
  query: string
): Record<string, unknown> {
  const filter: Record<string, unknown> = Object.assign({}, config.target.customFilter ?? {})
  if (config.orign.isFilterBy.company) {
    filter[config.target.clientFields.companyId] = origin.companyId
  }
  if (config.orign.isFilterBy.contact) {
    filter[config.target.clientFields.contactId] = origin.contactId
  }
  if (query.length > 0) {
    filter[0] = {
      logic: 'OR',
      0: { '=id': query },
      1: { '%=title': `%${query}%` }
    }
  }
  return filter
}

/**
 * Base filter for the Lists branch (`lists.element.get`), WITHOUT the query: Lists has no OR, so
 * the caller runs two passes (exact ID when the query can be one, then %NAME) and merges them
 * (`mergeSearchRows`). The prefixes are the Lists convention for CRM-bound fields — a bare id
 * there matches nothing, silently.
 */
export function buildListsSearchFilter(
  config: UfSmartLinkType,
  origin: OriginIds
): Record<string, unknown> {
  const filter: Record<string, unknown> = Object.assign({}, config.target.customFilter ?? {})
  if (config.orign.isFilterBy.company) {
    filter[config.target.clientFields.companyId] = `CO_${origin.companyId}`
  }
  if (config.orign.isFilterBy.contact) {
    filter[config.target.clientFields.contactId] = `C_${origin.contactId}`
  }
  return filter
}
