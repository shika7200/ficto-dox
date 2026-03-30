import { describe, expect, it } from "bun:test";
import {
  normalizeCellValue,
  normalizeRowForSaveData,
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

  it("retries only overload-like 500 errors", () => {
    expect(
      shouldRetrySaveData(
        500,
        "Необработанная ошибка",
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
});

