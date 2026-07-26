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
