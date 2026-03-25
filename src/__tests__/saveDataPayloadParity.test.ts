import { describe, expect, it } from "bun:test";
import {
  buildSaveDataHeaders,
  prepareSaveDataPayload,
} from "../saveDataPolicy";

describe("save-data payload parity", () => {
  it("sets X-Fingerprint and X-Session-Id when provided", () => {
    const h = buildSaveDataHeaders(
      { "L-Token": "t" },
      { fingerprint: "fp", sessionId: "sid" }
    );

    expect(h["X-Fingerprint"]).toBe("fp");
    expect(h["X-Session-Id"]).toBe("sid");
  });

  it("normalizes dynamic row _id to null when policy requires", () => {
    const body = prepareSaveDataPayload(
      {
        panel_id: 1,
        params: { panel_id: 1 },
        table: [{ _id: "", columns: {} }],
      } as any,
      { nullAsEmptyString: false, includeRowIdField: "null" }
    );

    expect((body as any).table[0]._id).toBeNull();
  });
});

