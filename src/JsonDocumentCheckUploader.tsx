import React, { useCallback, useRef, useState } from "react"
import "./JsonFileUploader.css"

type ReportType = "report17" | "form_1od_2025"

interface FileItem {
  file: File
  progress: number
  status: "pending" | "uploading" | "success" | "error"
  error?: string
  checkResult?: {
    documentId: number
    panelId: number
    errors: unknown[]
    raw?: unknown
  }
}

const JsonDocumentCheckUploader: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [reportType, setReportType] = useState<ReportType>("report17")
  const [fictoDocumentIdText, setFictoDocumentIdText] = useState<string>("")

  const updateFile = useCallback(
    (
      file: File,
      updates: Partial<FileItem> | ((prev: FileItem) => Partial<FileItem>)
    ) => {
      setFiles(prev =>
        prev.map(item => {
          if (item.file !== file) return item
          const changes = typeof updates === "function" ? updates(item) : updates
          return { ...item, ...changes }
        })
      )
    },
    []
  )

  const runCheck = useCallback(
    (item: FileItem) => {
      updateFile(item.file, { status: "uploading", progress: 0 })
      const interval = setInterval(() => {
        updateFile(item.file, prev => ({
          progress: Math.min(prev.progress + Math.random() * 12, 92),
        }))
      }, 180)

      const reader = new FileReader()
      reader.onload = async () => {
        clearInterval(interval)
        try {
          const json = JSON.parse(reader.result as string)
          const parsedFictoDocumentId = Number(fictoDocumentIdText)
          const fictoDocumentId =
            Number.isFinite(parsedFictoDocumentId) && fictoDocumentIdText.trim()
              ? parsedFictoDocumentId
              : undefined
          const resp = await fetch("http://localhost:3000/api/checkDocument", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...json,
              reportType,
              ...(fictoDocumentId !== undefined ? { fictoDocumentId } : {}),
            }),
          })
          const text = await resp.text()
          const data: {
            success?: boolean
            error?: string
            documentId?: number
            panelId?: number
            errors?: unknown[]
            raw?: unknown
          } = (() => {
            try {
              return JSON.parse(text) as typeof data
            } catch {
              return {}
            }
          })()

          if (!resp.ok || !data.success) {
            updateFile(item.file, {
              status: "error",
              progress: 100,
              error: data.error || `HTTP ${resp.status}`,
            })
            return
          }

          const errors = Array.isArray(data.errors) ? data.errors : []
          updateFile(item.file, {
            status: "success",
            progress: 100,
            checkResult: {
              documentId: data.documentId!,
              panelId: data.panelId!,
              errors,
              raw: data.raw,
            },
          })
        } catch (err: unknown) {
          updateFile(item.file, {
            status: "error",
            progress: 100,
            error: err instanceof Error ? err.message : "Unknown error",
          })
        }
      }
      reader.readAsText(item.file)
    },
    [updateFile, reportType, fictoDocumentIdText]
  )

  const handleFiles = (selected: FileList | null) => {
    if (!selected) return
    const newItems: FileItem[] = Array.from(selected).map(file => ({
      file,
      progress: 0,
      status: "pending" as const,
    }))
    setFiles(prev => [...prev, ...newItems])
    newItems.forEach(runCheck)
    if (inputRef.current) inputRef.current.value = ""
  }

  const itemClass = (item: FileItem) => {
    const base = `json-uploader-file-item json-uploader-file-item--${item.status}`
    if (
      item.status === "success" &&
      item.checkResult &&
      item.checkResult.errors.length > 0
    ) {
      return `${base} json-uploader-file-item--check-warn`
    }
    return base
  }

  return (
    <div className="json-uploader-container">
      <div className="json-uploader-card">
        <h1 className="json-uploader-title">Проверка документа (check-errors)</h1>
        <p className="json-uploader-subtitle">
          Те же JSON, что для заполнения: только авторизация и вызов проверки по
          documentId, без сохранения секций.
        </p>

        <div className="json-uploader-controls">
          <div className="json-uploader-field">
            <label className="json-uploader-label">Тип отчёта</label>
            <select
              value={reportType}
              onChange={e => setReportType(e.target.value as ReportType)}
              className="json-uploader-select"
            >
              <option value="report17">Отчет 17 (ОО-2)</option>
              <option value="form_1od_2025">ФСН № 1-ОД 2025</option>
            </select>
          </div>

          <div className="json-uploader-field">
            <label className="json-uploader-label">fictoDocumentId (для check-errors)</label>
            <input
              type="text"
              value={fictoDocumentIdText}
              onChange={e => setFictoDocumentIdText(e.target.value)}
              className="json-uploader-select"
              placeholder="например 339 или 4906"
            />
          </div>

          <div className="json-uploader-field">
            <label className="json-uploader-file-label">
              <input
                ref={inputRef}
                type="file"
                accept="application/json"
                multiple
                onChange={e => handleFiles(e.target.files)}
                className="json-uploader-file-input"
              />
              <span className="json-uploader-file-button">
                📁 Выбрать JSON для проверки
              </span>
            </label>
          </div>
        </div>

        {files.length > 0 && (
          <div className="json-uploader-files">
            <h2 className="json-uploader-files-title">Результаты</h2>
            {files.map((item, idx) => (
              <div key={idx} className={itemClass(item)}>
                <div className="json-uploader-file-header">
                  <span className="json-uploader-file-name">{item.file.name}</span>
                  <span
                    className={`json-uploader-file-status json-uploader-file-status--${item.status}`}
                  >
                    {item.status === "uploading" && "⏳ Проверка…"}
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

                {item.status === "success" && item.checkResult && (
                  <div className="json-uploader-check-summary">
                    <div className="json-uploader-check-meta">
                      documentId: {item.checkResult.documentId}, panelId:{" "}
                      {item.checkResult.panelId}
                    </div>
                    {item.checkResult.errors.length === 0 ? (
                      <div className="json-uploader-success-message">
                        ✓ Ошибок проверки не найдено (массив errors пуст)
                      </div>
                    ) : (
                      <>
                        <div className="json-uploader-check-warn-msg">
                          ⚠ Найдено ошибок: {item.checkResult.errors.length}
                        </div>
                        <details className="json-uploader-error-details">
                          <summary className="json-uploader-error-details-summary">
                            Список ошибок (JSON)
                          </summary>
                          <pre className="json-uploader-error-details-pre" tabIndex={0}>
                            {JSON.stringify(item.checkResult.errors, null, 2)}
                          </pre>
                        </details>
                        <details className="json-uploader-error-details">
                          <summary className="json-uploader-error-details-summary">
                            Полный ответ API
                          </summary>
                          <pre className="json-uploader-error-details-pre" tabIndex={0}>
                            {JSON.stringify(item.checkResult.raw ?? {}, null, 2)}
                          </pre>
                        </details>
                      </>
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
  )
}

export default JsonDocumentCheckUploader
