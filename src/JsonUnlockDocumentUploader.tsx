import React, { useCallback, useRef, useState } from "react";
import "./JsonFileUploader.css";

type ReportType = "report17" | "form_1od_2025";

interface FileItem {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  unlockResult?: {
    documentId: number;
    panelId: number;
    buildId: number;
    statusId: number;
    statusMessage: string | null;
    attemptedCancel: boolean;
    cancelled: boolean;
    skippedReason?: string;
  };
}

const JsonUnlockDocumentUploader: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reportType, setReportType] = useState<ReportType>("report17");

  const updateFile = useCallback(
    (
      file: File,
      updates: Partial<FileItem> | ((prev: FileItem) => Partial<FileItem>)
    ) => {
      setFiles((prev) =>
        prev.map((item) => {
          if (item.file !== file) return item;
          const changes = typeof updates === "function" ? updates(item) : updates;
          return { ...item, ...changes };
        })
      );
    },
    []
  );

  const runUnlock = useCallback(
    (item: FileItem) => {
      updateFile(item.file, { status: "uploading", progress: 0 });
      const interval = setInterval(() => {
        updateFile(item.file, (prev) => ({
          progress: Math.min(prev.progress + Math.random() * 12, 92),
        }));
      }, 180);

      const reader = new FileReader();
      reader.onload = async () => {
        clearInterval(interval);
        try {
          const json = JSON.parse(reader.result as string);
          const resp = await fetch("http://localhost:3000/api/unlockDocument", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...json, reportType }),
          });

          const text = await resp.text();
          const data: {
            success?: boolean;
            error?: string;
            documentId?: number;
            panelId?: number;
            buildId?: number;
            statusId?: number;
            statusMessage?: string | null;
            attemptedCancel?: boolean;
            cancelled?: boolean;
            skippedReason?: string;
          } = (() => {
            try {
              return JSON.parse(text) as typeof data;
            } catch {
              return {};
            }
          })();

          if (!resp.ok || !data.success) {
            updateFile(item.file, {
              status: "error",
              progress: 100,
              error: data.error || `HTTP ${resp.status}`,
            });
            return;
          }

          updateFile(item.file, {
            status: "success",
            progress: 100,
            unlockResult: {
              documentId: data.documentId!,
              panelId: data.panelId!,
              buildId: data.buildId!,
              statusId: data.statusId!,
              statusMessage: data.statusMessage ?? null,
              attemptedCancel: data.attemptedCancel === true,
              cancelled: data.cancelled === true,
              skippedReason: data.skippedReason,
            },
          });
        } catch (err: unknown) {
          updateFile(item.file, {
            status: "error",
            progress: 100,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      };
      reader.readAsText(item.file);
    },
    [updateFile, reportType]
  );

  const handleFiles = (selected: FileList | null) => {
    if (!selected) return;
    const newItems: FileItem[] = Array.from(selected).map((file) => ({
      file,
      progress: 0,
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...newItems]);
    newItems.forEach(runUnlock);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="json-uploader-container">
      <div className="json-uploader-card">
        <h1 className="json-uploader-title">Снятие блокировки документа</h1>
        <p className="json-uploader-subtitle">
          Загружает JSON, выполняет status и при блокировке запускает cancel.
        </p>

        <div className="json-uploader-controls">
          <div className="json-uploader-field">
            <label className="json-uploader-label">Тип отчета</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="json-uploader-select"
            >
              <option value="report17">Отчет 17 (ОО-2)</option>
              <option value="form_1od_2025">ФСН № 1-ОД 2025</option>
            </select>
          </div>
          <div className="json-uploader-field">
            <label className="json-uploader-file-label">
              <input
                ref={inputRef}
                type="file"
                accept="application/json"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                className="json-uploader-file-input"
              />
              <span className="json-uploader-file-button">
                📁 Выбрать JSON для снятия блокировки
              </span>
            </label>
          </div>
        </div>

        {files.length > 0 && (
          <div className="json-uploader-files">
            <h2 className="json-uploader-files-title">Результаты</h2>
            {files.map((item, idx) => (
              <div
                key={idx}
                className={`json-uploader-file-item json-uploader-file-item--${item.status}`}
              >
                <div className="json-uploader-file-header">
                  <span className="json-uploader-file-name">{item.file.name}</span>
                  <span
                    className={`json-uploader-file-status json-uploader-file-status--${item.status}`}
                  >
                    {item.status === "uploading" && "⏳ Выполнение..."}
                    {item.status === "success" && "✅ Готово"}
                    {item.status === "error" && "❌ Ошибка"}
                    {item.status === "pending" && "⏸ Ожидание"}
                  </span>
                </div>

                <div className="json-uploader-progress-bar">
                  <div
                    className="json-uploader-progress-fill"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>

                {item.status === "success" && item.unlockResult && (
                  <div className="json-uploader-check-summary">
                    <div className="json-uploader-check-meta">
                      documentId: {item.unlockResult.documentId}, panelId:{" "}
                      {item.unlockResult.panelId}, buildId: {item.unlockResult.buildId}
                    </div>
                    {item.unlockResult.attemptedCancel ? (
                      <div className="json-uploader-success-message">
                        {item.unlockResult.cancelled
                          ? "✓ Блокировка успешно снята"
                          : "⚠ Cancel выполнен, но API не вернул status=true"}
                      </div>
                    ) : (
                      <div className="json-uploader-check-warn-msg">
                        Пропущено:{" "}
                        {item.unlockResult.skippedReason ||
                          "документ не в состоянии блокировки"}
                      </div>
                    )}
                  </div>
                )}

                {item.status === "error" && (
                  <div className="json-uploader-error-block">
                    <div className="json-uploader-error-message">
                      ✗ {item.error || "Ошибка запроса"}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default JsonUnlockDocumentUploader;
