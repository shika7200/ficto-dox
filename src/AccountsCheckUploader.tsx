import React, { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import "./JsonFileUploader.css";

type CheckRow = { orgName: string; login: string; password: string };

const getString = (v: unknown) =>
  v === null || v === undefined ? "" : String(v).trim();

const parseXlsx = async (file: File): Promise<CheckRow[]> => {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });

  // AOA: [row][col]. We use:
  // - B (index 1): org name
  // - C (index 2): login
  // - D (index 3): password
  const out: CheckRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const orgName = getString(row[1]);
    const login = getString(row[2]);
    const password = getString(row[3]);
    if (!login || !password) continue;
    out.push({ orgName, login, password });
  }
  return out;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

const AccountsCheckUploader: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rowsCount, setRowsCount] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);
    const rows = await parseXlsx(file);
    setRowsCount(rows.length);
    return rows;
  }, []);

  const runCheck = useCallback(
    async (file: File) => {
      setIsRunning(true);
      setError(null);
      try {
        const rows = await handleFile(file);
        const resp = await fetch("http://localhost:3000/api/checkAccounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `HTTP ${resp.status}`);
        }

        const cd = resp.headers.get("Content-Disposition") ?? "";
        const m = cd.match(/filename="?([^"]+)"?/);
        const filename = m?.[1] || "accounts_check.xlsx";

        const blob = await resp.blob();
        downloadBlob(blob, filename);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    },
    [handleFile]
  );

  return (
    <div className="json-uploader-container">
      <div className="json-uploader-card">
        <h1 className="json-uploader-title">Проверка аккаунтов OO‑2</h1>
        <p className="json-uploader-subtitle">
          Загрузите Excel. Используются столбцы: B — организация, C — логин,
          D — пароль.
        </p>

        <div className="json-uploader-controls">
          <div className="json-uploader-field">
            <label className="json-uploader-file-label">
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  await runCheck(f);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="json-uploader-file-input"
                disabled={isRunning}
              />
              <span className="json-uploader-file-button">
                {isRunning ? "⏳ Проверяю…" : "📄 Выбрать Excel и проверить"}
              </span>
            </label>
          </div>

          {fileName && (
            <div style={{ color: "#4a5568", fontSize: "0.95rem" }}>
              Файл: <b>{fileName}</b>
              {typeof rowsCount === "number" ? (
                <>
                  {" "}
                  — найдено строк для проверки: <b>{rowsCount}</b>
                </>
              ) : null}
            </div>
          )}

          {error && (
            <div className="json-uploader-error-message">✗ {error}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountsCheckUploader;

