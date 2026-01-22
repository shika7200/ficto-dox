import { ApiService } from "./ApiService"
import { InputJson, SaveDataRequestGeneric } from "./apiService_types"
import { dataMapping } from "./mapping"
import { createSectionRequest } from "./parse_Doxcelljson"

/**
 * Заполняет все секции в Ficto. Возвращает { success: true } при успешном выполнении.
 */
export async function FictioFill(inputJson: InputJson): Promise<{ success: true }> {
  const api = new ApiService()

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
  const fixedPanelId = 3289

  // Проверяем статус документа и снимаем блокировку, если нужно
  const docStatus = await api.getDocumentStatus(statusToken)
  if (docStatus.document.disabled_complite) {
    try {
      await api.cancelDocumentLock(
        docStatus.document.build_id,
        fixedPanelId,
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
          docStatus.document.build_id,
          fixedPanelId,
          statusToken
        )
      } else {
        throw err
      }
    }
  }

  // Получаем все ключи секций, включая новую секцию 11
  const sectionKeys = Object.keys(dataMapping) as Array<keyof typeof dataMapping>
  
  // Заполняем каждую секцию по порядку
  for (
    let idx = 0;
    idx < initTokens.length - 1 && idx < sectionKeys.length;
    idx++
  ) {
    const token = initTokens[idx]
    const sectionKey = sectionKeys[idx]
    
    // Создаем запрос на основе ключа секции
    const requestData = createSectionRequest(
      sectionKey,
      inputJson
    ) as SaveDataRequestGeneric
    
    // Отправляем данные
    await api.saveData(token, requestData)
  }

  // Проверяем документ на ошибки (documentId=299, panelId=3289, userTimezone=7)
  const checkResult = await api.checkErrors(
    299,
    fixedPanelId,
    7,
    statusToken
  )
  if (Array.isArray(checkResult.errors) && checkResult.errors.length > 0) {
    console.error("Обнаружены ошибки при проверке документа:", checkResult.errors)
    throw new Error("Обнаружены ошибки в документе — завершение отменено")
  }


  console.log("=== DEBUG INFO BEFORE COMPLETE ===");
  console.log("initTokens.length:", initTokens.length);
  console.log("Последний токен (index " + (initTokens.length - 1) + "):", initTokens[initTokens.length - 1]);
  console.log("statusToken для completeDocument:", statusToken);
  console.log("Текущий build_id:", docStatus.document.build_id);
  console.log("Текущий panelId:", fixedPanelId);
  console.log("Статус документа:", docStatus.document);
  console.log("=== END DEBUG INFO ===");

  
  const refreshedInitTokens = await api.getInitTokens(uuid, access_token)
  const refreshedstatusToken = initTokens[refreshedInitTokens.length - 1]
  const refreshed = await api.getDocumentStatus(refreshedstatusToken);
  // Наконец – комплитим с правильным build_id
  await api.completeDocument(
    refreshed.document.build_id,
    fixedPanelId,
    refreshedstatusToken
  );
  return { success: true }
}
