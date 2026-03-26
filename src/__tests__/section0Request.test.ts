import { describe, expect, it } from "bun:test";
import { createSectionRequest } from "../parse_Doxcelljson";

describe("SECTION_0 request builder", () => {
  it("builds save-data payload from content.columns mapping", () => {
    const inputJson = {
      doxcellLogin: "x",
      fictoLogin: "x",
      fictoPass: "x",
      documentId: "1",
      factors: {
        rpreport17s0r20c14_0: "School",
        rpreport17s0r21c6_0: "Address",
      },
    } as any;

    const mapping = {
      SECTION_0: {
        content: {
          _id: "abc123",
          panel_id: 4483,
          columns: {
            "5848": "rpreport17s0r20c14_0",
            "5849": "rpreport17s0r21c6_0",
          },
        },
      },
    };

    const body = createSectionRequest("SECTION_0", inputJson, mapping, undefined, {
      SECTION_0: 4483,
    }) as any;

    expect(body.params.panel_id).toBe(4483);
    expect(body.fixation_params).toEqual({});
    expect(body.data["5848"]).toBe("School");
    expect(body.data["5849"]).toBe("Address");
  });
});

