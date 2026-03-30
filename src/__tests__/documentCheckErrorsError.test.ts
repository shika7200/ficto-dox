import { describe, expect, it } from "bun:test";
import { DocumentCheckErrorsError } from "../documentCheckErrorsError";

describe("DocumentCheckErrorsError", () => {
  it("carries errors for API/UI payload", () => {
    const payload = [{ field: "x", message: "required" }];
    const err = new DocumentCheckErrorsError("Обнаружены ошибки", payload);
    expect(err.message).toBe("Обнаружены ошибки");
    expect(err.errors).toEqual(payload);
    expect(err instanceof DocumentCheckErrorsError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
