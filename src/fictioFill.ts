import { ApiService } from "./ApiService"
import { InputJson, SaveDataRequestGeneric } from "./apiService_types"
import { createSectionRequest } from "./parse_Doxcelljson"
import { getReportConfig } from "./reportConfig"

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

  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:entry',message:'FictioFill entry',data:{reportType:inputJson?.reportType,shouldComplete,hasDocumentId:!!inputJson?.documentId,factorsCount:inputJson?.factors?Object.keys(inputJson.factors).length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'P'} )}).catch(()=>{});
  // #endregion

  // Извлекаем логин и пароль из inputJson
  const email = inputJson.fictoLogin
  const password = inputJson.fictoPass

  // Авторизация и получение init-токенов
  const { access_token } = await api.login(email, password)
  const uuid = await api.getUuid(access_token)
  const initTokens = await api.getInitTokens(uuid, access_token)

  if (initTokens.length < 2) {
    throw new Error(`Ожидалось минимум 2 initTokens, получили ${initTokens.length}`)
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
  ) as SaveDataRequestGeneric

  let startTokenIdx: number | null = null
  let firstSectionAlreadySaved = false
  const candidates = [1, 0, 2, 3, 4].filter(
    (i) => i >= 0 && i < tokensAvailableLen
  )
  for (const cand of candidates) {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:startToken:try',message:'Trying start token candidate for first section',data:{cand,sectionKey:String(firstSectionKey),panel_id:(firstRequest as any)?.panel_id ?? null,article_id:safeDecodeArticleId(initTokens[cand])},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'H5'} )}).catch(()=>{});
    // #endregion
    try {
      await api.saveData(initTokens[cand], firstRequest)
      startTokenIdx = cand
      firstSectionAlreadySaved = true
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:startToken:ok',message:'Selected start token for first section',data:{startTokenIdx:cand,article_id:safeDecodeArticleId(initTokens[cand])},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'H5'} )}).catch(()=>{});
      // #endregion
      break
    } catch (err: any) {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:startToken:fail',message:'Start token candidate failed',data:{cand,errorMessage:err?.message ?? String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'H5'} )}).catch(()=>{});
      // #endregion
    }
  }
  if (startTokenIdx === null) {
    throw new Error("Не удалось подобрать init_token для первой секции (saveData всегда падает)")
  }

  if (startTokenIdx + sectionKeys.length > tokensAvailableLen) {
    throw new Error(
      `Недостаточно initTokens для всех секций: startTokenIdx=${startTokenIdx}, секций=${sectionKeys.length}, доступно токенов=${tokensAvailableLen}`
    )
  }

  // Заполняем каждую секцию по порядку
  for (
    let sectionIdx = firstSectionAlreadySaved ? 1 : 0;
    sectionIdx < sectionKeys.length && startTokenIdx + sectionIdx < tokensAvailableLen;
    sectionIdx++
  ) {
    const tokenIdx = startTokenIdx + sectionIdx
    const token = initTokens[tokenIdx]
    const sectionKey = sectionKeys[sectionIdx]
    
    // Создаем запрос на основе ключа секции
    const requestData = createSectionRequest(
      sectionKey as string,
      inputJson,
      mapping,
      reportConfig.dynamicSectionKey,
      panelIdBySection
    ) as SaveDataRequestGeneric

    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fictioFill.ts:saveData:before',message:'About to call saveData',data:{tokenIndex:tokenIdx,sectionIndex:sectionIdx,sectionKey:String(sectionKey),panel_id:(requestData as any)?.panel_id ?? null,params_panel_id:(requestData as any)?.params?.panel_id ?? null,tableLen:Array.isArray((requestData as any)?.table)?(requestData as any).table.length:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'U'} )}).catch(()=>{});
    // #endregion
    
    // Отправляем данные
    await api.saveData(token, requestData)
  }

  if (shouldComplete && documentId && statusPanelId) {
    // Проверяем документ на ошибки
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


  if (shouldComplete && documentId && statusPanelId) {
    const refreshedInitTokens = await api.getInitTokens(uuid, access_token)
    const refreshedstatusToken = initTokens[refreshedInitTokens.length - 1]
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
