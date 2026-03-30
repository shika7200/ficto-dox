# OO-2: восстановление check-errors (после каждой секции и/или после полной загрузки) — план внедрения

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Для ОО-2 (`report17`) снова включить проверку документа через API `check-errors`: **после успешной отправки каждой секции** и/или **после успешной отправки всех секций** — в обоих случаях **независимо** от `completeDocument` / `shouldComplete` (сейчас проверка фактически отключена, если завершение документа выключено). Поведение как минимум после полной загрузки — как на коммите `48bd0851dfbe66db3a37bc86c26c39bb27fab02b`.

**Architecture:** В `fictioFill.ts` проверка сейчас только внутри `if (shouldComplete && documentId && statusPanelId)` (блок ~227–238) — при типичной загрузке с выключенным «завершить» она не вызывается. В `reportConfig.ts` задаются два независимых флага для ОО-2: `runCheckErrorsAfterFill` (после цикла) и `runCheckErrorsAfterEachSection` (внутри цикла после успешного `saveData`/`saveFormData`). Общая асинхронная функция (или локальный хелпер в `FictioFill`) вызывает `api.checkErrors(documentId, statusPanelId, 7, statusToken)` и бросает ту же ошибку, что сейчас, если `errors.length > 0`. Чтобы не слать лишний запрос: если включён только «после каждой секции», финальная проверка после цикла **не нужна** (последняя секция уже покрыла «полную загрузку»); если включён только «после полной загрузки» — один вызов после цикла; если **оба** включены — достаточно проверок после каждой секции **или** явно оставить финальный вызов для «двойной» проверки (в плане ниже — **без дубля**: после цикла вызывать только если `runCheckErrorsAfterFill && !runCheckErrorsAfterEachSection`). Для `form_1od_2025` оба флага `false`.

**Tech Stack:** TypeScript, Bun (`bun:test`), существующие `ApiService.checkErrors`, `getReportConfig`, `FictioFill` в `src/fictioFill.ts`.

**Контекст для ревьюера:** спецификация — запрос в чате (ОО-2, коммит `48bd085`, полная загрузка; уточнение — также режим «после каждой секции», сейчас отключено).

---

## Карта файлов

| Файл | Назначение |
|------|------------|
| `src/reportConfig.ts` | Добавить `runCheckErrorsAfterFill: boolean` и `runCheckErrorsAfterEachSection: boolean` в `ReportConfig`. Для `report17`: оба `true` (ранняя диагностика по секциям + гарантия после полного прогона без лишнего дубля — см. логику ниже). Для `form_1od_2025`: оба `false`. |
| `src/fictioFill.ts` | Локальный хелпер `assertDocumentHasNoCheckErrors()` (имя на усмотрение): `checkErrors` + throw при ошибках. Вызывать после **успешного** `sendSectionRequest` в цикле, если `runCheckErrorsAfterEachSection && documentId && statusPanelId`. После цикла вызывать, если `runCheckErrorsAfterFill && documentId && statusPanelId && !runCheckErrorsAfterEachSection` (избежать второго вызова сразу после последней секции). Удалить старый `checkErrors` из `if (shouldComplete && ...)`. |
| `src/__tests__/reportConfig.checkErrorsFlag.test.ts` (новый) | Оба флага для `report17` = `true`, для `form_1od_2025` = `false`. |
| `src/ApiService.ts` | Без изменений (метод `checkErrors` уже есть). |

---

### Task 1: Конфиг — флаги проверки после секций и после полной загрузки

**Files:**
- Modify: `src/reportConfig.ts`

- [ ] **Step 1: Write the failing test**

Создать `src/__tests__/reportConfig.checkErrorsFlag.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { getReportConfig } from "../reportConfig";

describe("reportConfig check-errors flags", () => {
  it("enables after-fill and after-each-section for OO-2 (report17)", () => {
    const c = getReportConfig("report17");
    expect(c.runCheckErrorsAfterFill).toBe(true);
    expect(c.runCheckErrorsAfterEachSection).toBe(true);
  });

  it("disables both for form_1od_2025", () => {
    const c = getReportConfig("form_1od_2025");
    expect(c.runCheckErrorsAfterFill).toBe(false);
    expect(c.runCheckErrorsAfterEachSection).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/reportConfig.checkErrorsFlag.test.ts`

Expected: FAIL (properties missing or `undefined`).

- [ ] **Step 3: Write minimal implementation**

В `src/reportConfig.ts`:
1. Расширить тип `ReportConfig` полями `runCheckErrorsAfterFill: boolean` и `runCheckErrorsAfterEachSection: boolean`.
2. В `reportConfigs.report17`: оба `true`.
3. В `reportConfigs.form_1od_2025`: оба `false`.

**Альтернатива (только финальная проверка без per-section):** для `report17` поставить `runCheckErrorsAfterEachSection: false` и `runCheckErrorsAfterFill: true` — тогда поведение как в исходном варианте плана. Для «и так, и так» оставить оба `true` и логику без дубля после цикла (Task 2).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/reportConfig.checkErrorsFlag.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reportConfig.ts src/__tests__/reportConfig.checkErrorsFlag.test.ts
git commit -m "feat(config): add check-errors flags for after-fill and per-section"
```

---

### Task 2: FictioFill — checkErrors после каждой секции и/или после цикла (ОО-2)

**Files:**
- Modify: `src/fictioFill.ts` (внутри цикла по секциям после успешного сохранения; после цикла; убрать старый блок из `shouldComplete`)

- [ ] **Step 1: Write the failing test (опционально)**

Как в плане ранее: без мока всего `FictioFill` — `bun test` по `src/__tests__/` + ручная проверка.

- [ ] **Step 2: Implement**

1. **Хелпер** (внутри `FictioFill`, после объявления `documentId` / `statusPanelId` / `statusToken`, чтобы замкнуть `api`):

```typescript
  const assertDocumentHasNoCheckErrors = async () => {
    if (!documentId || !statusPanelId) return;
    const checkResult = await api.checkErrors(
      documentId,
      statusPanelId,
      7,
      statusToken
    );
    if (Array.isArray(checkResult.errors) && checkResult.errors.length > 0) {
      console.error("Обнаружены ошибки при проверке документа:", checkResult.errors);
      throw new Error("Обнаружены ошибки в документе — завершение отменено");
    }
  };
```

2. **В цикле** после **любого** успешного `sendSectionRequest` для текущей секции:
   - в основной ветке `try` сразу после `panelTokenIndex.set(panelId, tokenIdx)`;
   - в ветке восстановления через probe: после успешного `sendSectionRequest` и `panelTokenIndex.set`, **перед** `break` / `continue` (иначе секция сохранена, а проверка не вызвана).

```typescript
    if (reportConfig.runCheckErrorsAfterEachSection && documentId && statusPanelId) {
      await assertDocumentHasNoCheckErrors();
    }
```

Повторять этот фрагмент в двух местах успешного сохранения или вынести в локальную функцию `afterSectionSaved()` — на усмотрение, без дублирования логики `checkErrors`.

3. **После цикла** (перед `if (shouldComplete && ... completeDocument)`):

```typescript
  if (
    reportConfig.runCheckErrorsAfterFill &&
    documentId &&
    statusPanelId &&
    !reportConfig.runCheckErrorsAfterEachSection
  ) {
    await assertDocumentHasNoCheckErrors();
  }
```

Смысл условия `!runCheckErrorsAfterEachSection`: если уже проверяем после **каждой** секции, последняя секция покрывает «полную загрузку»; отдельный вызов после цикла не нужен. Если нужен только «один раз в конце» — в конфиге `runCheckErrorsAfterEachSection: false`, `runCheckErrorsAfterFill: true`.

4. **Удалить целиком** старый `if (shouldComplete && documentId && statusPanelId) { ... checkErrors ... }` (~227–238), не оставляя пустого `if`. Следующий `if (shouldComplete && ...)` — только `completeDocument`.

Итоговый порядок:
1. Цикл секций → после каждого успешного сохранения при `runCheckErrorsAfterEachSection` → `assertDocumentHasNoCheckErrors`.
2. После цикла при `runCheckErrorsAfterFill && !runCheckErrorsAfterEachSection` → тот же хелпер.
3. При `shouldComplete` → обновление токенов, `completeDocument` (без `checkErrors` внутри этого блока).

Параметр `userTimezone: 7` без изменений.

**Нагрузка на API:** при обоих флагах `true` для ОО-2 число вызовов `check-errors` ≈ числу секций (не число секций + 1). Если позже понадобится реже дергать API — в конфиге выставить только один из флагов.

- [ ] **Step 3: Run full tests**

Run: `bun test`

Expected: все тесты PASS.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc -b --noEmit` (в `package.json` нет отдельного `typecheck`; полная сборка — `bun run build` = `tsc -b && vite build`).

Expected: без ошибок TypeScript.

- [ ] **Step 5: Commit**

```bash
git add src/fictioFill.ts
git commit -m "fix(oo2): run check-errors per section and/or after fill without completeDocument"
```

---

### Task 3: Ручная проверка (обязательно перед релизом)

- [ ] **Step 1:** Запустить сервер (`bun run server` или как в проекте) и UI.
- [ ] **Step 2:** Для ОО-2 загрузить валидный JSON с **выключенным** «завершить документ» (если в UI есть чекбокс — оставить выключенным).
- [ ] **Step 3:** Убедиться в логах, что после **каждой** успешно отправленной секции уходит `check-errors` (если в конфиге включён `runCheckErrorsAfterEachSection`).
- [ ] **Step 4:** Временно выставить в конфиге только `runCheckErrorsAfterFill: true` и `runCheckErrorsAfterEachSection: false` и убедиться, что `check-errors` вызывается **один раз** после всех секций.
- [ ] **Step 5:** С невалидными данными на стенде убедиться, что при непустом `errors[]` пайплайн обрывается и **не** вызывает `completeDocument` (если завершение выключено — как и раньше).

---

## Связанные навыки

- Реализация: @superpowers/subagent-driven-development или @superpowers/executing-plans
- Перед завершением: @superpowers/verification-before-completion
- При сомнениях по регрессии: @superpowers/systematic-debugging

---

## Примечание по истории git

На merge-коммите `48bd085` в `fictioFill` вызывались `checkErrors(299, fixedPanelId, 7, statusToken)` сразу после цикла сохранения секций. В текущей ветке идентификаторы берутся из `getReportConfig` (`documentId`, `statusPanelId` для `report17`), а вызов проверки оказался внутри условия `shouldComplete`, из‑за чего при `completeDocument: false` (дефолт в `JsonFileUploader.tsx`) проверка не выполняется.

**Риск API:** при `shouldComplete === false` запрашивается один init token; если на реальном стенде `checkErrors` потребует отдельный «статусный» токен, придётся поднять `minRequiredTokens` когда `runCheckErrorsAfterFill && !shouldComplete` — проверить ручным прогоном (Task 3).
