import * as XLSX from "xlsx";
import { ApiService } from "./ApiService";

const getString = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

const chunk = <T>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: bun run check-accounts-xlsx "/path/to/file.xlsx"');
    process.exit(2);
  }

  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // Read as AOA to allow column-index based extraction (C=2, D=3).
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  const api = new ApiService();

  const creds: Array<{ login: string; password: string }> = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const login = getString(row[2]);
    const password = getString(row[3]);
    if (!login || !password) continue;
    creds.push({ login, password });
  }

  const results: Array<{
    login: string;
    ok: boolean;
    initTokensCount?: number;
    uuid?: string;
    error?: string;
  }> = [];

  const concurrency = Number(process.env.CONCURRENCY ?? "5");
  const groups = chunk(creds, concurrency);
  let processed = 0;
  const startedAt = Date.now();

  for (const g of groups) {
    const batch = await Promise.all(
      g.map(async ({ login, password }) => {
        try {
          const { access_token } = await api.login(login, password);
          const uuid = await api.getUuid(access_token);
          const initTokens = await api.getInitTokens(uuid, access_token, {
            requiredCount: 1,
            maxWorkspaceIndex: 21,
          });
          return {
            login,
            ok: true as const,
            initTokensCount: initTokens.length,
            uuid,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { login, ok: false as const, error: msg };
        }
      })
    );

    results.push(...batch);
    processed += batch.length;

    if (processed % 25 === 0 || processed === creds.length) {
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(`Progress: ${processed}/${creds.length} (${elapsedSec}s)`);
    }
  }

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);

  console.log(`Total checked: ${results.length}`);
  console.log(`OK: ${ok.length}`);
  console.log(`FAIL: ${bad.length}`);

  if (bad.length) {
    console.log("\nFailed accounts:");
    for (const r of bad) {
      console.log(`- ${r.login}: ${r.error}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

