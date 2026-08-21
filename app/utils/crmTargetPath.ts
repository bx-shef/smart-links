// Portal card paths for CRM link targets (issue #26). Pure and tested: a wrong path here is a
// dead «открыть»/«создать» button with nothing to say why.
//
// The route scheme MIRRORS the reference app's live-verified builders (its entityLink/chatNotify):
// lead(1) and deal(2) have NAMED routes; the smart invoice (31) and every dynamic type (smart
// processes, entityTypeId >= 128 — real portals mint ids like 1256) ride the universal
// /crm/type/<entityTypeId>/details/ route. Named legacy types we do not offer (contact, company,
// quote, the old invoice 5) resolve to '' — the reference proved the universal route does NOT
// resolve quotes, so falling through to it would produce a live-looking link into a 404.
//
// `#entityId#` is the placeholder the handler substitutes (existing contract of getTargetPath).

/** Smart invoice entityTypeId (the «Счёт» of the new CRM). */
export const SMART_INVOICE_TYPE_ID = 31
/** First dynamic (smart-process) entityTypeId; portals mint them upwards from here. */
export const DYNAMIC_TYPE_MIN = 128

/** True when the type rides the universal /crm/type/ route. */
export function isDynamicCrmType(entityTypeId: number): boolean {
  return entityTypeId === SMART_INVOICE_TYPE_ID || entityTypeId >= DYNAMIC_TYPE_MIN
}

/** Detail-path template for a CRM target, '' when the type has no supported route. */
export function crmTargetPathTemplate(entityTypeId: number): string {
  if (entityTypeId === 1) return '/crm/lead/details/#entityId#/'
  if (entityTypeId === 2) return '/crm/deal/details/#entityId#/'
  if (isDynamicCrmType(entityTypeId)) return `/crm/type/${entityTypeId}/details/#entityId#/`
  return ''
}

/** Creation path (id 0) for a CRM target, '' when the type has no supported route. */
export function crmNewTargetPath(entityTypeId: number): string {
  return crmTargetPathTemplate(entityTypeId).replace('#entityId#', '0')
}
