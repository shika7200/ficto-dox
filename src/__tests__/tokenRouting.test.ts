import { describe, expect, it } from "bun:test";
import {
  chooseTokenIndexForPanel,
  shouldProbeAlternativeToken,
} from "../fictioFill";

describe("panel token routing", () => {
  it("remembers successful token index for panel and reuses it", () => {
    const cache = new Map<number, number>();
    cache.set(4474, 2);
    const idx = chooseTokenIndexForPanel(4474, cache, 0);
    expect(idx).toBe(2);
  });

  it("does not probe alternative token in strict page binding mode", () => {
    expect(
      shouldProbeAlternativeToken(true, {
        response: { status: 500, data: { message: "Необработанная ошибка" } },
      })
    ).toBe(false);
  });

  it("allows probing only for overload-like 500 in non-strict mode", () => {
    expect(
      shouldProbeAlternativeToken(false, {
        response: { status: 500, data: { message: "Необработанная ошибка" } },
      })
    ).toBe(true);
    expect(
      shouldProbeAlternativeToken(false, {
        response: { status: 400, data: { message: "Bad Request" } },
      })
    ).toBe(false);
  });
});

