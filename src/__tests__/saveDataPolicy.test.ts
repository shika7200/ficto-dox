import { describe, expect, it } from "bun:test";
import {
  normalizeCellValue,
  normalizeRowForSaveData,
  saveDataRetryBackoffMs,
  shouldRetrySaveData,
} from "../saveDataPolicy";

describe("saveData policy", () => {
  it("converts null cell to empty string when policy says so", () => {
    expect(
      normalizeCellValue(null, { nullAsEmptyString: true, includeRowIdField: "omit" })
    ).toBe("");
  });

  it("keeps null when policy disables conversion", () => {
    expect(
      normalizeCellValue(null, { nullAsEmptyString: false, includeRowIdField: "omit" })
    ).toBeNull();
  });

  it("retries overload-like 500 errors and temporary 409 document locks", () => {
    expect(
      shouldRetrySaveData(
        500,
        "Необработанная ошибка",
        0,
        3
      )
    ).toBe(true);
    expect(
      shouldRetrySaveData(
        409,
        "Инициирован процесс формирования документа и/или его верификации на предмет наличия ошибок. Внесение данных невозможно.",
        0,
        3
      )
    ).toBe(true);
    expect(shouldRetrySaveData(400, "Bad Request", 0, 3)).toBe(false);
  });

  it("normalizes _id to null when includeRowIdField is 'null'", () => {
    const row = { _id: "" as unknown, some: 1 };
    const normalized = normalizeRowForSaveData(row as any, {
      nullAsEmptyString: false,
      includeRowIdField: "null",
    } as any);
    expect((normalized as any)._id).toBeNull();
  });

  it("uses longer retry delay for temporary 409 document lock", () => {
    expect(
      saveDataRetryBackoffMs(
        409,
        "Инициирован процесс формирования документа и/или его верификации на предмет наличия ошибок. Внесение данных невозможно.",
        0
      )
    ).toBe(5000);
    expect(saveDataRetryBackoffMs(500, "Необработанная ошибка", 0)).toBe(50);
  });
});

