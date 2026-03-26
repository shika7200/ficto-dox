# Ficto save-data parity and overload runbook

- **Fingerprint/session:** `ApiService.saveData` accepts optional context (`fingerprint`, `sessionId`) and forwards them as `X-Fingerprint`/`X-Session-Id`.
- **Panel-to-token routing:** `fictioFill.ts` keeps `Map<panel_id, tokenIndex>`; once a token succeeds for a panel, the same token index is reused for subsequent saves for that panel.
- **Retriable 500 errors:** retries are allowed only when response status is `500` and message contains `Необработанная ошибка`; non-overload errors (for example `4xx`) are not retried.

