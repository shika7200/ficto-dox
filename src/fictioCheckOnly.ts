import { ApiService } from "./ApiService"
import type { InputJson } from "./apiService_types"
import { getReportConfig } from "./reportConfig"

export type FictioCheckOnlyResult = {
  documentId: number
  panelId: number
  errors: unknown[]
  raw: unknown
}

/**
 * Только вызов check-errors по documentId из JSON — без saveData / saveFormData.
 */
export async function FictioCheckOnly(
  inputJson: InputJson
): Promise<FictioCheckOnlyResult> {
  const api = new ApiService()
  const reportConfig = getReportConfig(inputJson.reportType)

  const email = inputJson.fictoLogin
  const password = inputJson.fictoPass

  const { access_token } = await api.login(email, password, {
    miccedoLogin: inputJson.micceduLogin,
    miccedoPass: inputJson.micceduPass,
  })
  const uuid = await api.getUuid(access_token)
  const initTokens = await api.getInitTokens(uuid, access_token, {
    requiredCount: 1,
    maxWorkspaceIndex: 21,
  })

  if (initTokens.length < 1) {
    throw new Error(`Ожидался минимум 1 initToken, получили ${initTokens.length}`)
  }

  const statusToken = initTokens[initTokens.length - 1]
  const statusPanelId = reportConfig.statusPanelId
  const checkErrorsPanelId =
    (typeof inputJson.checkErrorsPanelId === "number" &&
    Number.isFinite(inputJson.checkErrorsPanelId)
      ? inputJson.checkErrorsPanelId
      : undefined) ??
    reportConfig.checkErrorsPanelId ??
    statusPanelId

  const checkErrorsDocumentId =
    typeof inputJson.fictoDocumentId === "number" &&
    Number.isFinite(inputJson.fictoDocumentId)
      ? inputJson.fictoDocumentId
      : 339

  if (!checkErrorsPanelId) {
    throw new Error(
      "Не заданы documentId или panel для check-errors (проверьте JSON и тип отчёта)"
    )
  }

  const raw = await api.checkErrors(
    checkErrorsDocumentId,
    checkErrorsPanelId,
    7,
    statusToken
  )
  const errors = Array.isArray((raw as { errors?: unknown })?.errors)
    ? ((raw as { errors: unknown[] }).errors)
    : []

  return {
    documentId: checkErrorsDocumentId,
    panelId: checkErrorsPanelId,
    errors,
    raw,
  }
}
