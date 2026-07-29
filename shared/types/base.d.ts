// region Install ////
export interface IStep {
  action: () => Promise<void>
  caption?: string
  data?: Record<string, any>
}
// endregion ////

// region UfSmartLinkType ////
export type UfSmartLinkType = {
  // UF field where we store/read the linked entity id
  ufDestination: string
  // source: the entity we link FROM
  orign: {
    clientFields: {
      companyId?: string
      contactId?: string
      myCompanyId?: string
      dogovorId?: string
    },
    isFilterBy: {
      company: boolean
      contact: boolean
      myCompany: boolean
      dogovor: boolean
    }
  }
  // target: the entity we link TO
  target: {
    entityMode: 'crm' | 'lists',
    /**
     * Bitrix24 information-block type the target list lives in (`lists.*` `IBLOCK_TYPE_ID`).
     *
     * Only meaningful when `entityMode === 'lists'`, and it is NOT the same thing as entityMode:
     * a portal keeps company-wide Lists under `lists`, workgroup ones under `lists_socnet`, and
     * the ones created from Автоматизация under `bitrix_processes`. Passing the wrong one is a
     * hard REST error («Неверный тип информационного блока»), not an empty result — so this has
     * to be configurable rather than assumed. Absent → `lists`.
     */
    iblockTypeId?: string
    entityTypeId: number
    customFilter?: Record<string, any>
    clientFields: {
      companyId: string
      contactId: string
      myCompanyId?: string
      dogovorId?: string
    }
  }
}
// endregion ////
