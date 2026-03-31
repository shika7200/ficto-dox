import { dataMapping } from "./mapping_oo-2_2025";

export type ReportType = "report17" | "form_1od_2025";

/**
 * Строка таблицы для сохранения данных.
 * panel_id не включается в каждую строку, он задаётся на уровне запроса.
 */
export interface SaveDataRowRaw<TColumns> {
  row_id: number;
  type_id: number;
  columns: TColumns;
}

/**
 * Обобщённый интерфейс запроса сохранения данных.
 * panel_id задаётся один раз, а массив table содержит строки без panel_id.
 */
export interface SaveDataRequest<TPanelId extends number, TColumns> {
  panel_id: TPanelId;
  table: SaveDataRowRaw<TColumns>[];
}

/**
 * Обобщённый тип строки в таблице (не требует конкретных ключей столбцов).
 */
export interface SaveDataRowRawGeneric {
  row_id: number;
  type_id: number;
  columns: Record<string, number | string | null>;
}

/**
 * Обобщённый тип запроса сохранения данных для любой секции.
 */
export interface SaveDataRequestGeneric {
  panel_id: number;
  table: SaveDataRowRawGeneric[];
}

export interface SaveFormDataRequest {
  params: {
    panel_id: number;
  };
  fixation_params: Record<string, unknown>;
  data: Record<string, string>;
}

/**
 * Маппинг секций к обобщённому типу запроса.
 */
export type SaveDataMappingGeneric = Record<keyof typeof dataMapping, SaveDataRequestGeneric>;

/**
 * Ответ сервера при сохранении данных.
 */
export interface SaveDataResponse {
  status: boolean;
}

/**
 * Ответ при проверке статуса документа.
 */
export interface DocumentResponse {
  status: boolean;
  document: {
    signature_access: boolean;
    validations_errors: unknown[];
    build_id: number;
    status_id: number;
    message: string | null;
    dateadd: string;
    dateupdate: string;
    approved: boolean;
    username: string;
    disabled_complite: boolean;
    show_prem_preloader: boolean;
    show_prem_download: boolean;
    show_disabled: boolean;
    show_btn_signature: boolean;
    show_download_ready: boolean;
    show_message: boolean;
    is_active: boolean;
    show_not_accepted: boolean;
    show_errors: boolean;
    show_btn_complite: boolean;
    allowed_delete_build: boolean;
    file_preliminary_link: string | null;
    file_cert_logo_link: string | null;
  };
  fixation: {
    items: unknown[];
    history: Record<string, unknown>;
  };
  disabled: boolean;
}

/**
 * Входной JSON с факторами и логинами.
 */
export interface InputJson {
  doxcellLogin: string;
  fictoLogin: string;
  fictoPass: string;
  /** Опциональные учетные данные cabinet.miccedu.ru для fallback-авторизации. */
  micceduLogin?: string;
  micceduPass?: string;
  documentId: string;
  reportType?: ReportType;
  completeDocument?: boolean;
  /** Переопределить panel_id для check-errors (если не задано — из reportConfig). */
  checkErrorsPanelId?: number;
  /** Переопределить document_id для check-errors (если не задано — fallback в логике). */
  fictoDocumentId?: number;
  factors: Record<string, string>;
}

export type SaveDataRequestContext = {
  fingerprint?: string;
  sessionId?: string;
};
