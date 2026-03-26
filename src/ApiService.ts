import axios, { AxiosRequestConfig } from "axios";
import { Buffer } from "buffer";
import {
  DocumentResponse,
  SaveFormDataRequest,
  SaveDataRequestContext,
  SaveDataRequestGeneric,
  SaveDataResponse,
} from "./apiService_types";
import {
  buildSaveDataHeaders,
  prepareSaveDataPayload,
  saveDataExponentialBackoffMs,
  shouldRetrySaveData,
  type SaveDataNormalizationPolicy,
} from "./saveDataPolicy";

/**
 * Сервис для работы с API Ficto.
 */
export class ApiService {
  /**
   * Универсальный обработчик ошибок axios.
   * @param error — пойманная ошибка
   * @param context — описание контекста (например, "Ошибка авторизации")
   * @throws Error с подробным сообщением
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleRequestError(error: any, context: string): never {
    let errorMsg = `${context}: `;

    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Подробная информация из ответа сервера
        errorMsg += `Статус ${error.response.status} – ${
          error.response.data?.message || JSON.stringify(error.response.data)
        }`;
      } else if (error.request) {
        // Ошибка при отправке запроса (нет ответа)
        errorMsg += "Нет ответа от сервера";
      } else {
        // Другие ошибки
        errorMsg += error.message;
      }
    } else {
      // Для не-Axios ошибок используем сообщение ошибки напрямую, если оно есть
      if (error?.message) {
        errorMsg += error.message;
      } else {
        errorMsg += "Неизвестная ошибка";
      }
    }
    throw new Error(errorMsg);
  }

  /**
   * Выполняет авторизацию пользователя.
   *
   * @param emailOrLogin - Email или логин пользователя.
   * @param password - Пароль пользователя.
   * @returns Объект с access_token и refresh_token.
   */
  async login(
    emailOrLogin: string,
    password: string
  ): Promise<{ access_token: string; refresh_token: string }> {
    // Проверяем, является ли значение email-адресом
    const isEmail = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(emailOrLogin);
    
    const baseLoginData = {
      password,
      remember_me: false,
      browser: {
        name: "chrome",
        version: "134.0.0",
        versionNumber: 134,
        mobile: false,
        os: "Windows 10",
      },
    };

    // Если это email - используем поле email
    if (isEmail) {
      const loginData = {
        ...baseLoginData,
        email: emailOrLogin,
      };

      try {
        const response = await axios.post(
          "https://api.ficto.ru/client/auth/login",
          loginData
        );
        return {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
        };
      } catch (error) {
        this.handleRequestError(error, "Ошибка авторизации");
      }
    }

    // Для логина пробуем разные варианты полей
    // Вариант 1: username
    try {
      const loginData = {
        ...baseLoginData,
        username: emailOrLogin,
      };
      const response = await axios.post(
        "https://api.ficto.ru/client/auth/login",
        loginData
      );
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
      };
    } catch (error) {
      // Продолжаем пробовать другие варианты
    }

    // Вариант 2: login
    try {
      const loginData = {
        ...baseLoginData,
        login: emailOrLogin,
      };
      const response = await axios.post(
        "https://api.ficto.ru/client/auth/login",
        loginData
      );
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
      };
    } catch (error) {
      // Продолжаем пробовать другие варианты
    }

    // Вариант 3: все равно пробуем email (на случай, если API принимает логин в поле email)
    let lastError: any = null;
    try {
      const loginData = {
        ...baseLoginData,
        email: emailOrLogin,
      };
      const response = await axios.post(
        "https://api.ficto.ru/client/auth/login",
        loginData
      );
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
      };
    } catch (error) {
      lastError = error;
    }

    // Если ничего не сработало, выбрасываем ошибку с информацией о последней попытке
    if (lastError && axios.isAxiosError(lastError) && lastError.response) {
      const errorMsg = lastError.response.data?.message || JSON.stringify(lastError.response.data);
      throw new Error(`Не удалось авторизоваться с логином "${emailOrLogin}". API вернул: ${errorMsg}`);
    }
    throw new Error(`Не удалось авторизоваться с логином "${emailOrLogin}". API Ficto может требовать email-адрес для авторизации.`);
  }

  /**
   * Получает UUID гранта пользователя.
   *
   * @param access_token - Токен доступа.
   * @returns UUID гранта.
   * @throws Error, если UUID не найден или произошла ошибка запроса.
   */
  async getUuid(access_token: string): Promise<string> {
    try {
      const response = await axios.get(
        "https://api.ficto.ru/client/grants?avalible=true&page=1",
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );
      let uuid = "";
      if (
        response.data &&
        Array.isArray(response.data.items) &&
        response.data.items.length > 0
      ) {
        uuid = response.data.items[0].uuid;
      }
      if (!uuid) {
        throw new Error("Нет доступных грантов (UUID не найден)");
      }
      return uuid;
    } catch (error) {
      this.handleRequestError(error, "Ошибка получения UUID");
    }
  }

  /**
   * Получает 19 init_token для заданного UUID.
   *
   * @param uuid - UUID гранта.
   * @param access_token - Токен доступа.
   * @returns Массив init_token.
   * @throws Error, если init_token не найден для одного из запросов.
   */
  async getInitTokens(
    uuid: string,
    access_token: string,
    options?: { requiredCount?: number; maxWorkspaceIndex?: number }
  ): Promise<string[]> {
    const initTokens: string[] = [];
    const requiredCount = options?.requiredCount ?? 1;
    const maxWorkspaceIndex = options?.maxWorkspaceIndex ?? 21;

    try {
      for (let i = 1; i <= maxWorkspaceIndex; i++) {
        try {
          const response = await axios.get(`https://api.ficto.ru/client/workspace/${uuid}/${i}`, {
            headers: { Authorization: `Bearer ${access_token}` }
          });
          const tokenValue = response.data?.item?.init_token;
          if (!tokenValue) {
            // Если сломанный/пустой workspace встретился после валидных — считаем это концом списка.
            if (initTokens.length > 0) break;
            throw new Error(`Init token не найден для запроса ${i}`);
          }
          initTokens.push(tokenValue);
        } catch (err) {
          // У части аккаунтов backend возвращает 500/404 на несуществующих хвостовых workspace.
          // После первого валидного токена трактуем это как окончание списка, а не фатальную ошибку.
          if (initTokens.length > 0) break;
          throw err;
        }
      }

      if (initTokens.length < requiredCount) {
        throw new Error(
          `Недостаточно init_token: нужно минимум ${requiredCount}, получено ${initTokens.length}`
        );
      }
      return initTokens;
    } catch (error) {
      this.handleRequestError(error, "Ошибка получения init_tokens");
    }
  }

  // Аналогичным образом можно добавить обработку ошибок и в другие методы

  /**
   * Экспортирует данные таблицы в формате XLSX для одного запроса.
   *
   * @param panelId - Идентификатор панели.
   * @param token - Токен авторизации.
   * @returns XLSX-файл в виде Buffer.
   */
  async exportTable(panelId: number, token: string): Promise<Buffer> {
    const url = "https://api.ficto.ru/client/layout/table/export";
    const data = {
      params: { panel_id: panelId },
      panel_id: panelId,
      token,
      separators: {},
    };

    try {
      const response = await axios.post(url, data, {
        headers: { "L-Token": token },
        responseType: "arraybuffer",
      });
      return Buffer.from(response.data);
    } catch (error) {
      this.handleRequestError(
        error,
        `Ошибка экспорта таблицы (panelId: ${panelId})`
      );
    }
  }

  /**
   * Экспортирует XLSX файлы для каждого init_token.
   *
   * @param tokens Массив init_token.
   * @returns Массив XLSX файлов в формате Buffer.
   */
  async exportAllTables(tokens: string[]): Promise<Buffer[]> {
    try {
      const exportPromises = tokens.map((token, index) => {
        const panelId = index === 0 ? 3293 : 3253 + (index - 1) * 2;
        return this.exportTable(panelId, token);
      });
      return await Promise.all(exportPromises);
    } catch (error) {
      this.handleRequestError(error, "Ошибка экспорта всех таблиц");
    }
  }
  /**
   * Сохраняет данные таблицы для любой секции.
   *
   * @param token - init_token для авторизации.
   * @param data - Объект вида { panel_id: number, table: Array<{ row_id, type_id, columns }> }.
   */
  // после упрощения
  async saveData(
    token: string,
    data: SaveDataRequestGeneric,
    ctx?: SaveDataRequestContext
  ): Promise<SaveDataResponse> {
    const url = "https://api.ficto.ru/client/layout/table/save-data";

    // #region agent log
    if (process.env.NODE_ENV !== "test") {
      fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ApiService.ts:saveData:meta',message:'saveData request meta',data:{hasParams:!!(data as any)?.params,params_panel_id:(data as any)?.params?.panel_id ?? null,panel_id:(data as any)?.panel_id ?? null,tableLen:Array.isArray((data as any)?.table)?(data as any).table.length:null,firstRowKeys:(Array.isArray((data as any)?.table)&& (data as any).table[0])?Object.keys((data as any).table[0]):null,firstRowHasPanelId:(Array.isArray((data as any)?.table)&& (data as any).table[0])?('panel_id' in (data as any).table[0]):false,firstRowHasTypeId:(Array.isArray((data as any)?.table)&& (data as any).table[0])?('type_id' in (data as any).table[0]):false},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'V'} )}).catch(()=>{});
    }
    // #endregion

    // Web-parity: normalize request body and apply request-scoped headers.
    const policy: SaveDataNormalizationPolicy = {
      nullAsEmptyString: false,
      includeRowIdField: "omit",
    };
    const preparedBody = prepareSaveDataPayload(data, policy);

    const makeHeaders = (body: unknown): Record<string, string> => ({
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "ru-RU,ru;q=0.9",
      Connection: "keep-alive",
      "Content-Type": "application/json",
      "L-Token": token,
      Host: "api.ficto.ru",
      Origin: "https://client.ficto.ru",
      Referer: "https://client.ficto.ru/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/134.0.0.0 Safari/537.36",
      "sec-ch-ua":
        '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Content-Length": String(Buffer.byteLength(JSON.stringify(body), "utf8")),
    });
    const headers = buildSaveDataHeaders(makeHeaders(preparedBody), ctx);

    // Логируем перед запросом
    console.log("--- saveData: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log("--- saveData: Request Body ---");
    console.log(JSON.stringify(preparedBody, null, 2));

    const makeConfig = (body: unknown): AxiosRequestConfig => ({
      headers: buildSaveDataHeaders(makeHeaders(body), ctx),
      transformRequest: [(b) => JSON.stringify(b)],
      decompress: false,
    });
    const config: AxiosRequestConfig = makeConfig(preparedBody);

    const maxAttempts = 3;
    let lastErr: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const resp = await axios.post<SaveDataResponse>(
          url,
          preparedBody,
          config
        );

        // Логируем ответ
        console.log("--- saveData: Response Status ---", resp.status);
        console.log("--- saveData: Response Body ---", resp.data);

        return resp.data;
      } catch (err: any) {
        lastErr = err;

        const status = err?.response?.status as number | undefined;
        const message = err?.response?.data?.message ?? err?.message;

        if (shouldRetrySaveData(status, message, attempt, maxAttempts)) {
          const backoffMs = saveDataExponentialBackoffMs(attempt, 50);
          // Avoid real timers in unit tests to keep runs deterministic/fast.
          if (process.env.NODE_ENV !== "test" && backoffMs > 0) {
            await new Promise((r) => setTimeout(r, backoffMs));
          }
          continue;
        }

        break;
      }
    }

    // #region agent log
    if (process.env.NODE_ENV !== "test") {
      fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ApiService.ts:saveData:catch',message:'saveData error details',data:{status:lastErr?.response?.status ?? null,data:lastErr?.response?.data ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'H2'} )}).catch(()=>{});
    }
    // #endregion

    if (axios.isAxiosError(lastErr)) {
      console.error("--- saveData: Error Status ---", lastErr.response?.status);
      console.error("--- saveData: Error Body ---", lastErr.response?.data);
    } else {
      console.error("--- saveData: Unexpected Error ---", lastErr);
    }
    this.handleRequestError(lastErr, "Ошибка сохранения данных");
  }

  async saveFormData(
    token: string,
    data: SaveFormDataRequest,
    ctx?: SaveDataRequestContext
  ): Promise<SaveDataResponse> {
    const url = "https://api.ficto.ru/client/layout/forms/save-data";

    const makeHeaders = (body: unknown): Record<string, string> => ({
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "ru-RU,ru;q=0.9",
      Connection: "keep-alive",
      "Content-Type": "application/json",
      "L-Token": token,
      Host: "api.ficto.ru",
      Origin: "https://client.ficto.ru",
      Referer: "https://client.ficto.ru/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/134.0.0.0 Safari/537.36",
      "sec-ch-ua":
        '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Content-Length": String(Buffer.byteLength(JSON.stringify(body), "utf8")),
    });

    const headers = buildSaveDataHeaders(makeHeaders(data), ctx);
    const config: AxiosRequestConfig = {
      headers,
      transformRequest: [(b) => JSON.stringify(b)],
      decompress: false,
    };

    const maxAttempts = 3;
    let lastErr: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const resp = await axios.post<SaveDataResponse>(url, data, config);
        return resp.data;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status as number | undefined;
        const message = err?.response?.data?.message ?? err?.message;
        if (shouldRetrySaveData(status, message, attempt, maxAttempts)) {
          const backoffMs = saveDataExponentialBackoffMs(attempt, 50);
          if (process.env.NODE_ENV !== "test" && backoffMs > 0) {
            await new Promise((r) => setTimeout(r, backoffMs));
          }
          continue;
        }
        break;
      }
    }

    this.handleRequestError(lastErr, "Ошибка сохранения реквизитов");
  }

  /**
   * Проверяет статус документа (заблокирован или нет).
   *
   * @param token - init_token для авторизации.
   * @returns Promise с DocumentResponse (включая build_id и флаги).
   */
  async getDocumentStatus(
    documentId: number,
    panelId: number,
    token: string
  ): Promise<DocumentResponse> {
    const url = `https://api.ficto.ru/client/layout/documents/${documentId}/status`;
    const data = { params: { panel_id: panelId }, fixation_params: {} };
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "L-Token": token,
    };

    console.log("--- getDocumentStatus: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log(
      "--- getDocumentStatus: Request Body ---",
      JSON.stringify(data, null, 2)
    );

    try {
      const resp = await axios.post<DocumentResponse>(url, data, { headers });
      console.log("--- getDocumentStatus: Response Status ---", resp.status);
      console.log("--- getDocumentStatus: Response Body ---", resp.data);
      return resp.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error(
        "--- getDocumentStatus: Error ---",
        err.response?.status,
        err.response?.data
      );
      this.handleRequestError(err, "Ошибка проверки статуса документа");
    }
  }

  /**
   * Отменяет блокировку документа.
   *
   * @param buildId - Идентификатор сборки (build_id) из ответа статуса.
   * @param panelId - Идентификатор панели документа.
   * @param token - init_token для авторизации.
   * @returns Promise<{status: boolean}>
   */
  async cancelDocumentLock(
    documentId: number,
    buildId: number,
    panelId: number,
    token: string
  ): Promise<{ status: boolean }> {
    const url = `https://api.ficto.ru/client/layout/documents/${documentId}/cancel`;
    const data = {
      params: { build_id: buildId, panel_id: panelId },
      fixation_params: {},
    };
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "L-Token": token,
    };

    console.log("--- cancelDocumentLock: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log(
      "--- cancelDocumentLock: Request Body ---",
      JSON.stringify(data, null, 2)
    );

    try {
      const resp = await axios.post<{ status: boolean }>(url, data, {
        headers,
      });
      console.log("--- cancelDocumentLock: Response Status ---", resp.status);
      console.log("--- cancelDocumentLock: Response Body ---", resp.data);
      return resp.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error(
        "--- cancelDocumentLock: Error ---",
        err.response?.status,
        err.response?.data
      );
      this.handleRequestError(
        err,
        `Ошибка отмены блокировки документа (buildId: ${buildId}, panelId: ${panelId})`
      );
    }
  }

  /**
   * Отзывает подпись документа.
   *
   * @param buildId — идентификатор сборки (build_id) из ответа getDocumentStatus
   * @param panelId — идентификатор панели документа
   * @param token — init_token для авторизации
   * @returns Promise<{ status: boolean }>
   */
  async revokeSignature(
    documentId: number,
    buildId: number,
    panelId: number,
    token: string
  ): Promise<{ status: boolean }> {
    const url = `https://api.ficto.ru/client/layout/documents/${documentId}/revoke`;
    const data = {
      params: { build_id: buildId, panel_id: panelId },
      fixation_params: {},
    };
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "L-Token": token,
    };

    console.log("--- revokeSignature: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log(
      "--- revokeSignature: Request Body ---",
      JSON.stringify(data, null, 2)
    );

    try {
      const resp = await axios.post<{ status: boolean }>(url, data, {
        headers,
      });
      console.log("--- revokeSignature: Response Status ---", resp.status);
      console.log("--- revokeSignature: Response Body ---", resp.data);
      return resp.data;
    } catch (err: any) {
      console.error(
        "--- revokeSignature: Error ---",
        err.response?.status,
        err.response?.data
      );
      this.handleRequestError(
        err,
        `Ошибка отзыва подписи документа (buildId: ${buildId}, panelId: ${panelId})`
      );
    }
  }

  /**
   * Завершает (комплитит) документ.
   *
   * @param buildId — идентификатор сборки из статуса документа.
   * @param panelId — идентификатор панели документа.
   * @param token — init_token для авторизации.
   * @returns Promise с `{ status: boolean }`.
   */
  async completeDocument(
    documentId: number,
    buildId: number,
    panelId: number,
    token: string
  ): Promise<{ status: boolean }> {
    const url = `https://api.ficto.ru/client/layout/documents/${documentId}/complite`;
    const data = {
      params: { build_id: buildId, panel_id: panelId },
      fixation_params: {},
    };
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "L-Token": token,
    };

    console.log("--- completeDocument: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log(
      "--- completeDocument: Request Body ---",
      JSON.stringify(data, null, 2)
    );

    try {
      const resp = await axios.post<{ status: boolean }>(url, data, {
        headers,
      });
      console.log("--- completeDocument: Response Status ---", resp.status);
      console.log("--- completeDocument: Response Body ---", resp.data);
      return resp.data;
    } catch (err: any) {
      console.error(
        "--- completeDocument: Error ---",
        err.response?.status,
        err.response?.data
      );
      this.handleRequestError(
        err,
        `Ошибка завершения документа (buildId: ${buildId}, panelId: ${panelId})`
      );
    }
  }

  /**
   * Проверяет документ на ошибки.
   *
   * @param documentId — идентификатор документа.
   * @param panelId — идентификатор панели документа.
   * @param userTimezone — смещение часового пояса пользователя.
   * @param token — init_token для авторизации.
   * @returns Promise с ответом API .
   */
  async checkErrors(
    documentId: number,
    panelId: number,
    userTimezone: number,
    token: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const url = `https://api.ficto.ru/client/layout/documents/${documentId}/check-errors`;
    const data = {
      params: {
        document_id: documentId,
        panel_id: panelId,
        user_timezone: userTimezone,
      },
      fixation_params: {},
    };
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "L-Token": token,
    };

    console.log("--- checkErrors: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log(
      "--- checkErrors: Request Body ---",
      JSON.stringify(data, null, 2)
    );

    try {
      const resp = await axios.post<any>(url, data, { headers });
      console.log("--- checkErrors: Response Status ---", resp.status);
      console.log("--- checkErrors: Response Body ---", resp.data);
      return resp.data;
    } catch (err: any) {
      console.error(
        "--- checkErrors: Error ---",
        err.response?.status,
        err.response?.data
      );
      this.handleRequestError(
        err,
        `Ошибка проверки документа на ошибки (documentId: ${documentId}, panelId: ${panelId})`
      );
    }
  }
}
