import { InputJson } from "./apiService_types";

/**
 * Создает запрос для заполнения секции на основе ключа секции и входных данных
 */
export function createSectionRequest(
  sectionKey: string,
  inputJson: InputJson,
  mapping: Record<string, any>,
  dynamicSectionKey?: string,
  panelIdBySection?: Record<string, number>
): object {
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'parse_Doxcelljson.ts:createSectionRequest:entry',message:'createSectionRequest entry',data:{sectionKey,hasFactors:!!inputJson?.factors,factorsCount:inputJson?.factors?Object.keys(inputJson.factors).length:0,hasPanelIdBySection:!!panelIdBySection},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'S'} )}).catch(()=>{});
  // #endregion

  // Особая обработка для секции с динамическими строками (например, SECTION_11)
  if (dynamicSectionKey && sectionKey === dynamicSectionKey) {
    return createSection11Request(inputJson, mapping[sectionKey]);
  }

  // Для всех других секций используем стандартное маппирование
  const mappingRows = mapping[sectionKey];

  if (!mappingRows) {
    throw new Error(`Не найдена секция в mapping: ${sectionKey}`);
  }

  const normalizeValue = (v: unknown) => {
    if (typeof v === "string") {
      const s = v.trim();
      if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
      return v;
    }
    return v;
  };

  const resolveFieldValue = (fieldName: string) => {
    // Основной источник — inputJson.factors (поля отчёта), fallback — top-level поля inputJson
    const raw =
      (inputJson.factors && fieldName in inputJson.factors
        ? inputJson.factors[fieldName]
        : (inputJson as any)[fieldName]) ?? null;
    return normalizeValue(raw);
  };

  if (Array.isArray(mappingRows)) {
    const panelId =
      (panelIdBySection && panelIdBySection[sectionKey]) ||
      (mappingRows as any)?.panel_id ||
      undefined;
    if (!panelId) {
      throw new Error(`Не найден panel_id для секции ${sectionKey}`);
    }

    const sampleFieldNames = mappingRows
      .slice(0, 6)
      .flatMap((r: any) => Object.values(r.columns || {}))
      .filter((v: any) => v !== null)
      .slice(0, 6)
      .map((v: any) => String(v));
    const samplePresence = sampleFieldNames.map((k) => ({
      k,
      inFactors: !!(inputJson.factors && k in inputJson.factors),
    }));
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'parse_Doxcelljson.ts:createSectionRequest:array:sample',message:'Sample mapping keys presence',data:{sectionKey,panelId,samplePresence},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'H1'} )}).catch(()=>{});
    // #endregion

    const requestTable = mappingRows.map((mappingRow) => {
      const { row_id, columns } = mappingRow;
      const resultColumns: Record<string, any> = {};

      // Заполняем колонки значениями из inputJson
      for (const [colKey, fieldName] of Object.entries(columns)) {
        if (fieldName === null) {
          resultColumns[colKey] = null;
        } else {
          resultColumns[colKey] = resolveFieldValue(String(fieldName));
        }
      }

      return {
        panel_id: panelId,
        row_id,
        type_id: 2,
        columns: resultColumns,
      };
    });

    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'parse_Doxcelljson.ts:createSectionRequest:array',message:'Built array-section request',data:{sectionKey,panelId,tableLen:requestTable.length,nonNullCells:requestTable.reduce((acc,r)=>acc+Object.values(r.columns||{}).filter(v=>v!==null&&v!==undefined).length,0)},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'T'} )}).catch(()=>{});
    // #endregion

    return {
      params: { panel_id: panelId },
      panel_id: panelId,
      table: requestTable,
    };
  }

  if (mappingRows.rows && Array.isArray(mappingRows.rows)) {
    const panelId =
      mappingRows.panel_id ||
      (panelIdBySection && panelIdBySection[sectionKey]) ||
      undefined;
    if (!panelId) {
      throw new Error(`Не найден panel_id для секции ${sectionKey}`);
    }
    const requestTable = mappingRows.rows.map((mappingRow: any) => {
      const { row_id, columns, type_id, row_inc } = mappingRow;
      const resultColumns: Record<string, any> = {};

      for (const [colKey, fieldName] of Object.entries(columns)) {
        if (fieldName === null) {
          resultColumns[colKey] = null;
        } else {
          resultColumns[colKey] = resolveFieldValue(String(fieldName));
        }
      }

      return {
        row_id,
        ...(typeof type_id === "number" ? { type_id } : {}),
        ...(typeof row_inc === "number" ? { row_inc } : {}),
        columns: resultColumns,
      };
    });

    return {
      params: { panel_id: panelId },
      panel_id: panelId,
      table: requestTable,
    };
  }

  // SECTION_0-like shape:
  // {
  //   content: { _id, panel_id, columns: { colId: factorKey } }
  // }
  if (mappingRows.content && mappingRows.content.columns) {
    const panelId =
      mappingRows.content.panel_id ||
      (panelIdBySection && panelIdBySection[sectionKey]) ||
      undefined;

    if (!panelId) {
      throw new Error(`Не найден panel_id для секции ${sectionKey}`);
    }

    const resultColumns: Record<string, string> = {};
    const resolveFormFieldValue = (fieldName: string): string => {
      const raw =
        (inputJson.factors && fieldName in inputJson.factors
          ? inputJson.factors[fieldName]
          : (inputJson as any)[fieldName]) ?? "";
      if (raw === null || raw === undefined) return "";
      return String(raw);
    };

    for (const [colKey, fieldName] of Object.entries(mappingRows.content.columns)) {
      if (fieldName === null) {
        resultColumns[colKey] = "";
      } else {
        resultColumns[colKey] = resolveFormFieldValue(String(fieldName));
      }
    }

    return {
      params: { panel_id: panelId },
      fixation_params: {},
      data: resultColumns,
    };
  }

  throw new Error(`Неизвестная структура секции: ${sectionKey}`);
}

/**
 * Создает запрос для секции с динамическим количеством строк
 */
function createSection11Request(inputJson: InputJson, section11Mapping: any): object {
  const table = [];

  if (!section11Mapping?.header || !section11Mapping?.rows) {
    throw new Error("Некорректная структура секции с динамическими строками");
  }

  // Добавляем заголовок таблицы
  const headerColumns: Record<string, any> = {};
  for (const [colKey, fieldName] of Object.entries(section11Mapping.header.columns)) {
    if (fieldName === null) {
      headerColumns[colKey] = null;
    } else {
      // Пробуем сначала в factors, потом в top-level полях
      const value = (inputJson.factors && typeof fieldName === "string" && fieldName in inputJson.factors)
        ? inputJson.factors[fieldName]
        : (inputJson[fieldName as keyof InputJson] ?? null);
      headerColumns[colKey] = value;
    }
  }

  table.push({
    panel_id: section11Mapping.panel_id,
    row_id: section11Mapping.header.row_id,
    type_id: section11Mapping.header.type_id,
    columns: headerColumns,
  });

  // Определяем количество строк, которые нужно создать
  // Ищем поле для количества строк в header.columns (может быть разным column_id для разных секций)
  const rowCountField = Object.values(section11Mapping.header.columns).find(
    (fieldName) => fieldName && typeof fieldName === "string" && 
    (fieldName.includes("rpreport17s2r2c3_1") || fieldName.includes("rpreport6s16r15c3_0"))
  ) as string | undefined;
  
  if (!rowCountField) {
    throw new Error("Не найдено поле для количества строк в header секции");
  }
  
  const rowCountValue = (inputJson.factors && rowCountField in inputJson.factors)
    ? inputJson.factors[rowCountField]
    : (inputJson[rowCountField as keyof InputJson] || 0);
  // Преобразуем в число, даже если пришло как строка
  let rowCount = Number(String(rowCountValue).trim());
  if (isNaN(rowCount) || rowCount < 0) {
    rowCount = 0;
  }
  
  // Не более 10 строк согласно требованиям
  rowCount = Math.min(rowCount, 10);
  
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'parse_Doxcelljson.ts:createSection11Request:rowCount',message:'Dynamic section row count',data:{rowCountField,rowCountValue,rowCount,availableRows:section11Mapping.rows?.length??0},timestamp:Date.now(),sessionId:'debug-session',runId:'run8',hypothesisId:'W'} )}).catch(()=>{});
  // #endregion
  
  // Добавляем динамические строки в соответствии с их количеством
  // Если rowCount=1, подставится только rows[0] (первый row)
  // Если rowCount=3, подставятся rows[0], rows[1], rows[2] (первые три rows)
  for (let i = 0; i < rowCount; i++) {
    const rowMapping = section11Mapping.rows[i];
    if (!rowMapping) continue;
    
    const rowColumns: Record<string, any> = {};
    for (const [colKey, fieldName] of Object.entries(rowMapping.columns)) {
      if (fieldName === null) {
        rowColumns[colKey] = null;
      } else if (typeof fieldName === "number") {
        // Если значение - число, используем его как есть (например, 51829: 300967)
        rowColumns[colKey] = fieldName;
      } else if (typeof fieldName === "string" && fieldName.startsWith("rpreport")) {
        // Если значение - строка, начинающаяся с "rpreport", ищем в factors
        const value = (inputJson.factors && fieldName in inputJson.factors)
          ? inputJson.factors[fieldName]
          : (inputJson[fieldName as keyof InputJson] ?? null);
        rowColumns[colKey] = value;
      } else {
        // Для других случаев используем значение как есть
        rowColumns[colKey] = fieldName;
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
  for (const footerRow of section11Mapping.footer || []) {
    const footerColumns: Record<string, any> = {};
    for (const [colKey, fieldName] of Object.entries(footerRow.columns)) {
      if (fieldName === null) {
        footerColumns[colKey] = null;
      } else {
        // Пробуем сначала в factors, потом в top-level полях
        const value = (inputJson.factors && typeof fieldName === "string" && fieldName in inputJson.factors)
          ? inputJson.factors[fieldName]
          : (inputJson[fieldName as keyof InputJson] ?? null);
        footerColumns[colKey] = value;
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