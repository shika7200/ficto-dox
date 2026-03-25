# Ficto Save-Data Parity and Overload Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `save-data` requests match web-client behavior and reliably persist report sections despite transient `500` overload errors.

**Architecture:** Introduce a small request policy layer that builds web-parity headers/body normalization and a targeted retry strategy for overload responses. Keep orchestration in `fictioFill.ts` and HTTP mechanics in `ApiService.ts`; update mapping only where web payload evidence proves schema drift. Add deterministic `panel_id -> tokenIndex` routing so sections are written to the same article consistently after first successful probe.

**Tech Stack:** Bun + TypeScript, Axios, Elysia runtime, Bun test runner

---

Use @superpowers:test-driven-development while implementing each task.

Project note: there is currently no `src/__tests__/` directory and no `test` script in `package.json`; create `src/__tests__/` in Task 1 and run tests directly with `bun test ...`.

### Task 1: Define Save-Data Policy Contracts

**Files:**
- Create: `src/saveDataPolicy.ts`
- Modify: `src/apiService_types.ts`
- Test: `src/__tests__/saveDataPolicy.test.ts`

- [ ] **Step 1: Write failing contract tests for normalization and header policy**

```ts
import { describe, expect, it } from "bun:test";
import {
  normalizeCellValue,
  normalizeRowForSaveData,
  shouldRetrySaveData,
} from "../saveDataPolicy";

describe("saveData policy", () => {
  it("converts null cell to empty string when policy says so", () => {
    expect(normalizeCellValue(null, { nullAsEmptyString: true })).toBe("");
  });

  it("keeps null when policy disables conversion", () => {
    expect(normalizeCellValue(null, { nullAsEmptyString: false })).toBeNull();
  });

  it("retries only overload-like 500 errors", () => {
    expect(shouldRetrySaveData(500, "Необработанная ошибка", 0, 3)).toBe(true);
    expect(shouldRetrySaveData(400, "Bad Request", 0, 3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `bun test src/__tests__/saveDataPolicy.test.ts`  
Expected: FAIL with missing module/functions.

- [ ] **Step 3: Implement minimal policy module + required types**

```ts
export type SaveDataNormalizationPolicy = {
  nullAsEmptyString: boolean;
  includeRowIdField: "omit" | "null";
};

export const defaultPolicy: SaveDataNormalizationPolicy = {
  nullAsEmptyString: false,
  includeRowIdField: "omit",
};

export function normalizeCellValue(v: unknown, p: SaveDataNormalizationPolicy) {
  return v === null && p.nullAsEmptyString ? "" : v;
}

export function normalizeRowForSaveData(
  row: Record<string, unknown>,
  p: SaveDataNormalizationPolicy
) {
  return row;
}

export function shouldRetrySaveData(
  status: number | undefined,
  message: string | undefined,
  attempt: number,
  maxAttempts: number
) {
  return status === 500 && message?.includes("Необработанная ошибка") && attempt + 1 < maxAttempts;
}
```

Also add to `src/apiService_types.ts`:

```ts
export type SaveDataRequestContext = {
  fingerprint?: string;
  sessionId?: string;
};
```

- [ ] **Step 4: Re-run tests**

Run: `bun test src/__tests__/saveDataPolicy.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/saveDataPolicy.ts src/apiService_types.ts src/__tests__/saveDataPolicy.test.ts
git commit -m "feat: add save-data policy contracts and unit tests"
```

### Task 2: Implement Web-Parity Headers and Payload Normalization

**Files:**
- Modify: `src/ApiService.ts`
- Modify: `src/apiService_types.ts`
- Test: `src/__tests__/saveDataPayloadParity.test.ts`

- [ ] **Step 1: Write failing tests for request shape parity**

```ts
import { buildSaveDataHeaders, prepareSaveDataPayload } from "../saveDataPolicy";

it("sets X-Fingerprint and X-Session-Id when provided", () => {
  const h = buildSaveDataHeaders({ "L-Token": "t" }, { fingerprint: "fp", sessionId: "sid" });
  expect(h["X-Fingerprint"]).toBe("fp");
  expect(h["X-Session-Id"]).toBe("sid");
});

it("normalizes dynamic row _id to null when policy requires", () => {
  const body = prepareSaveDataPayload(
    { panel_id: 1, params: { panel_id: 1 }, table: [{ _id: "", columns: {} }] } as any,
    { nullAsEmptyString: false, includeRowIdField: "null" }
  );
  expect((body as any).table[0]._id).toBeNull();
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun test src/__tests__/saveDataPayloadParity.test.ts`  
Expected: FAIL (headers/normalization missing).

- [ ] **Step 3: Add parity helpers and wire context source**

```ts
export const buildSaveDataHeaders = (baseHeaders: Record<string, string>, ctx?: SaveDataRequestContext) => ({
  ...baseHeaders,
  ...(ctx?.fingerprint ? { "X-Fingerprint": ctx.fingerprint } : {}),
  ...(ctx?.sessionId ? { "X-Session-Id": ctx.sessionId } : {}),
});
```

Use `SaveDataRequestContext` source:
- extend `ApiService.saveData(token, data, ctx?)`
- pass `ctx` from `fictioFill.ts` (initially optional, so backward compatible).

- [ ] **Step 4: Normalize payload before axios.post**

```ts
const preparedBody = prepareSaveDataPayload(data, policy);
await axios.post(url, preparedBody, makeConfig(preparedBody));
```

- [ ] **Step 5: Re-run tests**

Run: `bun test src/__tests__/saveDataPayloadParity.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ApiService.ts src/apiService_types.ts src/__tests__/saveDataPayloadParity.test.ts
git commit -m "feat: apply web-parity headers and payload normalization"
```

### Task 3: Add Overload-Aware Retry (Not Blind Retry)

**Files:**
- Modify: `src/ApiService.ts`
- Modify: `src/saveDataPolicy.ts`
- Test: `src/__tests__/saveDataRetry.test.ts`

- [ ] **Step 1: Write failing retry behavior tests**

```ts
import { describe, expect, it, mock } from "bun:test";
import axios from "axios";
import { ApiService } from "../ApiService";

describe("saveData retry", () => {
  it("retries up to max attempts on 500 + 'Необработанная ошибка'", async () => {
    const post = mock()
      .mockRejectedValueOnce({ response: { status: 500, data: { message: "Необработанная ошибка" } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { message: "Необработанная ошибка" } } })
      .mockResolvedValue({ status: 200, data: { status: true } });
    (axios as any).post = post;
    const api = new ApiService();
    const r = await api.saveData("t", { panel_id: 1, params: { panel_id: 1 }, table: [] } as any);
    expect(r.status).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 4xx", async () => {
    const post = mock().mockRejectedValue({ response: { status: 400, data: { message: "Bad Request" } } });
    (axios as any).post = post;
    const api = new ApiService();
    await expect(api.saveData("t", { panel_id: 1, params: { panel_id: 1 }, table: [] } as any)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bun test src/__tests__/saveDataRetry.test.ts`  
Expected: FAIL (retry loop absent).

- [ ] **Step 3: Implement bounded retry with small exponential backoff**

```ts
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  try { return await send(); }
  catch (e) {
    if (!shouldRetrySaveData(status, msg, attempt, maxAttempts)) throw e;
    await delay(backoffMs(attempt));
  }
}
```

Apply retry **inside** `saveData` before `this.handleRequestError(...)` is called.

- [ ] **Step 4: Re-run retry tests**

Run: `bun test src/__tests__/saveDataRetry.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ApiService.ts src/saveDataPolicy.ts src/__tests__/saveDataRetry.test.ts
git commit -m "feat: add overload-aware retry for save-data requests"
```

### Task 4: Stabilize Panel-to-Token Routing in Fill Orchestrator

**Files:**
- Modify: `src/fictioFill.ts`
- Test: `src/__tests__/tokenRouting.test.ts`

- [ ] **Step 1: Write failing routing tests**

```ts
import { describe, expect, it } from "bun:test";
import { chooseTokenIndexForPanel } from "../fictioFill";

describe("panel token routing", () => {
  it("remembers successful token index for panel and reuses it", () => {
    const cache = new Map<number, number>();
    cache.set(4474, 2);
    const idx = chooseTokenIndexForPanel(4474, cache, 0);
    expect(idx).toBe(2);
  });

  it("probes alternatives only after overload failure", () => {
    const shouldProbe = (status: number, msg: string) =>
      status === 500 && msg.includes("Необработанная ошибка");
    expect(shouldProbe(500, "Необработанная ошибка")).toBe(true);
    expect(shouldProbe(200, "ok")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bun test src/__tests__/tokenRouting.test.ts`  
Expected: FAIL (routing cache absent).

- [ ] **Step 3: Implement `Map<number, number>` routing cache**

```ts
const panelTokenIndex = new Map<number, number>();
// On success: panelTokenIndex.set(panelId, usedIndex)
// On next section with same panel: start with cached index
```

- [ ] **Step 4: Keep fallback probing but persist winning token index**

```ts
if (recoveredWithProbeIdx !== null) {
  panelTokenIndex.set(panelId, recoveredWithProbeIdx);
}
```

- [ ] **Step 5: Re-run routing tests**

Run: `bun test src/__tests__/tokenRouting.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fictioFill.ts src/__tests__/tokenRouting.test.ts
git commit -m "feat: stabilize panel-to-token routing for save-data"
```

### Task 5: Align Mapping Gaps Against Web Payload Evidence

**Files:**
- Create: `src/fixtures/web-save-data-section11.json`
- Modify: `src/mapping_oo-2_2025.ts`
- Modify: `src/reportConfig.ts` (only if panel map additions needed)
- Test: `src/__tests__/mappingParity.test.ts`

- [ ] **Step 1: Write failing tests for known web payload keys**

```ts
it("contains expected section 11 column keys from web capture", () => {
  // load src/fixtures/web-save-data-section11.json and assert mapping header/rows include captured keys
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `bun test src/__tests__/mappingParity.test.ts`  
Expected: FAIL where mapping is incomplete.

- [ ] **Step 3: Patch mapping to match captured web schema**

```ts
SECTION_11: {
  header: { columns: { "51925": "...", "51926": "...", /* ... */ } }
}
```

- [ ] **Step 4: Re-run mapping parity tests**

Run: `bun test src/__tests__/mappingParity.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fixtures/web-save-data-section11.json src/mapping_oo-2_2025.ts src/reportConfig.ts src/__tests__/mappingParity.test.ts
git commit -m "fix: align report17 mapping with web save-data schema"
```

### Task 6: End-to-End Verification and Rollout Notes

**Files:**
- Create: `docs/ficto-save-data-debug-notes.md` (optional)

- [ ] **Step 1: Add a concise runbook (optional)**

```md
- How to set fingerprint/session
- How to read panel->token routing behavior
- Which 500 errors are retriable
```

- [ ] **Step 2: Run focused tests**

Run: `bun test src/__tests__/saveDataPolicy.test.ts src/__tests__/saveDataPayloadParity.test.ts src/__tests__/saveDataRetry.test.ts src/__tests__/tokenRouting.test.ts src/__tests__/mappingParity.test.ts`  
Expected: PASS.

- [ ] **Step 3: Run type/build verification**

Run: `bun run build`  
Expected: PASS or fail only on pre-existing unrelated files (document if so).

Optional TS-only signal:

Run: `bunx tsc --noEmit`  
Expected: PASS or only pre-existing unrelated errors.

- [ ] **Step 4: Manual smoke with live account**

Run: fill with a known JSON and verify in web:
- sections before `SECTION_23` visible,
- `SECTION_23+` saved without stop-on-first-500,
- values appear in expected article/panel.

- [ ] **Step 5: Commit docs only if Step 1 was executed**

```bash
if [ -f docs/ficto-save-data-debug-notes.md ]; then
  git add docs/ficto-save-data-debug-notes.md
  git commit -m "docs: add save-data parity and overload runbook"
fi
```

## Scope Check

This is one subsystem (Ficto save flow), so a single plan is appropriate. If you want, we can split execution into two smaller plans: (1) request parity+retry, (2) mapping parity cleanup.
