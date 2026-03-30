import { ApiService } from "./ApiService";
import * as XLSX from "xlsx";

export type CheckAccountInputRow = {
  orgName?: string;
  login: string;
  password: string;
};

export type CheckAccountResultRow = {
  orgName: string;
  login: string;
  ok: boolean;
  uuid: string;
  initTokensCount: number;
  error: string;
};

const toStr = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export async function checkAccounts(
  rows: CheckAccountInputRow[],
  opts?: { concurrency?: number }
): Promise<{
  results: CheckAccountResultRow[];
  errorCounts: Record<string, number>;
}> {
  const api = new ApiService();
  const concurrency = Math.max(1, opts?.concurrency ?? 5);

  const results: CheckAccountResultRow[] = [];
  const errorCounts: Record<string, number> = {};

  const batches = chunk(rows, concurrency);
  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(async (r): Promise<CheckAccountResultRow> => {
        const orgName = toStr(r.orgName).trim();
        const login = toStr(r.login).trim();
        const password = toStr(r.password);

        if (!login || !password) {
          const error = "Отсутствует логин или пароль";
          return {
            orgName,
            login,
            ok: false,
            uuid: "",
            initTokensCount: 0,
            error,
          };
        }

        try {
          const tokens = await api.login(login, password);
          const uuid = await api.getUuid(tokens.access_token);
          const initTokens = await api.getInitTokens(uuid, tokens.access_token);
          return {
            orgName,
            login,
            ok: Array.isArray(initTokens) && initTokens.length > 0,
            uuid,
            initTokensCount: Array.isArray(initTokens) ? initTokens.length : 0,
            error: "",
          };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          return {
            orgName,
            login,
            ok: false,
            uuid: "",
            initTokensCount: 0,
            error,
          };
        }
      })
    );

    for (const r of batchResults) {
      results.push(r);
      if (!r.ok) {
        const key = r.error || "Unknown error";
        errorCounts[key] = (errorCounts[key] ?? 0) + 1;
      }
    }
  }

  return { results, errorCounts };
}

export function buildCheckAccountsXlsx(payload: {
  results: CheckAccountResultRow[];
  errorCounts: Record<string, number>;
}): Buffer {
  const wb = XLSX.utils.book_new();

  const sheet1Rows = payload.results.map((r) => ({
    orgName: r.orgName,
    login: r.login,
    ok: r.ok ? "ok" : "fail",
    uuid: r.uuid,
    initTokensCount: r.initTokensCount,
    error: r.error,
  }));

  const ws1 = XLSX.utils.json_to_sheet(sheet1Rows, {
    header: ["orgName", "login", "ok", "uuid", "initTokensCount", "error"],
  });
  XLSX.utils.book_append_sheet(wb, ws1, "results");

  const sheet2Rows = Object.entries(payload.errorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([error, count]) => ({ error, count }));
  const ws2 = XLSX.utils.json_to_sheet(sheet2Rows, {
    header: ["error", "count"],
  });
  XLSX.utils.book_append_sheet(wb, ws2, "errors_summary");

  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

