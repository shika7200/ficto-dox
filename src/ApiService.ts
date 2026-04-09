import axios, { AxiosRequestConfig } from "axios";
import https from "https";
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
  saveDataRetryBackoffMs,
  shouldRetrySaveData,
  type SaveDataNormalizationPolicy,
} from "./saveDataPolicy";

type TokenPair = {
  access_token: string;
  refresh_token: string;
};

type LoginOptions = {
  /**
   * Логин от `cabinet.miccedu.ru` для fallback-авторизации.
   * Если не задан или пустой (`""`/пробелы), используется `emailOrLogin` из обычного входа.
   */
  miccedoLogin?: string;
  /**
   * Пароль от `cabinet.miccedu.ru` для fallback-авторизации.
   * Если не задан или пустой (`""`/пробелы), используется `password` из обычного входа.
   */
  miccedoPass?: string;
};

type MiccedoTransactionCandidate = {
  access_code: string;
  client_id: string;
};

type EntitlementResponse = {
  request?: {
    users_entitlement?: Array<{ uid?: number }>;
    invite?: {
      access_code?: string;
      invite_code?: string;
    };
  };
};

type OrgAuthResponse = {
  status?: boolean;
  access_token?: string;
  refresh_token?: string;
};

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
   * Преобразует `Set-Cookie` заголовки в простую cookie-банку.
   *
   * Зачем это нужно:
   * - `cabinet.miccedu.ru` использует cookie-сессию;
   * - в Node/axios cookie не сохраняются автоматически между запросами;
   * - поэтому мы вручную извлекаем `key=value` из `Set-Cookie`.
   */
  private parseSetCookieHeaders(
    setCookie: string[] | string | undefined
  ): Record<string, string> {
    if (!setCookie) return {}
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
    const jar: Record<string, string> = {}

    for (const rawSetCookieHeader of arr) {
      // Пример Set-Cookie:
      // "ologin=5069; expires=...; path=/; domain=.cabinet.miccedu.ru"
      // Нам нужна только первая часть до ';' => "ologin=5069".
      const firstCookiePart = rawSetCookieHeader.split(";")[0]

      // Разделяем имя cookie и его значение по первому '='.
      const equalsSignIndex = firstCookiePart.indexOf("=")
      if (equalsSignIndex <= 0) continue

      const cookieName = firstCookiePart.slice(0, equalsSignIndex).trim()
      const cookieValue = firstCookiePart.slice(equalsSignIndex + 1).trim()
      if (!cookieName) continue

      jar[cookieName] = cookieValue
    }

    return jar
  }

  /**
   * Собирает заголовок `Cookie` для следующего HTTP-запроса.
   */
  private buildCookieHeader(jar: Record<string, string>): string {
    const cookiePairs = Object.entries(jar).map(
      ([cookieName, cookieValue]) => `${cookieName}=${cookieValue}`
    )
    return cookiePairs.join("; ")
  }

  /**
   * Нормализует сообщение ошибки для логов/исключений.
   */
  private extractAxiosErrorMessage(error: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e: any = error
    if (axios.isAxiosError(e)) {
      const status = e.response?.status
      const dataMessage =
        e.response?.data?.message ?? e.response?.data ?? e.message
      return status ? `HTTP ${status}: ${String(dataMessage)}` : String(dataMessage)
    }
    if (e instanceof Error) return e.message
    return String(e)
  }

  /**
   * Определяет типичные TLS-ошибки проверки сертификатной цепочки.
   */
  private isTlsChainError(error: unknown): boolean {
    const msg = this.extractAxiosErrorMessage(error).toLowerCase()
    return (
      msg.includes("unable to verify the first certificate") ||
      msg.includes("self-signed certificate") ||
      msg.includes("unable to get local issuer certificate")
    )
  }

  /**
   * Грубая эвристика: похоже ли это на ошибку авторизации.
   *
   * Нужна, чтобы fallback в miccedo включался только на auth-фейлах,
   * а не маскировал сетевые/внутренние ошибки Ficto API.
   */
  private isProbablyAuthFailure(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false
    const status = error.response?.status
    if (status === 401 || status === 403 || status === 409) return true

    // Sometimes auth errors come as 400 with message.
    if (status === 400) {
      const msg = this.extractAxiosErrorMessage(error).toLowerCase()
      return msg.includes("логин") || msg.includes("парол") || msg.includes("unauthor")
    }

    // Fallback: if backend message clearly points to auth creds.
    const msg = this.extractAxiosErrorMessage(error).toLowerCase()
    if (msg.includes("логин") || msg.includes("парол") || msg.includes("unauthor")) {
      return true
    }

    return false
  }

  /**
   * Выполняет fallback-авторизацию через `cabinet.miccedu.ru`.
   *
   * Цепочка:
   * 1) POST login в miccedo (получаем cookie-сессию);
   * 2) GET `/object/` с cookies и парсим `access_code/client_id` из HTML;
   * 3) GET `/client/entitlement` для получения `uid` и `invite_code`;
   * 4) POST `/client/entitlement/orgauth` и получаем пару токенов Ficto.
   *
   * @returns `access_token/refresh_token` в формате Ficto API.
   */
  private async loginViaMiccedo(
    miccedoLogin: string,
    miccedoPassword: string
  ): Promise<TokenPair> {
    const ltype = "default"
    const form = new URLSearchParams({
      ltype,
      login: String(miccedoLogin).trim(),
      pswrd: String(miccedoPassword),
    }).toString()

    /**
     * Локальный шаг логина в miccedo + чтение `/object/`.
     * При `allowInsecureTls=true` используется агент с `rejectUnauthorized=false`
     * только для этой ветки, чтобы пережить проблемы с цепочкой сертификатов.
     */
    const miccedoRequest = async (allowInsecureTls: boolean) => {
      const insecureAgent = allowInsecureTls
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined
      const commonCfg = {
        httpsAgent: insecureAgent,
        validateStatus: () => true,
      }

      const loginResp = await axios.post(
        "https://cabinet.miccedu.ru/",
        form,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          maxRedirects: 0,
          ...commonCfg,
        }
      )

      const jar = this.parseSetCookieHeaders(loginResp.headers["set-cookie"])
      if (Object.keys(jar).length === 0) {
        throw new Error("Miccedo: не удалось получить cookies после логина")
      }

      const objectResp = await axios.get(
        "https://cabinet.miccedu.ru/object/",
        {
          headers: { Cookie: this.buildCookieHeader(jar) },
          ...commonCfg,
        }
      )

      return objectResp
    }

    let objectResp: { data: unknown }
    try {
      objectResp = await miccedoRequest(false)
    } catch (e) {
      if (!this.isTlsChainError(e)) throw e
      // Some environments fail to build trust chain for miccedo certificate.
      // Retry only miccedo requests with relaxed verification.
      objectResp = await miccedoRequest(true)
    }

    const html: string = typeof objectResp.data === "string" ? objectResp.data : ""
    if (!html) {
      throw new Error("Miccedo: не удалось прочитать /object/ html")
    }

    // Ищем в HTML все ссылки формата:
    // https://client.ficto.ru/transaction/?access_code=...&client_id=...
    // Группа 1 = access_code, группа 2 = client_id.
    const transactionLinkPattern =
      /transaction\/\?access_code=([^&"'\\s]+)&client_id=([^&"'\\s]+)/g
    const candidates: MiccedoTransactionCandidate[] = []

    let transactionMatch: RegExpExecArray | null = null
    while (true) {
      transactionMatch = transactionLinkPattern.exec(html)
      if (!transactionMatch) break

      candidates.push({
        access_code: decodeURIComponent(transactionMatch[1]),
        client_id: decodeURIComponent(transactionMatch[2]),
      })
    }

    if (candidates.length === 0) {
      throw new Error("Miccedo: не найден transaction access_code/client_id")
    }

    let lastErr: unknown = null
    for (const cand of candidates) {
      try {
        const entResp = await axios.get<EntitlementResponse>(
          "https://api.ficto.ru/client/entitlement",
          { params: { client_id: cand.client_id, access_code: cand.access_code } }
        )

        const ent = entResp.data
        const uid: number | undefined = ent?.request?.users_entitlement?.[0]?.uid
        const inviteAccessCode: string | undefined =
          ent?.request?.invite?.access_code
        const inviteCode: string | undefined = ent?.request?.invite?.invite_code

        if (!uid || !inviteAccessCode || !inviteCode) {
          throw new Error("Miccedo: entitlement не содержит uid/invite_code")
        }

        const orgAuthResp = await axios.post<OrgAuthResponse>(
          "https://api.ficto.ru/client/entitlement/orgauth",
          {
            access_code: inviteAccessCode,
            invite_code: inviteCode,
            uid,
          },
          { validateStatus: () => true }
        )

        const body = orgAuthResp.data
        if (body?.status && body?.access_token && body?.refresh_token) {
          return {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
          }
        }

        throw new Error(
          `Miccedo: orgauth вернул неожиданный ответ: ${JSON.stringify(body).slice(
            0,
            300
          )}`
        )
      } catch (e) {
        lastErr = e
      }
    }

    throw new Error(
      `Miccedo fallback не сработал. Последняя ошибка: ${this.extractAxiosErrorMessage(
        lastErr
      )}`
    )
  }

  /**
   * Выполняет авторизацию пользователя.
   *
   * Этапы:
   * 1) Пытаемся войти напрямую в Ficto (`/client/auth/login`) несколькими
   *    вариантами поля логина (email/username/login).
   * 2) Если это похоже на auth-ошибку — запускаем fallback через miccedo.
   *
   * @param emailOrLogin Email или логин пользователя для прямого входа в Ficto.
   * @param password Пароль пользователя для прямого входа в Ficto.
   * @param options Опциональные учетные данные miccedo для fallback-ветки.
   * @returns Объект с `access_token` и `refresh_token`.
   */
  async login(
    emailOrLogin: string,
    password: string,
    options?: LoginOptions
  ): Promise<TokenPair> {
    const explicitMicceduLogin =
      typeof options?.miccedoLogin === "string" && options.miccedoLogin.trim()
        ? options.miccedoLogin
        : undefined
    const explicitMicceduPass =
      typeof options?.miccedoPass === "string" && options.miccedoPass.trim()
        ? options.miccedoPass
        : undefined

    // Если в JSON явно заданы непустые miccedu-логин и пароль —
    // считаем, что пользователь хочет авторизацию через cabinet.miccedu.ru в первую очередь.
    if (explicitMicceduLogin && explicitMicceduPass) {
      return this.loginViaMiccedo(explicitMicceduLogin, explicitMicceduPass)
    }

    // Проверяем, является ли значение email-адресом.
    const isEmail = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(
      emailOrLogin
    )

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
    }

    const attempts: Array<{
      desc: string
      payload: Record<string, unknown>
    }> = []

    if (isEmail) {
      attempts.push({
        desc: "ficto: email",
        payload: { ...baseLoginData, email: emailOrLogin },
      })
    }

    // Далее пробуем логин в разных полях — так же, как раньше, но без «раннего throw».
    attempts.push(
      {
        desc: "ficto: username",
        payload: { ...baseLoginData, username: emailOrLogin },
      },
      {
        desc: "ficto: login",
        payload: { ...baseLoginData, login: emailOrLogin },
      },
      {
        desc: "ficto: email (fallback)",
        payload: { ...baseLoginData, email: emailOrLogin },
      }
    )

    let lastAuthError: unknown = null
    for (const a of attempts) {
      try {
        const response = await axios.post(
          "https://api.ficto.ru/client/auth/login",
          a.payload
        )

        return {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
        }
      } catch (e) {
        lastAuthError = e
      }
    }

    // Важно: fallback в miccedo пробуем только при признаках ошибки аутентификации.
    if (!this.isProbablyAuthFailure(lastAuthError)) {
      throw new Error(
        `Не удалось авторизоваться в Ficto. Ошибка: ${this.extractAxiosErrorMessage(
          lastAuthError
        )}`
      )
    }

    try {
      const miccedoLogin = explicitMicceduLogin ?? emailOrLogin
      const miccedoPass = explicitMicceduPass ?? password
      return await this.loginViaMiccedo(miccedoLogin, miccedoPass)
    } catch (miccedoErr) {
      throw new Error(
        [
          `Не удалось авторизоваться в Ficto с логином "${emailOrLogin}".`,
          `Ficto error: ${this.extractAxiosErrorMessage(lastAuthError)}`,
          `Miccedo fallback error: ${this.extractAxiosErrorMessage(miccedoErr)}`,
        ].join(" ")
      )
    }
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
      const headers = { Authorization: `Bearer ${access_token}` }

      const extractUuidFromResponse = (data: unknown): string => {
        const d = data as any
        const candidates: Array<any> =
          (Array.isArray(d?.items) ? d.items : []) ||
          (Array.isArray(d?.grants) ? d.grants : [])
        const first = candidates.find((x) => typeof x?.uuid === "string" && x.uuid.trim())
        return first?.uuid ?? ""
      }

      const attempts: string[] = []

      const tryUrls = [
        "https://api.ficto.ru/client/grants?avalible=true&page=1",
        "https://api.ficto.ru/client/grants?avalible=true&page=2",
        "https://api.ficto.ru/client/grants?avalible=true&page=3",
        "https://api.ficto.ru/client/grants?avalible=false&page=1",
        "https://api.ficto.ru/client/grants?avalible=false&page=2",
        "https://api.ficto.ru/client/grants?avalible=false&page=3",
        "https://api.ficto.ru/client/grants?page=1",
        "https://api.ficto.ru/client/grants?page=2",
        "https://api.ficto.ru/client/grants?page=3",
      ]

      for (const url of tryUrls) {
        attempts.push(url)
        const response = await axios.get(url, { headers })
        const uuid = extractUuidFromResponse(response.data)
        if (uuid) return uuid
      }

      throw new Error(
        `Нет доступных грантов (UUID не найден). Попытки: ${attempts.slice(
          0,
          5
        )}${attempts.length > 5 ? "..." : ""}`
      )
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

  /**
   * Получает init_token для конкретного workspace индекса.
   *
   * @param uuid - UUID гранта.
   * @param access_token - Bearer токен.
   * @param workspaceIndex - Индекс workspace (например, 21).
   */
  async getInitTokenByWorkspaceIndex(
    uuid: string,
    access_token: string,
    workspaceIndex: number
  ): Promise<string> {
    try {
      const response = await axios.get(
        `https://api.ficto.ru/client/workspace/${uuid}/${workspaceIndex}`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );
      const tokenValue = response.data?.item?.init_token;
      if (!tokenValue) {
        throw new Error(
          `Init token не найден для workspace ${workspaceIndex}`
        );
      }
      return tokenValue;
    } catch (error) {
      this.handleRequestError(
        error,
        `Ошибка получения init_token для workspace ${workspaceIndex}`
      );
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

    const maxAttempts = 20;
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
          const backoffMs = saveDataRetryBackoffMs(status, message, attempt);
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

    const maxAttempts = 20;
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
          const backoffMs = saveDataRetryBackoffMs(status, message, attempt);
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
