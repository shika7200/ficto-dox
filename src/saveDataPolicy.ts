import type { SaveDataRequestContext, SaveDataRequestGeneric } from "./apiService_types";

export type SaveDataNormalizationPolicy = {
  nullAsEmptyString: boolean;
  includeRowIdField: "omit" | "null";
};

export const defaultSaveDataNormalizationPolicy: SaveDataNormalizationPolicy =
  {
    nullAsEmptyString: false,
    includeRowIdField: "omit",
  };

export function normalizeCellValue(
  v: unknown,
  p: SaveDataNormalizationPolicy
): unknown {
  if (v === null && p.nullAsEmptyString) return "";
  return v;
}

export function normalizeRowForSaveData(
  row: Record<string, unknown>,
  p: SaveDataNormalizationPolicy
): Record<string, unknown> {
  // For now we only normalize dynamic row `_id`, since `createSection11Request`
  // currently injects `_id: ""` for each dynamic row.
  if (Object.prototype.hasOwnProperty.call(row, "_id")) {
    if (p.includeRowIdField === "null") {
      if (row._id === "") row._id = null;
    } else if (p.includeRowIdField === "omit") {
      delete row._id;
    }
  }

  return row;
}

export function shouldRetrySaveData(
  status: number | undefined,
  message: string | undefined,
  attempt: number,
  maxAttempts: number
): boolean {
  return (
    status === 500 &&
    String(message ?? "").includes("Необработанная ошибка") &&
    attempt + 1 < maxAttempts
  );
}

export function saveDataExponentialBackoffMs(
  attempt: number,
  baseMs = 50,
  factor = 2
): number {
  return baseMs * Math.pow(factor, attempt);
}

export function buildSaveDataHeaders(
  baseHeaders: Record<string, string>,
  ctx?: SaveDataRequestContext
): Record<string, string> {
  return {
    ...baseHeaders,
    ...(ctx?.fingerprint ? { "X-Fingerprint": ctx.fingerprint } : {}),
    ...(ctx?.sessionId ? { "X-Session-Id": ctx.sessionId } : {}),
  };
}

export function prepareSaveDataPayload(
  data: SaveDataRequestGeneric,
  policy: SaveDataNormalizationPolicy
): SaveDataRequestGeneric {
  const body: SaveDataRequestGeneric = {
    ...data,
    table: Array.isArray(data.table) ? [...data.table] : [],
  };

  body.table = body.table.map((row) => {
    const normalizedRow = normalizeRowForSaveData(
      { ...(row as unknown as Record<string, unknown>) } as Record<string, unknown>,
      policy
    ) as unknown as SaveDataRequestGeneric["table"][number];

    // If the payload contains columns with `null`, apply the cell normalization policy.
    const cols = (normalizedRow as unknown as { columns?: Record<string, unknown> })
      .columns;
    if (cols && typeof cols === "object") {
      const normalizedCols: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cols)) {
        normalizedCols[k] = normalizeCellValue(v, policy);
      }
      (normalizedRow as unknown as { columns: Record<string, unknown> }).columns =
        normalizedCols;
    }

    return normalizedRow;
  });

  return body;
}

