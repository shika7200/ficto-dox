import { Elysia } from 'elysia'
import { exportAllHandler } from './ExportAllHandler'

import { InputJson } from './apiService_types'
import { processAllUsers } from './ ProcessAllHandler'
import { FictioFill } from './fictioFill'


const app = new Elysia()

// Обработчик preflight-запросов для любых путей
app.options('*', () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
})

// Эндпоинт для обработки всех пользователей
app.post('/api/processAll', async ({ body }) => {
  try {
    const parsedBody = (await body) as unknown
    if (!Array.isArray(parsedBody)) {
      return new Response(
        JSON.stringify({ error: 'Ожидается массив объектов' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      )
    }
    const results = await processAllUsers(parsedBody)
    return new Response(
      JSON.stringify(results),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Ошибка в /api/processAll:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  }
})

// Эндпоинт для экспорта данных с запросом массива учетных данных
interface ExportRequest {
  email: string
  password: string
  panel_id?: number
}
app.post('/api/export', async ({ body }) => {
  try {
    const requestBody = (await body) as ExportRequest[]
    const { zipContent, filename } = await exportAllHandler(requestBody)
    return new Response(zipContent, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Cache-Control': 'no-store'
      }
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Ошибка в /api/export:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  }
})

// Эндпоинт для заполнения Ficto по inputJson
app.post('/api/fill', async ({ body }) => {
  try {
    const inputJson = (await body) as InputJson
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ApiController.ts:/api/fill:entry',message:'Received /api/fill',data:{keys:Object.keys(inputJson||{}),reportType:inputJson?.reportType,completeDocument:inputJson?.completeDocument,hasDoxcellLogin:!!inputJson?.doxcellLogin,hasFictoLogin:!!inputJson?.fictoLogin,hasDocumentId:!!inputJson?.documentId,factorsCount:inputJson?.factors?Object.keys(inputJson.factors).length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'} )}).catch(()=>{});
    // #endregion
    await FictioFill(inputJson)
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/9c157ceb-31b2-4b6a-87ae-fbb1790ee3c3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ApiController.ts:/api/fill:catch',message:'Error in /api/fill',data:{errorMessage:message,errorType:error instanceof Error ? error.name : typeof error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'} )}).catch(()=>{});
    // #endregion
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  }
})


app.listen(3000)
console.log('Server running on http://localhost:3000')
