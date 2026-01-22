import axios, { AxiosRequestConfig } from "axios";
import { Buffer } from "buffer";
import {
  DocumentResponse,
  SaveDataRequestGeneric,
  SaveDataResponse,
} from "./apiService_types";

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
      errorMsg += "Неизвестная ошибка";
    }
    throw new Error(errorMsg);
  }

  /**
   * Выполняет авторизацию пользователя.
   *
   * @param email - Электронная почта пользователя.
   * @param password - Пароль пользователя.
   * @returns Объект с access_token и refresh_token.
   */
  async login(
    email: string,
    password: string
  ): Promise<{ access_token: string; refresh_token: string }> {
    const loginData = {
      email,
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
        throw new Error("UUID не найден");
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
  async getInitTokens(uuid: string, access_token: string): Promise<string[]> {
    const initTokens: string[] = [];

    try {
      for (let i = 1; i <= 21; i++) {
        const response = await axios.get(`https://api.ficto.ru/client/workspace/${uuid}/${i}`, {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        const tokenValue = response.data?.item?.init_token;
        if (!tokenValue) {
          // Генерируем и выбрасываем ошибку с указанием номера запроса
          throw new Error(`Init token не найден для запроса ${i}`);
        }
        initTokens.push(tokenValue);
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
    data: SaveDataRequestGeneric
  ): Promise<SaveDataResponse> {
    const url = "https://api.ficto.ru/client/layout/table/save-data";

    // Тема заголовков — копия из вашего Bun-скрипта
    const headers: Record<string, string> = {
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
      "Content-Length": String(Buffer.byteLength(JSON.stringify(data), "utf8")),
    };

    // Логируем перед запросом
    console.log("--- saveData: Request Headers ---");
    console.dir(headers, { depth: null });
    console.log("--- saveData: Request Body ---");
    console.log(JSON.stringify(data, null, 2));

    const config: AxiosRequestConfig = {
      headers,
      transformRequest: [(body) => JSON.stringify(body)],
      decompress: false,
    };

    try {
      const resp = await axios.post<SaveDataResponse>(url, data, config);

      // Логируем ответ
      console.log("--- saveData: Response Status ---", resp.status);
      console.log("--- saveData: Response Body ---", resp.data);

      return resp.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        console.error("--- saveData: Error Status ---", err.response?.status);
        console.error("--- saveData: Error Body ---", err.response?.data);
      } else {
        console.error("--- saveData: Unexpected Error ---", err);
      }
      throw err;
    }
  }

  /**
   * Проверяет статус документа (заблокирован или нет).
   *
   * @param token - init_token для авторизации.
   * @returns Promise с DocumentResponse (включая build_id и флаги).
   */
  async getDocumentStatus(token: string): Promise<DocumentResponse> {
    // Фиксированный endpoint
    const url = "https://api.ficto.ru/client/layout/documents/299/status";
    const data = { params: { panel_id: 3289 }, fixation_params: {} };
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
    buildId: number,
    panelId: number,
    token: string
  ): Promise<{ status: boolean }> {
    const url = `https://api.ficto.ru/client/layout/documents/299/cancel`;
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
    buildId: number,
    panelId: number,
    token: string
  ): Promise<{ status: boolean }> {
    const url = "https://api.ficto.ru/client/layout/documents/299/revoke";
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
    buildId: number,
    panelId: number,
    token: string
  ): Promise<{ status: boolean }> {
    const url = "https://api.ficto.ru/client/layout/documents/299/complite";
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
    const url = "https://api.ficto.ru/client/layout/documents/299/check-errors";
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
