import { InputJson } from "./apiService_types";
import { dataMapping } from "./mapping";

const isNumeric = (value: string): boolean => /^-?\d+(\.\d+)?$/.test(value);
const parseValue = (value: string): number | string => isNumeric(value) ? Number(value) : value;

type TableRow = {
  panel_id: number;
  row_id: number;
  type_id: number;
  columns: Record<string, number | string | null>;
};

type SectionRequest = {
  params: { panel_id: number };
  table: TableRow[];
  panel_id: number;
};

const panelIdMapping: Record<string, number> = {
  SECTION_12: 3253,
  SECTION_13: 3255,
  SECTION_14: 3257,
  SECTION_15: 3259,
  SECTION_16: 3261,
  SECTION_21: 3263,
  SECTION_22: 3265,
  SECTION_23: 3267,
  SECTION_24: 3269,
  SECTION_25: 3271,
  SECTION_26: 3273,
  SECTION_27: 3275,
  SECTION_31: 3277,
  SECTION_32: 3279,
  SECTION_33: 3281,
  SECTION_34: 3283,
  SECTION_35: 3285,
  SECTION_36: 3287,
};

/**
 * Создает запрос для заполнения секции на основе ключа секции и входных данных
 */
export function createSectionRequest(
  sectionKey: keyof typeof dataMapping,
  inputJson: InputJson
): object {
  // Особая обработка для секции 11, которая имеет динамическое количество строк
  if (sectionKey === "SECTION_11") {
    return createSection11Request(inputJson);
  }

  // Для всех других секций используем стандартное маппирование
  const mappingRows = dataMapping[sectionKey];
  const requestTable = mappingRows.map((mappingRow) => {
    const { row_id, columns } = mappingRow;
    const resultColumns: Record<string, any> = {};

    // Заполняем колонки значениями из inputJson
    for (const [colKey, fieldName] of Object.entries(columns)) {
      if (fieldName === null) {
        resultColumns[colKey] = null;
      } else {
        resultColumns[colKey] = inputJson[fieldName as keyof InputJson] ?? null;
      }
    }

    return {
      row_id,
      columns: resultColumns,
    };
  });

  return {
    table: requestTable,
  };
}

/**
 * Создает запрос для секции 11 с учетом динамического количества строк
 */
function createSection11Request(inputJson: InputJson): object {
  const section11Mapping = dataMapping.SECTION_11;
  const table = [];

  // Добавляем заголовок таблицы
  const headerColumns: Record<string, any> = {};
  for (const [colKey, fieldName] of Object.entries(section11Mapping.header.columns)) {
    if (fieldName === null) {
      headerColumns[colKey] = null;
    } else {
      headerColumns[colKey] = inputJson[fieldName as keyof InputJson] ?? null;
    }
  }

  table.push({
    panel_id: section11Mapping.panel_id,
    row_id: section11Mapping.header.row_id,
    type_id: section11Mapping.header.type_id,
    columns: headerColumns,
  });

  // Определяем количество строк, которые нужно создать
  const rowCountField = section11Mapping.header.columns["36889"];
  let rowCount = Number(inputJson[rowCountField as keyof InputJson] || 0);
  
  // Не более 10 строк согласно требованиям
  rowCount = Math.min(rowCount, 10);
  
  // Добавляем динамические строки в соответствии с их количеством
  for (let i = 0; i < rowCount; i++) {
    const rowMapping = section11Mapping.rows[i];
    if (!rowMapping) continue;
    
    const rowColumns: Record<string, any> = {};
    for (const [colKey, fieldName] of Object.entries(rowMapping.columns)) {
      if (fieldName === null) {
        rowColumns[colKey] = null;
      } else {
        rowColumns[colKey] = inputJson[fieldName as keyof InputJson] ?? null;
      }
    }
    
    table.push({
      panel_id: section11Mapping.panel_id,
      row_id: rowMapping.row_id,
      row_inc: rowMapping.row_inc,
      type_id: rowMapping.type_id,
      columns: rowColumns,
      _id: "" // Пустая строка для _id согласно требованиям
    });
  }
  
  // Добавляем footer элементы таблицы
  for (const footerRow of section11Mapping.footer) {
    const footerColumns: Record<string, any> = {};
    for (const [colKey, fieldName] of Object.entries(footerRow.columns)) {
      if (fieldName === null) {
        footerColumns[colKey] = null;
      } else {
        footerColumns[colKey] = inputJson[fieldName as keyof InputJson] ?? null;
      }
    }
    
    table.push({
      panel_id: section11Mapping.panel_id,
      row_id: footerRow.row_id,
      type_id: footerRow.type_id,
      columns: footerColumns
    });
  }

  return {
    params: { panel_id: section11Mapping.panel_id },
    table: table,
    panel_id: section11Mapping.panel_id
  };
}