import type { B24Frame, TypeEnumAppStatus } from '@bitrix24/b24jssdk'
import type { UfSmartLinkType } from '#shared/types/base'
import { EnumCrmEntityTypeId } from '@bitrix24/b24jssdk'

/**
 * Some info about App
 */
export const useAppSettingsStore = defineStore(
  'appSettings',
  () => {
    let $b24: null | B24Frame = null

    // region State ////

    type UfListConfigType = { [key: string]: UfSmartLinkType }

    const version = ref(0)
    const status = ref<TypeEnumAppStatus>('Free')
    const isTrial = ref(true)
    /**
     * @todo Менять конфиг тут
     */
    const configUfListSettings = reactive<UfListConfigType>({
      UF_CRM_DEAL_FIZ_DOGOVOR_GETTER: {
        ufDestination: 'ufCrmDealDogovor',
        orign: {
          clientFields: {
            companyId: 'companyId',
            contactId: 'contactId',
            myCompanyId: undefined,
            dogovorId: undefined
          },
          isFilterBy: {
            company: false,
            contact: true,
            myCompany: false,
            dogovor: false
          },
        },
        target: {
          entityMode: 'lists',
          entityTypeId: 41, // id инфоблока
          customFilter: {
            'PROPERTY_RAZOVYY': false
          },
          clientFields: {
            companyId: 'PROPERTY_175', // CLIENT
            contactId: 'PROPERTY_175', // CLIENT
            myCompanyId: undefined,
            dogovorId: undefined
          }
        }
      },
      UF_CRM_DEAL_UR_DOGOVOR_GETTER: {
        ufDestination: 'ufCrmDealDogovor',
        orign: {
          clientFields: {
            companyId: 'companyId',
            contactId: 'contactId',
            myCompanyId: undefined,
            dogovorId: undefined
          },
          isFilterBy: {
            company: true,
            contact: false,
            myCompany: false,
            dogovor: false
          },
        },
        target: {
          entityMode: 'lists',
          entityTypeId: 41, // id инфоблока
          customFilter: {
            'PROPERTY_RAZOVYY': false
          },
          clientFields: {
            companyId: 'PROPERTY_175', // CLIENT
            contactId: 'PROPERTY_175', // CLIENT
            myCompanyId: undefined,
            dogovorId: undefined
          }
        }
      },
      UF_CRM_DEAL_DEV_FIZ_DOGOVOR_GETTER: {
        ufDestination: 'ufCrmDealDogovor',
        orign: {
          clientFields: {
            companyId: 'companyId',
            contactId: 'contactId',
            myCompanyId: undefined,
            dogovorId: undefined
          },
          isFilterBy: {
            company: false,
            contact: true,
            myCompany: false,
            dogovor: false
          },
        },
        target: {
          entityMode: 'lists',
          entityTypeId: 41, // id инфоблока
          customFilter: {
            'PROPERTY_RAZOVYY': false
          },
          clientFields: {
            companyId: 'PROPERTY_175', // CLIENT
            contactId: 'PROPERTY_175', // CLIENT
            myCompanyId: undefined,
            dogovorId: undefined
          }
        }
      }
    })
    // endregion ////

    // region Actions ////
    /**
     * @memo #entityId#
     */
    const getTargetPath = (entityTypeId: number, entityMode: string) => {
      if (entityMode === 'crm') {
        switch (entityTypeId) {
          case EnumCrmEntityTypeId.deal: return `/crm/deal/details/#entityId#/`
        }
      } else if(entityMode === 'lists') {
        return `/services/lists/${entityTypeId}/element/0/#entityId#/`
      }

      return ''
    }

    const getNewTargetPath = (entityTypeId: number, entityMode: string) => {
      if (entityMode === 'crm') {
        switch (entityTypeId) {
          case EnumCrmEntityTypeId.deal: return `/crm/deal/details/0/`
        }
      } else if(entityMode === 'lists') {
        return `/services/lists/${entityTypeId}/element/0/0/`
      }

      return ''
    }

    function setB24(b24: B24Frame) {
      $b24 = b24
    }

    /**
     * Initialize store from batch response data
     * @param data - Raw data from Bitrix24 API
     * @param data.version
     * @param data.status
     * @param data.configUfListSettings
     */
    function initFromBatch(data: {
      version?: number
      status?: TypeEnumAppStatus
      configUfListSettings?: Record<string, any>
    }) {
      if (data.status) {
        status.value = data.status
        isTrial.value = status.value === 'Trial'
      }

      if (data.version) {
        version.value = data.version
      }

      /**
       * @memo раскомментируй когда сделаешь страницу настроек
       */
      // if (data.configUfListSettings) {
      //   Object.assign(configUfListSettings, data.configUfListSettings)
      // }
    }

    /**
     * Save settings to Bitrix24
     */
    const saveSettings = async () => {
      if ($b24 === null) {
        console.error('B24 non init. Use appSettings.setB24()')
        return
      }

      return $b24.callMethod(
        'app.option.set',
        {
          configUfListSettings: JSON.parse(JSON.stringify(configUfListSettings))
        }
      )
    }
    // endregion ////

    return {
      version,
      isTrial,
      setB24,
      initFromBatch,
      saveSettings,
      configUfListSettings,
      getTargetPath,
      getNewTargetPath
    }
  }
)
