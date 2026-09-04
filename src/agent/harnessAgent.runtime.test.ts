import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "../domain/canvas";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));

import { harnessAgentPrompt } from "./harnessAgent";

describe("production Harness command bridge", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    bridge.invoke.mockReset();
    bridge.invoke.mockResolvedValue({
      finalResponse: "已处理",
      events: [{
        type: "tool/result",
        data: { message: { content: [{ type: "tool-result", content: [{ type: "text", text: JSON.stringify({ type: "create", title: "买牛奶", timeConstraint: null }) }] }] } },
      }],
    });
  });

  afterEach(() => Reflect.deleteProperty(window, "__TAURI_INTERNALS__"));

  it("uses Tauri's camel-cased requestText command argument", async () => {
    await harnessAgentPrompt("记下买牛奶", {
      now: new Date("2026-09-04T09:00:00+08:00"),
      currentPage: "2026-09-04",
      selectedCardId: null,
      view: "canvas",
      overviewStatus: "open",
      workspace: createEmptyWorkspace(new Date("2026-09-04T09:00:00+08:00")),
    });

    expect(bridge.invoke).toHaveBeenCalledWith("agent_prompt", expect.objectContaining({
      requestText: "记下买牛奶",
      context: expect.objectContaining({ currentPage: "2026-09-04" }),
    }));
    expect(bridge.invoke.mock.calls[0][1]).not.toHaveProperty("request");
  });
});
