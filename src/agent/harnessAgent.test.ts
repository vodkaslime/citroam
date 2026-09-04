import { describe, expect, it } from "vitest";
import { extractHarnessIntent, harnessAgentPrompt, serializeHarnessContext, type HarnessRun } from "./harnessAgent";
import { createEmptyWorkspace } from "../domain/canvas";

describe("DeepSeek Harness agent bridge", () => {
  it("extracts the canonical intent from a citroam tool result", () => {
    const run: HarnessRun = {
      finalResponse: "已处理",
      events: [
        {
          type: "tool/result",
          data: {
            message: {
              content: [{
                type: "tool-result",
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    type: "create",
                    title: "交水电费",
                    timeConstraint: null,
                  }),
                }],
              }],
            },
          },
        },
      ],
    };

    expect(extractHarnessIntent(run)).toEqual({
      type: "create",
      title: "交水电费",
      timeConstraint: null,
    });
  });

  it("never treats an ordinary assistant sentence as a workspace action", () => {
    expect(extractHarnessIntent({ finalResponse: "我帮你安排好了。", events: [] })).toBeNull();
  });

  it("serializes only actionable card metadata for the model", () => {
    const workspace = createEmptyWorkspace(new Date("2026-09-04T09:00:00+08:00"));
    workspace.cards = [
      {
        id: "open-card",
        schemaVersion: 2,
        title: "买牛奶",
        notes: "不应发送",
        status: "open",
        priority: "high",
        timeConstraint: { date: "2026-09-04", period: "morning" },
        createdAt: "2026-09-04T01:00:00.000Z",
        updatedAt: "2026-09-04T01:00:00.000Z",
        completedAt: null,
      },
      {
        id: "deleted-card",
        schemaVersion: 2,
        title: "已删除",
        notes: "",
        status: "deleted",
        priority: null,
        timeConstraint: null,
        createdAt: "2026-09-04T01:00:00.000Z",
        updatedAt: "2026-09-04T01:00:00.000Z",
        completedAt: null,
      },
    ];
    workspace.placements = [
      { cardId: "open-card", canvasId: "main-canvas", pageKey: "2026-09-04", x: 12, y: 24, zIndex: 1, areaId: null, updatedAt: "2026-09-04T01:00:00.000Z" },
      { cardId: "deleted-card", canvasId: "main-canvas", pageKey: "loose", x: 999, y: 999, zIndex: 2, areaId: null, updatedAt: "2026-09-04T01:00:00.000Z" },
    ];

    expect(serializeHarnessContext({
      now: new Date("2026-09-04T09:00:00+08:00"),
      currentPage: "2026-09-04",
      selectedCardId: "open-card",
      view: "canvas",
      overviewStatus: "open",
      workspace,
    })).toEqual({
      now: "2026-09-04T01:00:00.000Z",
      currentPage: "2026-09-04",
      selectedCardId: "open-card",
      view: "canvas",
      overviewStatus: "open",
      workspace: {
        cards: [{
          id: "open-card",
          title: "买牛奶",
          status: "open",
          timeConstraint: { date: "2026-09-04", period: "morning" },
          priority: "high",
        }],
        placements: [{ cardId: "open-card", pageKey: "2026-09-04" }],
      },
    });
  });

  it("fails clearly when the Tauri bridge is unavailable", async () => {
    await expect(harnessAgentPrompt("记下买牛奶", {
      now: new Date("2026-09-04T09:00:00+08:00"),
      currentPage: "2026-09-04",
      selectedCardId: null,
      view: "canvas",
      overviewStatus: "open",
    })).rejects.toThrow(/Tauri/);
  });
});
