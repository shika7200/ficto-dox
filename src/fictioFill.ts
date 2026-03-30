import { ApiService } from "./ApiService"
import { InputJson, SaveDataRequestGeneric, SaveFormDataRequest } from "./apiService_types"
import { createSectionRequest } from "./parse_Doxcelljson"
import { getReportConfig } from "./reportConfig"

export function chooseTokenIndexForPanel(
  panelId: number,
  panelTokenIndex: Map<number, number>,
  fallbackTokenIdx: number
): number {
  return panelTokenIndex.get(panelId) ?? fallbackTokenIdx
}

export function shouldProbeAlternativeToken(
  strictPageBinding: boolean,
  err: unknown
): boolean {
  if (strictPageBinding) return false
  const e = err as any
  const msg = e?.response?.data?.message ?? e?.message ?? ""
  return String(msg).includes("Необработанная ошибка")
}

/**
 * Заполняет все секции в Ficto. Возвращает { success: true } при успешном выполнении.
 */
export async function FictioFill(inputJson: InputJson): Promise<{ success: true }> {
  const api = new ApiService()
  const reportConfig = getReportConfig(inputJson.reportType)
  const mapping = reportConfig.mapping
  const sectionKeys = Object.keys(mapping) as Array<keyof typeof mapping>
  const shouldComplete =
    inputJson.completeDocument ?? reportConfig.defaultCompleteDocument ?? false
  const panelIdBySection = reportConfig.panelIdBySection

  const safeDecodeArticleId = (jwt: string): number | null => {
    try {
      const parts = jwt.split(".")
      if (parts.length < 2) return null
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
      const json = Buffer.from(b64, "base64").toString("utf8")
      const payload = JSON.parse(json)
      return typeof payload?.article_id === "number" ? payload.article_id : null
    } catch {
      return null
    }
  }

  const strictPageBinding = true

  const extractPanelId = (requestData: unknown): number | null => {
    const r = requestData as any
    const panelId = r?.panel_id ?? r?.params?.panel_id ?? null
    return typeof panelId === "number" ? panelId : null
  }

  const sendSectionRequest = async (
    token: string,
    sectionKey: string,
    requestData: unknown
  ) => {
    if (sectionKey === "SECTION_0") {
      return api.saveFormData(token, requestData as SaveFormDataRequest, saveDataCtx)
    }
    return api.saveData(token, requestData as SaveDataRequestGeneric, saveDataCtx)
  }

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:entry',message:'FictioFill entry',data:{reportType:inputJson?.reportType,shouldComplete,hasDocumentId:!!inputJson?.documentId,factorsCount:inputJson?.factors?Object.keys(inputJson.factors).length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'P'} )}).catch(()=>{});
  // #endregion

  // Извлекаем логин и пароль из inputJson
  const email = inputJson.fictoLogin
  const password = inputJson.fictoPass

  // Авторизация и получение init-токенов
  const { access_token } = await api.login(email, password)
  const uuid = await api.getUuid(access_token)
  const minRequiredTokens = shouldComplete ? 2 : 1
  const initTokens = await api.getInitTokens(uuid, access_token, {
    requiredCount: minRequiredTokens,
    maxWorkspaceIndex: 21,
  })

  if (initTokens.length < minRequiredTokens) {
    throw new Error(`Ожидалось минимум ${minRequiredTokens} initTokens, получили ${initTokens.length}`)
  }

  // Последний токен — для операций со статусом документа
  const statusToken = initTokens[initTokens.length - 1]
  // Если документ не завершаем — можно использовать ВСЕ initTokens для saveData.
  // Если завершаем — последний токен оставляем под операции со статусом/комплитом.
  const tokensAvailableLen = shouldComplete ? initTokens.length - 1 : initTokens.length
  const tokenArticles = initTokens.slice(0, 10).map((t, idx) => ({
    idx,
    article_id: safeDecodeArticleId(t),
  }))
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:tokens:meta',message:'initTokens article_id sample',data:{count:initTokens.length,sample:tokenArticles,lastArticleId:safeDecodeArticleId(statusToken)},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'H4'} )}).catch(()=>{});
  // #endregion
  const documentId = Number(inputJson.documentId) || reportConfig.documentId
  const statusPanelId = reportConfig.statusPanelId
  const saveDataCtx = {
    fingerprint: String(documentId),
    sessionId: "debug-session",
  }

  const assertDocumentHasNoCheckErrors = async () => {
    if (!documentId || !statusPanelId) return
    const checkResult = await api.checkErrors(
      documentId,
      statusPanelId,
      7,
      statusToken
    )
    if (Array.isArray(checkResult.errors) && checkResult.errors.length > 0) {
      console.error("Обнаружены ошибки при проверке документа:", checkResult.errors)
      throw new Error("Обнаружены ошибки в документе — завершение отменено")
    }
  }

  const afterSectionSavedIfNeeded = async () => {
    if (reportConfig.runCheckErrorsAfterEachSection && documentId && statusPanelId) {
      await assertDocumentHasNoCheckErrors()
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:status:inputs',message:'Status inputs resolved',data:{documentId:documentId??null,statusPanelId:statusPanelId??null,shouldComplete},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'P'} )}).catch(()=>{});
  // #endregion

  // Проверяем статус/снимаем блокировку ТОЛЬКО если планируем завершать документ.
  // Для form_1od_2025 по умолчанию shouldComplete=false, и статус-панель может быть запрещена (409).
  if (shouldComplete && documentId && statusPanelId) {
    const docStatus = await api.getDocumentStatus(documentId, statusPanelId, statusToken)
    if (docStatus.document.disabled_complite) {
      try {
        await api.cancelDocumentLock(
          documentId,
          docStatus.document.build_id,
          statusPanelId,
          statusToken
        )
      } catch (err: any) {
        const msg = err.message || ""
        if (
          msg.includes("Статус 409") &&
          msg.includes("запрещено изменение статуса отчета")
        ) {
          console.log("Документ подписан, вызываем revokeSignature…")
          await api.revokeSignature(
            documentId,
            docStatus.document.build_id,
            statusPanelId,
            statusToken
          )
        } else {
          throw err
        }
      }
    }
  } else {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:status:skipped',message:'Skipping document status/lock ops',data:{reason:!shouldComplete?'shouldComplete=false':'missing documentId/statusPanelId',documentId:documentId??null,statusPanelId:statusPanelId??null},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'Q'} )}).catch(()=>{});
    // #endregion
  }
  
  // Определяем стартовый token index: пробуем подобрать такой init_token, который реально принимает saveData для первой секции.
  const firstSectionKey = sectionKeys[0]
  const firstRequest = createSectionRequest(
    firstSectionKey as string,
    inputJson,
    mapping,
    reportConfig.dynamicSectionKey,
    panelIdBySection
  )
  const firstPanelId = extractPanelId(firstRequest)
  if (firstPanelId === null) {
    throw new Error(`Не удалось определить panel_id для секции ${String(firstSectionKey)}`)
  }

  // Remembers a working init_token index per `panel_id` for stable save-data routing.
  const panelTokenIndex = new Map<number, number>()

  const startTokenIdx = 0
  const firstSectionAlreadySaved = false
  panelTokenIndex.set(firstPanelId, startTokenIdx)

  // Циклическое переиспользование токенов, когда workspace меньше секций (API принимает один token для разных panel_id)
  const tokenIdxForSection = (sectionIdx: number) =>
    (startTokenIdx! + sectionIdx) % tokensAvailableLen

  // Заполняем каждую секцию по порядку
  for (let sectionIdx = firstSectionAlreadySaved ? 1 : 0; sectionIdx < sectionKeys.length; sectionIdx++) {
    const sectionKey = sectionKeys[sectionIdx]
    
    // Создаем запрос на основе ключа секции
    const requestData = createSectionRequest(
      sectionKey as string,
      inputJson,
      mapping,
      reportConfig.dynamicSectionKey,
      panelIdBySection
    )

    const panelId = extractPanelId(requestData)
    if (panelId === null) {
      throw new Error(`Не удалось определить panel_id для секции ${String(sectionKey)}`)
    }
    const fallbackTokenIdx = tokenIdxForSection(sectionIdx)
    const tokenIdx = chooseTokenIndexForPanel(
      panelId,
      panelTokenIndex,
      fallbackTokenIdx
    )
    const token = initTokens[tokenIdx]

    // Отправляем данные
    try {
      await sendSectionRequest(token, String(sectionKey), requestData)
      panelTokenIndex.set(panelId, tokenIdx)
      await afterSectionSavedIfNeeded()
    } catch (err) {
      // In strict page binding mode we do not probe other tokens/articles.
      if (shouldProbeAlternativeToken(strictPageBinding, err)) {
        let recovered = false
        for (let probeIdx = 0; probeIdx < tokensAvailableLen; probeIdx++) {
          if (probeIdx === tokenIdx) continue
          const probeToken = initTokens[probeIdx]
          try {
            await sendSectionRequest(probeToken, String(sectionKey), requestData)
            recovered = true
            panelTokenIndex.set(panelId, probeIdx)
            await afterSectionSavedIfNeeded()
            break
          } catch {
            // try next token
          }
        }
        if (recovered) {
          continue
        }
      }

      throw err
    }
  }

  if (
    reportConfig.runCheckErrorsAfterFill &&
    documentId &&
    statusPanelId &&
    !reportConfig.runCheckErrorsAfterEachSection
  ) {
    await assertDocumentHasNoCheckErrors()
  }

  if (shouldComplete && documentId && statusPanelId) {
    const refreshedInitTokens = await api.getInitTokens(uuid, access_token, { requiredCount: 1 })
    const refreshedstatusToken = refreshedInitTokens[refreshedInitTokens.length - 1]
    const refreshed = await api.getDocumentStatus(documentId, statusPanelId, refreshedstatusToken);
    // Наконец – комплитим с правильным build_id
    await api.completeDocument(
      documentId,
      refreshed.document.build_id,
      statusPanelId,
      refreshedstatusToken
    );
  }
  return { success: true }
}
