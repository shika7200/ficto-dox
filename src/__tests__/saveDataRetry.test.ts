import { beforeAll, describe, expect, it, mock } from "bun:test";
import axios from "axios";
import { ApiService } from "../ApiService";

describe("saveData retry", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
    // Prevent ApiService "agent log" fetch calls from hitting network in unit tests.
    (globalThis as any).fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }) as any;
  });

  it("retries up to max attempts on 500 + 'Необработанная ошибка'", async () => {
    const post = mock()
      .mockRejectedValueOnce({
        response: { status: 500, data: { message: "Необработанная ошибка" } },
      })
      .mockRejectedValueOnce({
        response: { status: 500, data: { message: "Необработанная ошибка" } },
      })
      .mockResolvedValue({ status: 200, data: { status: true } });

    (axios as any).post = post;

    const api = new ApiService();
    const r = await api.saveData(
      "t",
      { panel_id: 1, params: { panel_id: 1 }, table: [] } as any
    );

    expect(r.status).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 4xx", async () => {
    const post = mock().mockRejectedValue({
      response: { status: 400, data: { message: "Bad Request" } },
    });

    (axios as any).post = post;

    const api = new ApiService();
    await expect(
      api.saveData(
        "t",
        { panel_id: 1, params: { panel_id: 1 }, table: [] } as any
      )
    ).rejects.toThrow();

    expect(post).toHaveBeenCalledTimes(1);
  });
});

