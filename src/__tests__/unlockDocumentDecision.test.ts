import { describe, expect, it } from "bun:test";
import {
  buildStatusPanelCandidates,
  isCancelForbiddenForCurrentStatus,
  resolveUnlockStatusParams,
  shouldCancelDocumentLock,
} from "../fictioUnlockDocument";

describe("shouldCancelDocumentLock", () => {
  it("returns true when document completion is disabled", () => {
    expect(shouldCancelDocumentLock({ disabled_complite: true })).toBe(true);
  });

  it("returns false when document is not blocked", () => {
    expect(shouldCancelDocumentLock({ disabled_complite: false })).toBe(false);
  });
});

describe("buildStatusPanelCandidates", () => {
  it("builds unique prioritized list of panel ids", () => {
    const ids = buildStatusPanelCandidates({
      statusPanelId: 3289,
      checkErrorsPanelId: 4482,
      panelIdBySection: { SECTION_0: 4483, SECTION_11: 4484, SECTION_12: 4483 },
    });

    expect(ids).toEqual([3289, 4482, 4483, 4484]);
  });

  it("skips invalid values", () => {
    const ids = buildStatusPanelCandidates({
      statusPanelId: undefined,
      checkErrorsPanelId: NaN,
      panelIdBySection: { A: -1, B: 0, C: 4448 },
    });

    expect(ids).toEqual([4448]);
  });
});

describe("resolveUnlockStatusParams", () => {
  it("uses explicit fictoDocumentId when provided", () => {
    const params = resolveUnlockStatusParams({ fictoDocumentId: 4906 });
    expect(params).toEqual({
      documentId: 4906,
      panelId: 3289,
      workspaceIndex: 21,
    });
  });

  it("uses defaults from known unlock flow", () => {
    const params = resolveUnlockStatusParams({});
    expect(params).toEqual({
      documentId: 339,
      panelId: 3289,
      workspaceIndex: 21,
    });
  });
});

describe("isCancelForbiddenForCurrentStatus", () => {
  it("detects 409 status transition restriction", () => {
    expect(
      isCancelForbiddenForCurrentStatus(
        "Ошибка отмены блокировки документа: Статус 409 – Для текущего статуса запрещено изменение статуса отчета (отмена проверки на наличие ошибок)"
      )
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(
      isCancelForbiddenForCurrentStatus(
        "Ошибка отмены блокировки документа: Статус 500 – Необработанная ошибка"
      )
    ).toBe(false);
  });
});
