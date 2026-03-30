import React, { useState, useRef, useCallback } from 'react'
import './JsonFileUploader.css'

type ReportType = 'report17' | 'form_1od_2025'

interface FileItem {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'success' | 'error'
  result?: { success: boolean }
  error?: string
  /** Ошибки check-errors с бэкенда для этой выгрузки (раскрываются в UI). */
  checkErrors?: unknown[]
}

const JsonFileUploader: React.FC = () => {
  const [files, setFiles] = useState<FileItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [reportType, setReportType] = useState<ReportType>('report17')
  const [completeDocument, setCompleteDocument] = useState(false)

  /**
   * Обновляет состояние файла.
   */
  const updateFile = useCallback(
    (
      file: File,
      updates: Partial<FileItem> | ((prev: FileItem) => Partial<FileItem>)
    ) => {
      setFiles(prevFiles =>
        prevFiles.map(item => {
          if (item.file !== file) return item
          const changes = typeof updates === 'function' ? updates(item) : updates
          return { ...item, ...changes }
        })
      )
    },
    []
  )

  const uploadFile = useCallback(
    (item: FileItem) => {
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'JsonFileUploader.tsx:uploadFile:start',message:'Start uploadFile',data:{fileName:item.file.name,fileSize:item.file.size,reportType,completeDocument},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'} )}).catch(()=>{});
      // #endregion
      updateFile(item.file, { status: 'uploading', progress: 0 })

      const interval = setInterval(() => {
        updateFile(item.file, prev => ({
          progress: Math.min(prev.progress + Math.random() * 10, 90)
        }))
      }, 200)

      const reader = new FileReader()
      reader.onload = async () => {
        clearInterval(interval)
        try {
          const json = JSON.parse(reader.result as string)
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'JsonFileUploader.tsx:reader:onload:parsed',message:'JSON.parse ok',data:{fileName:item.file.name,topLevelKeys:Object.keys(json||{}).slice(0,25)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'} )}).catch(()=>{});
          // #endregion
          const resp = await fetch('http://localhost:3000/api/fill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...json,
              reportType,
              completeDocument
            })
          })
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'JsonFileUploader.tsx:fetch:resp',message:'Received /api/fill response',data:{fileName:item.file.name,status:resp.status,ok:resp.ok,contentType:resp.headers.get('content-type')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'} )}).catch(()=>{});
          // #endregion

          const respText = await resp.clone().text()
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'JsonFileUploader.tsx:fetch:body',message:'Response body preview',data:{fileName:item.file.name,bodyLen:respText.length,bodyPreview:respText.slice(0,220)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'} )}).catch(()=>{});
          // #endregion

          const data: {
            success?: boolean
            error?: string
            checkErrors?: unknown[]
          } = (() => {
            try {
              return JSON.parse(respText)
            } catch {
              return {}
            }
          })()
          const ok = resp.ok && data.success
          updateFile(item.file, {
            status: ok ? 'success' : 'error',
            progress: 100,
            result: { success: !!data.success },
            error: !ok ? (data.error || `HTTP ${resp.status}`) : undefined,
            checkErrors:
              !ok &&
              Array.isArray(data.checkErrors) &&
              data.checkErrors.length > 0
                ? data.checkErrors
                : undefined
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'JsonFileUploader.tsx:reader:onload:catch',message:'Upload pipeline threw',data:{fileName:item.file.name,errorMessage:message,errorType:err instanceof Error ? err.name : typeof err},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'} )}).catch(()=>{});
          // #endregion
          updateFile(item.file, { status: 'error', progress: 100, error: message })
        }
      }
      reader.readAsText(item.file)
    },
    [updateFile, reportType, completeDocument]
  )

  const handleFiles = (selected: FileList | null) => {
    if (!selected) return
    const newItems: FileItem[] = Array.from(selected).map(file => ({
      file,
      progress: 0,
      status: 'pending'
    }))
    setFiles(prev => [...prev, ...newItems])
    newItems.forEach(uploadFile)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="json-uploader-container">
      <div className="json-uploader-card">
        <h1 className="json-uploader-title">Заполнение отчетов Ficto</h1>
        <p className="json-uploader-subtitle">Загрузите JSON файлы с данными для автоматического заполнения</p>

        <div className="json-uploader-controls">
          <div className="json-uploader-field">
            <label className="json-uploader-label">Тип отчета</label>
            <select
              value={reportType}
              onChange={e => setReportType(e.target.value as ReportType)}
              className="json-uploader-select"
            >
              <option value="report17">Отчет 17 (текущая форма)</option>
              <option value="form_1od_2025">ФСН № 1-ОД 2025</option>
            </select>
          </div>

          <div className="json-uploader-field">
            <label className="json-uploader-checkbox-label">
              <input
                type="checkbox"
                checked={completeDocument}
                onChange={e => setCompleteDocument(e.target.checked)}
                className="json-uploader-checkbox"
              />
              <span>Завершать отчет после заполнения (блокировка)</span>
            </label>
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
              <span className="json-uploader-file-button">📁 Выбрать JSON файлы</span>
            </label>
          </div>
        </div>

        {files.length > 0 && (
          <div className="json-uploader-files">
            <h2 className="json-uploader-files-title">Загруженные файлы</h2>
            {files.map((item, idx) => (
              <div key={idx} className={`json-uploader-file-item json-uploader-file-item--${item.status}`}>
                <div className="json-uploader-file-header">
                  <span className="json-uploader-file-name">{item.file.name}</span>
                  <span className={`json-uploader-file-status json-uploader-file-status--${item.status}`}>
                    {item.status === 'uploading' && '⏳ Загрузка…'}
                    {item.status === 'success' && '✅ Успешно'}
                    {item.status === 'error' && '❌ Ошибка'}
                    {item.status === 'pending' && '⏸ Ожидание'}
                  </span>
                </div>
                <div className="json-uploader-progress-bar">
                  <div
                    className="json-uploader-progress-fill"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                {item.status === 'success' && item.result && (
                  <div className="json-uploader-success-message">
                    ✓ Файл «{item.file.name}» успешно обработан и отправлен в Ficto
                  </div>
                )}
                {item.status === 'error' && (
                  <div className="json-uploader-error-block">
                    <div className="json-uploader-error-message">
                      ✗ {item.error || 'Произошла ошибка при обработке файла'}
                    </div>
                    {item.checkErrors != null && item.checkErrors.length > 0 && (
                      <details className="json-uploader-error-details">
                        <summary className="json-uploader-error-details-summary">
                          Подробности проверки документа ({item.checkErrors.length})
                        </summary>
                        <pre className="json-uploader-error-details-pre" tabIndex={0}>
                          {JSON.stringify(item.checkErrors, null, 2)}
                        </pre>
                      </details>
                    )}
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

export default JsonFileUploader