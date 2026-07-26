// region Install ////
export interface IStep {
  action: () => Promise<void>
  caption?: string
  data?: Record<string, any>
}
// endregion ////

// region UfSmartLinkType ////
export type UfSmartLinkType = {
  // это Uf в который запишем/прочитаем результат
  ufDestination: string
  // это источник - то из чего мы линкуемся
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
  // это цель - то к чему мы линкуемся
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
