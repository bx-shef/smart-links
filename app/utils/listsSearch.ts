/**
 * Pure helpers for the two-pass Lists candidate search.
 *
 * Bitrix24's `lists.element.get` filter has no OR, so a query that could be either a record number
 * or part of a name needs two calls: one by ID, one by %NAME. The merge of those two answers used
 * to live inline in the placement page and had two defects this module exists to pin down with
 * tests: the ID pass ran for non-numeric queries (a wasted call at best), and the merge kept
 * duplicates — element 12 named «Договор №12», searched as "12", matched both passes and rendered
 * twice, with a duplicate `v-for` key to go with it.
 */

export interface ListsSearchRow {
  id: number
  title: string
}

/** Whether the query can possibly match a record number — only then is the ID pass worth a call. */
export function isNumericQuery(query: string): boolean {
  return /^\d+$/.test(query.trim())
}

/**
 * Merge the raw rows of the two passes into unique display rows, first occurrence wins.
 *
 * IDs arrive as strings from the Lists REST and as numbers from our own rows, so uniqueness is by
 * the numeric value. Rows without a parseable positive id are dropped rather than rendered — a row
 * that cannot be linked (linking writes the id) or keyed is not a candidate, it is noise.
 */
export function mergeSearchRows(...passes: Array<Array<{ ID?: unknown, NAME?: unknown }>>): ListsSearchRow[] {
  const seen = new Set<number>()
  const merged: ListsSearchRow[] = []
  for (const rows of passes) {
    for (const row of rows) {
      const id = Number.parseInt(String(row?.ID ?? ''), 10)
      if (!Number.isFinite(id) || id < 1 || seen.has(id)) {
        continue
      }
      seen.add(id)
      merged.push({ id, title: String(row?.NAME ?? '') })
    }
  }
  return merged
}
