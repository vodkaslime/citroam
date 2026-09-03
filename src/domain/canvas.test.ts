import {
  createCard,
  createEmptyWorkspace,
  fitWorkspaceView,
  LOOSE_PAGE_KEY,
  migrateTasksToWorkspace,
  workspaceReducer,
} from "./canvas";
import type { Workspace } from "./canvas";
import type { LegacyTask } from "./legacyTasks";

const NOW = new Date("2026-08-24T09:00:00+08:00");

describe("card creation", () => {
  it("creates a light card from only a title", () => {
    expect(createCard({ title: "  给家里打电话  " }, { id: "card-1", now: NOW })).toEqual({
      id: "card-1",
      schemaVersion: 2,
      title: "给家里打电话",
      notes: "",
      status: "open",
      priority: null,
      timeConstraint: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      completedAt: null,
    });
  });

  it("keeps an optional date, period and exact time", () => {
    const card = createCard({
      title: "复诊",
      timeConstraint: { date: "2026-08-26", period: "afternoon", startTime: "14:00", endTime: "15:00" },
    }, { id: "card-time", now: NOW });
    expect(card.timeConstraint).toEqual({ date: "2026-08-26", period: "afternoon", startTime: "14:00", endTime: "15:00" });
  });

  it("rejects an internally inconsistent exact time", () => {
    expect(() => createCard({
      title: "下午复诊",
      timeConstraint: { date: "2026-08-24", period: "morning", startTime: "14:00" },
    }, { id: "bad-time", now: NOW })).toThrow("卡片时间无效");
  });
});

describe("workspace pages", () => {
  it("starts at schema v3 without persistent date page objects", () => {
    const workspace = createEmptyWorkspace(NOW);
    expect(workspace).toEqual(expect.objectContaining({ schemaVersion: 3, cards: [], placements: [], areas: [] }));
    expect(workspace).not.toHaveProperty("timeFences");
  });

  it("puts dated cards on their date page and undated cards on loose", () => {
    const dated = createCard({
      title: "明天取快递",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    }, { id: "dated", now: NOW });
    const loose = createCard({ title: "也许去学陶艺" }, { id: "loose", now: NOW });
    let workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card: dated,
      pageKey: "2026-08-25",
      position: { x: 320, y: 220 },
    });
    workspace = workspaceReducer(workspace, {
      type: "add-card",
      card: loose,
      pageKey: LOOSE_PAGE_KEY,
      position: { x: 120, y: 160 },
    });

    expect(workspace.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "dated", pageKey: "2026-08-25" }),
      expect.objectContaining({ cardId: "loose", pageKey: "loose" }),
    ]));
  });

  it("refuses a placement page that disagrees with the card date", () => {
    const card = createCard({
      title: "不能放错页",
      timeConstraint: { date: "2026-08-25", period: "morning" },
    }, { id: "card-1", now: NOW });
    const workspace = createEmptyWorkspace(NOW);
    const unchanged = workspaceReducer(workspace, {
      type: "add-card",
      card,
      pageKey: "2026-08-26",
      position: { x: 200, y: 300 },
    });
    expect(unchanged).toBe(workspace);
  });

  it("ignores a duplicate card id instead of creating a second placement", () => {
    const card = createCard({ title: "只出现一次" }, { id: "duplicate-card", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      pageKey: LOOSE_PAGE_KEY,
      position: { x: 120, y: 160 },
    });

    const unchanged = workspaceReducer(workspace, {
      type: "add-card",
      card,
      pageKey: LOOSE_PAGE_KEY,
      position: { x: 420, y: 360 },
    });

    expect(unchanged).toBe(workspace);
    expect(unchanged.cards).toHaveLength(1);
    expect(unchanged.placements).toHaveLength(1);
  });

  it("keeps unknown card and area actions as no-ops", () => {
    const workspace = createEmptyWorkspace(NOW);

    const afterCardMove = workspaceReducer(workspace, {
      type: "move-card",
      cardId: "missing-card",
      position: { x: 120, y: 160 },
      now: NOW,
    });
    const afterAreaUpdate = workspaceReducer(workspace, {
      type: "update-area",
      areaId: "missing-area",
      patch: { title: "不会出现" },
      now: NOW,
    });
    const afterAreaRemoval = workspaceReducer(workspace, {
      type: "remove-area",
      areaId: "missing-area",
    });

    expect(afterCardMove).toBe(workspace);
    expect(afterAreaUpdate).toBe(workspace);
    expect(afterAreaRemoval).toBe(workspace);
  });

  it("does not write an update when card content is already identical", () => {
    const card = createCard({ title: "保持原样", notes: "备注" }, { id: "same-card", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      pageKey: LOOSE_PAGE_KEY,
      position: { x: 120, y: 160 },
    });

    const unchanged = workspaceReducer(workspace, {
      type: "update-card",
      cardId: card.id,
      patch: { title: "保持原样", notes: "备注" },
      now: new Date("2026-08-24T10:00:00+08:00"),
    });

    expect(unchanged).toBe(workspace);
  });

  it("moves time and page placement in one scheduling change", () => {
    const card = createCard({ title: "约朋友吃饭" }, { id: "card-1", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      pageKey: "loose",
      position: { x: 120, y: 160 },
    });
    const scheduledAt = new Date("2026-08-24T10:00:00+08:00");
    const scheduled = workspaceReducer(workspace, {
      type: "schedule-card",
      cardId: card.id,
      timeConstraint: { date: "2026-08-27", period: "evening" },
      position: { x: 520, y: 690 },
      now: scheduledAt,
    });

    expect(scheduled.cards[0]).toMatchObject({ timeConstraint: { date: "2026-08-27", period: "evening" } });
    expect(scheduled.placements[0]).toMatchObject({ pageKey: "2026-08-27", x: 520, y: 690, areaId: null });
  });

  it("clears the date by returning a card to loose", () => {
    const card = createCard({
      title: "先不安排",
      timeConstraint: { date: "2026-08-27", period: "anytime" },
    }, { id: "card-1", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      position: { x: 320, y: 180 },
    });
    const loose = workspaceReducer(workspace, {
      type: "schedule-card",
      cardId: card.id,
      timeConstraint: null,
      position: { x: 320, y: 180 },
      now: NOW,
    });
    expect(loose.cards[0].timeConstraint).toBeNull();
    expect(loose.placements[0].pageKey).toBe("loose");
  });

  it("keeps areas scoped to one page", () => {
    const workspace = createEmptyWorkspace(NOW);
    const area = {
      id: "area-1",
      canvasId: workspace.canvas.id,
      pageKey: LOOSE_PAGE_KEY,
      title: "周末可能做",
      x: 100,
      y: 120,
      width: 520,
      height: 320,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    } as const;
    const added = workspaceReducer(workspace, { type: "add-area", area });
    expect(added.areas[0].pageKey).toBe("loose");
  });

  it("rejects date-page areas because areas are only visual ranges on loose", () => {
    const workspace = createEmptyWorkspace(NOW);
    const dateArea = {
      id: "date-area",
      canvasId: workspace.canvas.id,
      pageKey: "2026-08-24",
      title: "不应出现在日期页",
      x: 100,
      y: 120,
      width: 520,
      height: 320,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    } as const;

    const unchanged = workspaceReducer(workspace, { type: "add-area", area: dateArea });

    expect(unchanged).toBe(workspace);
  });

  it("does not keep legacy area membership after a card is manually moved", () => {
    const card = createCard({ title: "移动这张卡" }, { id: "card-in-area", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      pageKey: LOOSE_PAGE_KEY,
      position: { x: 120, y: 160 },
    });
    const withLegacyMembership: Workspace = {
      ...workspace,
      placements: workspace.placements.map((placement) => ({ ...placement, areaId: "legacy-area" })),
    };

    const moved = workspaceReducer(withLegacyMembership, {
      type: "move-card",
      cardId: card.id,
      position: { x: 360, y: 220 },
      now: NOW,
    });

    expect(moved.placements[0].areaId).toBeNull();
  });

  it("completes and restores without moving pages", () => {
    const card = createCard({ title: "整理桌面" }, { id: "card-1", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      position: { x: 240, y: 180 },
    });
    const completed = workspaceReducer(workspace, { type: "toggle-card", cardId: card.id, now: NOW });
    const restored = workspaceReducer(completed, { type: "toggle-card", cardId: card.id, now: NOW });
    expect(completed.cards[0].status).toBe("completed");
    expect(restored.cards[0].status).toBe("open");
    expect(restored.placements[0]).toEqual(workspace.placements[0]);
  });

  it("does not turn a deleted card back into an active status", () => {
    const card = createCard({ title: "已经删除" }, { id: "deleted-card", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card,
      position: { x: 240, y: 180 },
    });
    const deleted = workspaceReducer(workspace, {
      type: "delete-card",
      cardId: card.id,
      now: NOW,
    });

    const toggled = workspaceReducer(deleted, {
      type: "toggle-card",
      cardId: card.id,
      now: NOW,
    });

    expect(toggled).toBe(deleted);
    expect(toggled.cards[0].status).toBe("deleted");
  });
});

describe("legacy task migration", () => {
  it("turns due dates into date pages without inventing page records", () => {
    const task: LegacyTask = {
      id: "legacy-1",
      title: "更新作品集",
      notes: "补上最近项目",
      status: "inbox",
      priority: "high",
      dueDate: "2026-08-26",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      completedAt: null,
    };
    const workspace = migrateTasksToWorkspace([task]);
    expect(workspace.schemaVersion).toBe(3);
    expect(workspace.cards[0].timeConstraint).toEqual({ date: "2026-08-26", period: "anytime" });
    expect(workspace.placements[0].pageKey).toBe("2026-08-26");
    expect(workspace).not.toHaveProperty("timeFences");
  });
});

describe("canvas navigation", () => {
  it("fits only the requested page", () => {
    const first = createCard({ title: "随手" }, { id: "loose", now: NOW });
    const second = createCard({
      title: "明天",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    }, { id: "dated", now: NOW });
    let workspace = workspaceReducer(createEmptyWorkspace(NOW), { type: "add-card", card: first, position: { x: 100, y: 120 } });
    workspace = workspaceReducer(workspace, { type: "add-card", card: second, position: { x: 3000, y: 420 } });

    const fitted = fitWorkspaceView(workspace, { width: 800, height: 600 }, LOOSE_PAGE_KEY);
    expect(fitted.zoom).toBe(1);
    expect(fitted.x).toBeLessThan(100);
    expect(fitted.x).toBeGreaterThan(-100);
  });
});
