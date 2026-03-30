import { dataMapping as report17Mapping } from "./mapping_oo-2_2025";
import { dataMapping as form1Od2025Mapping } from "./mapping(1-ОД_2025)полный.ts";
import { ReportType } from "./apiService_types";

export type ReportConfig = {
  mapping: Record<string, unknown>;
  dynamicSectionKey?: string;
  documentId?: number;
  /** Панель для status / complete / блокировок (из шаблона Ficto). */
  statusPanelId?: number;
  /**
   * Панель для API check-errors. Должна входить в layout документа; иначе 409 «Запрещено использование данной панели».
   * По умолчанию для ОО-2 — SECTION_0 (та же, что для реквизитов), не «статусная» 3289 от doc 299.
   */
  checkErrorsPanelId?: number;
  defaultCompleteDocument?: boolean;
  panelIdBySection?: Record<string, number>;
  runCheckErrorsAfterFill: boolean;
  runCheckErrorsAfterEachSection: boolean;
};

const FORM_1OD_2025_PANEL_IDS: Record<string, number> = {
  SECTION_1_1: 4447,
  SECTION_1_2: 4448,
  SECTION_2_1: 4449,
  SECTION_2_2: 4450,
  SECTION_2_3: 4451,
  SECTION_2_4: 4452,
  SECTION_2_5: 4453,
  SECTION_2_6: 4454,
  SECTION_2_7: 4455,
  SECTION_2_8: 4456,
  SECTION_2_9: 4457,
  SECTION_3: 4458,
  SECTION_4_1: 4460,
  SECTION_4_2: 4459,
  SECTION_5_1: 4461,
  SECTION_5_1_1: 4462,
  SECTION_5_2: 4463,
  SECTION_5_2_1: 4464,
  SECTION_5_3: 4465,
  SECTION_6: 4466,
};

const OO2_PANEL_IDS: Record<string, number> = {
  SECTION_0: 4483,
  SECTION_11: 4484,
  SECTION_12: 4485,
  SECTION_13: 4488,
  SECTION_14: 4469,
  SECTION_15: 4470,
  SECTION_16: 4471,
  SECTION_21: 4472,
  SECTION_22: 4473,
  SECTION_23: 4474,
  SECTION_24: 4475,
  SECTION_25: 4476,
  SECTION_26: 4477,
  SECTION_27: 4478,
  SECTION_31: 4479,
  SECTION_32: 4480,
  SECTION_33: 4481,
  SECTION_34: 4486,
  SECTION_35: 4487,
  SECTION_36: 4468,
};

const reportConfigs: Record<ReportType, ReportConfig> = {
  report17: {
    mapping: report17Mapping,
    dynamicSectionKey: "SECTION_11",
    documentId: 299,
    statusPanelId: 3289,
    // panel_id для check-errors (подобран под текущий layout для ОО-2)
    checkErrorsPanelId: 4482,
    defaultCompleteDocument: true,
    panelIdBySection: OO2_PANEL_IDS,
    // Временно отключаем check-errors на этапе загрузки/заполнения данных.
    runCheckErrorsAfterFill: false,
    runCheckErrorsAfterEachSection: false,
  },
  form_1od_2025: {
    mapping: form1Od2025Mapping,
    dynamicSectionKey: "SECTION_5_1_1",
    defaultCompleteDocument: false,
    documentId: 299,
    statusPanelId: 4448,
    panelIdBySection: FORM_1OD_2025_PANEL_IDS,
    runCheckErrorsAfterFill: false,
    runCheckErrorsAfterEachSection: false,
  },
};

export function getReportConfig(reportType?: ReportType): ReportConfig {
  if (!reportType) {
    return reportConfigs.report17;
  }
  const config = reportConfigs[reportType];
  if (!config) {
    return reportConfigs.report17;
  }
  return config;
}
