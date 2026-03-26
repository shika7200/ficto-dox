import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataMapping } from "../mapping_oo-2_2025";

type Section11Fixture = {
  panel_id: number;
  description_columns_not_required_in_mapping: string[];
  required_data_columns: string[];
};

const loadSection11Fixture = (): Section11Fixture => {
  const fixturePath = resolve(
    process.cwd(),
    "src/fixtures/web-save-data-section11.json"
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Section11Fixture;
};

describe("mapping parity (SECTION_11)", () => {
  it("contains expected section 11 data column keys from web capture", () => {
    const fixture = loadSection11Fixture();
    const section11 = dataMapping.SECTION_11;

    expect(section11.panel_id).toBe(fixture.panel_id);

    const headerKeys = Object.keys(section11.header.columns);
    for (const col of fixture.required_data_columns) {
      expect(headerKeys).toContain(col);
    }

    // 51925/51926 are descriptive columns and intentionally omitted.
    for (const omitted of fixture.description_columns_not_required_in_mapping) {
      expect(headerKeys).not.toContain(omitted);
    }
  });
});

