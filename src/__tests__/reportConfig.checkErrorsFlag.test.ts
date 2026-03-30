import { describe, expect, it } from "bun:test";
import { getReportConfig } from "../reportConfig";

describe("reportConfig check-errors flags", () => {
  it("enables after-fill and after-each-section for OO-2 (report17)", () => {
    const c = getReportConfig("report17");
    expect(c.runCheckErrorsAfterFill).toBe(false);
    expect(c.runCheckErrorsAfterEachSection).toBe(false);
    expect(c.checkErrorsPanelId).toBe(4482);
  });

  it("disables both for form_1od_2025", () => {
    const c = getReportConfig("form_1od_2025");
    expect(c.runCheckErrorsAfterFill).toBe(false);
    expect(c.runCheckErrorsAfterEachSection).toBe(false);
  });
});
