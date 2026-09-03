import { describe, expect, it } from "vitest";
import { createCard, createEmptyWorkspace, workspaceReducer, type Workspace } from "../domain/canvas";
import {
  executeAgentPlan,
  interpretLocalAgent,
  prepareAgentPlan,
  retargetAgentIntent,
  type AgentContext,
} from "./agentCore";

const NOW = new Date("2026-09-01T09:00:00+08:00");
const CONTEXT: AgentContext = {
  now: NOW,
  currentPage: "2026-09-01",
  selectedCardId: null,
  view: "canvas",
  overviewStatus: "open",
};

function addCard(
  workspace: Workspace,
  title: string,
  id: string,
  date = "2026-09-01",
  status: "open" | "completed" = "open",
) {
  const card = createCard({
    title,
    timeConstraint: { date, period: "anytime" },
  }, { id, now: NOW });
  const added = workspaceReducer(workspace, {
    type: "add-card",
    card,
    pageKey: date,
    position: { x: 100, y: 120 },
  });
  return status === "completed"
    ? workspaceReducer(added, { type: "toggle-card", cardId: id, now: NOW })
    : added;
}

describe("local agent interpretation", () => {
  it("turns a natural dated sentence into a create intent", () => {
    expect(interpretLocalAgent("明天下午交水电费", CONTEXT)).toEqual({
      type: "create",
      title: "交水电费",
      timeConstraint: { date: "2026-09-02", period: "afternoon" },
    });
  });

  it("turns a move request into a targeted schedule intent", () => {
    expect(interpretLocalAgent("把报销放到明天下午", CONTEXT)).toEqual({
      type: "schedule",
      target: { kind: "query", query: "报销" },
      timeConstraint: { date: "2026-09-02", period: "afternoon" },
    });
  });

  it("uses the selected card only when the user explicitly says this one", () => {
    expect(interpretLocalAgent("这个做完了", { ...CONTEXT, selectedCardId: "card-1" })).toEqual({
      type: "set-status",
      target: { kind: "id", cardId: "card-1" },
      status: "completed",
    });
  });

  it("turns an explicit open request into a targeted open intent", () => {
    expect(interpretLocalAgent("打开提交报销", CONTEXT)).toEqual({
      type: "open",
      target: { kind: "query", query: "提交报销" },
    });
  });

  it("turns a daily batch move into one batch intent", () => {
    expect(interpretLocalAgent("把今天没做完的移到周五", CONTEXT)).toEqual({
      type: "batch-schedule",
      sourceDate: "2026-09-01",
      timeConstraint: { date: "2026-09-04", period: "anytime" },
    });
  });

  it("maps next-week weekdays to the next calendar week without skipping another week", () => {
    expect(interpretLocalAgent("下周一交周报", CONTEXT)).toEqual({
      type: "create",
      title: "交周报",
      timeConstraint: { date: "2026-09-07", period: "anytime" },
    });
  });

  it("keeps next-week weekdays correct when today is Sunday", () => {
    const sundayContext = {
      ...CONTEXT,
      now: new Date("2026-09-06T09:00:00+08:00"),
      currentPage: "2026-09-06",
    };

    expect(interpretLocalAgent("下周一整理房间", sundayContext)).toEqual({
      type: "create",
      title: "整理房间",
      timeConstraint: { date: "2026-09-07", period: "anytime" },
    });
  });

  it("does not invent a notification when the user asks for a reminder", () => {
    expect(interpretLocalAgent("明天提醒我交房租", CONTEXT)).toEqual({
      type: "create",
      title: "交房租",
      timeConstraint: { date: "2026-09-02", period: "anytime" },
    });
  });

  it("does not silently downgrade an out-of-range meridiem time", () => {
    expect(interpretLocalAgent("明天下午13点开会", CONTEXT)).toEqual({
      type: "unsupported",
      message: "这个时间不合法，画布没有变化。",
    });
  });

  it("keeps the meridiem attached to a valid spoken clock time", () => {
    expect(interpretLocalAgent("明天下午3点开会", CONTEXT)).toEqual({
      type: "create",
      title: "开会",
      timeConstraint: { date: "2026-09-02", period: "afternoon", startTime: "15:00" },
    });
  });

  it("keeps a meridiem when spoken time contains natural spaces", () => {
    expect(interpretLocalAgent("明天下午 3 点开会", CONTEXT)).toEqual({
      type: "create",
      title: "开会",
      timeConstraint: { date: "2026-09-02", period: "afternoon", startTime: "15:00" },
    });
  });

  it("rejects a spoken clock whose meridiem disagrees with its actual period", () => {
    expect(interpretLocalAgent("明天下午8点开会", CONTEXT)).toEqual({
      type: "unsupported",
      message: "这个时间不合法，画布没有变化。",
    });
  });

  it("turns a completed-list request into a read-only list intent", () => {
    expect(interpretLocalAgent("今天完成了什么", CONTEXT)).toEqual({
      type: "list",
      date: "2026-09-01",
      status: "completed",
    });
  });
});

describe("agent policy", () => {
  it("rejects malformed model output before it becomes an executable plan", () => {
    const malformed = {
      type: "create",
      title: 42,
      timeConstraint: { date: "tomorrow", period: "later" },
    } as unknown;

    const plan = prepareAgentPlan(malformed, createEmptyWorkspace(NOW), CONTEXT);

    expect(plan).toMatchObject({
      kind: "reject",
      message: "现在没有处理成功，画布没有变化。",
      operations: [],
      cardIds: [],
    });
  });

  it("rejects unknown model actions before policy evaluation", () => {
    const plan = prepareAgentPlan(
      { type: "rearrange-canvas", cardIds: ["card-1"] } as unknown,
      createEmptyWorkspace(NOW),
      CONTEXT,
    );

    expect(plan).toMatchObject({ kind: "reject", operations: [] });
  });

  it("rejects a time intent whose period or range does not match its clock", () => {
    const plan = prepareAgentPlan(
      {
        type: "create",
        title: "整理会议资料",
        timeConstraint: {
          date: "2026-09-01",
          period: "morning",
          startTime: "14:00",
          endTime: "13:00",
        },
      } as unknown,
      createEmptyWorkspace(NOW),
      CONTEXT,
    );

    expect(plan).toMatchObject({
      kind: "reject",
      message: "现在没有处理成功，画布没有变化。",
      operations: [],
    });
  });

  it("executes one uniquely matched reversible action without confirmation", () => {
    const workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    const intent = interpretLocalAgent("把提交报销放到明天下午", CONTEXT);

    const plan = prepareAgentPlan(intent, workspace, CONTEXT);

    expect(plan.kind).toBe("execute");
    expect(plan.operations).toEqual([{
      type: "schedule",
      cardId: "card-1",
      timeConstraint: { date: "2026-09-02", period: "afternoon" },
    }]);
    expect(plan.message).toBe("好，放到明天下午了。");
  });

  it("resolves one open target without creating a write operation", () => {
    const workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");

    const plan = prepareAgentPlan(interpretLocalAgent("打开提交报销", CONTEXT), workspace, CONTEXT);

    expect(plan).toMatchObject({
      kind: "show",
      message: "找到了。",
      operations: [],
      cardIds: ["card-1"],
    });
  });

  it("asks one question and keeps operations empty when names are ambiguous", () => {
    let workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    workspace = addCard(workspace, "整理报销", "card-2");
    const intent = interpretLocalAgent("把报销放到明天下午", CONTEXT);

    const plan = prepareAgentPlan(intent, workspace, CONTEXT);

    expect(plan.kind).toBe("clarify");
    expect(plan.operations).toEqual([]);
    expect(plan.candidates.map((candidate) => candidate.id)).toEqual(["card-1", "card-2"]);
    expect(plan.message).toBe("找到两张“报销”，你指哪一张？");
  });

  it("can retarget the same intent after the user chooses a candidate", () => {
    const ambiguous = interpretLocalAgent("把报销放到明天下午", CONTEXT);

    expect(retargetAgentIntent(ambiguous, "card-2")).toEqual({
      type: "schedule",
      target: { kind: "id", cardId: "card-2" },
      timeConstraint: { date: "2026-09-02", period: "afternoon" },
    });
  });

  it("requires one confirmation for a batch action", () => {
    let workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    workspace = addCard(workspace, "整理发票", "card-2");
    workspace = addCard(workspace, "明天的事情", "card-3", "2026-09-02");
    const intent = interpretLocalAgent("把今天没做完的移到周五", CONTEXT);

    const plan = prepareAgentPlan(intent, workspace, CONTEXT);

    expect(plan.kind).toBe("confirm");
    expect(plan.operations).toHaveLength(2);
    expect(plan.message).toBe("会移动 2 张 Card 到周五。");
  });

  it("requires destructive confirmation before deleting a card", () => {
    const workspace = addCard(createEmptyWorkspace(NOW), "作废的草稿", "card-1");
    const intent = interpretLocalAgent("删除作废的草稿", CONTEXT);

    const plan = prepareAgentPlan(intent, workspace, CONTEXT);

    expect(plan.kind).toBe("confirm-destructive");
    expect(plan.operations).toEqual([{ type: "delete", cardId: "card-1" }]);
  });

  it("returns a factual list without creating write operations", () => {
    let workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    workspace = addCard(workspace, "整理发票", "card-2");

    const plan = prepareAgentPlan(interpretLocalAgent("今天还有什么", CONTEXT), workspace, CONTEXT);

    expect(plan.kind).toBe("show");
    expect(plan.operations).toEqual([]);
    expect(plan.cardIds).toEqual(["card-1", "card-2"]);
    expect(plan.message).toBe("今天还有 2 张未完成。");
  });

  it("returns a few direct card results with a factual date list", () => {
    let workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    workspace = addCard(workspace, "整理发票", "card-2");

    const plan = prepareAgentPlan(interpretLocalAgent("今天还有什么", CONTEXT), workspace, CONTEXT);

    expect(plan.candidates.map((candidate) => candidate.id)).toEqual(["card-1", "card-2"]);
  });

  it("uses completed wording when listing completed cards", () => {
    const workspace = addCard(
      createEmptyWorkspace(NOW),
      "提交报销",
      "card-1",
      "2026-09-01",
      "completed",
    );

    const plan = prepareAgentPlan(
      { type: "list", date: "2026-09-01", status: "completed" },
      workspace,
      { ...CONTEXT, overviewStatus: "completed" },
    );

    expect(plan.kind).toBe("show");
    expect(plan.cardIds).toEqual(["card-1"]);
    expect(plan.message).toBe("今天有 1 张已完成。");
  });
});

describe("agent execution", () => {
  it("keeps an already-scheduled card unchanged instead of creating another undo", () => {
    const workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    const plan = prepareAgentPlan(
      interpretLocalAgent("把提交报销放到今天", CONTEXT),
      workspace,
      CONTEXT,
    );
    let positioned = false;

    const result = executeAgentPlan(workspace, plan, {
      now: NOW,
      confirmed: false,
      createId: () => "unused",
      positionFor: () => {
        positioned = true;
        return { x: 480, y: 520 };
      },
    });

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
    expect(result.affectedCardIds).toEqual([]);
    expect(positioned).toBe(false);
  });

  it("applies a confirmed batch as one complete workspace result", () => {
    let workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    workspace = addCard(workspace, "整理发票", "card-2");
    const plan = prepareAgentPlan(
      interpretLocalAgent("把今天没做完的移到周五", CONTEXT),
      workspace,
      CONTEXT,
    );

    const result = executeAgentPlan(workspace, plan, {
      now: NOW,
      confirmed: true,
      createId: () => "unused",
      positionFor: (_next, pageKey) => pageKey === "2026-09-04"
        ? { x: 480, y: 520 }
        : { x: 100, y: 120 },
    });

    expect(result.changed).toBe(true);
    expect(result.affectedCardIds).toEqual(["card-1", "card-2"]);
    expect(result.workspace.cards.map((card) => card.timeConstraint?.date)).toEqual([
      "2026-09-04",
      "2026-09-04",
    ]);
    expect(result.workspace.placements.map((placement) => placement.pageKey)).toEqual([
      "2026-09-04",
      "2026-09-04",
    ]);
  });

  it("keeps the workspace unchanged when a confirmation has not been accepted", () => {
    const workspace = addCard(createEmptyWorkspace(NOW), "作废的草稿", "card-1");
    const plan = prepareAgentPlan(interpretLocalAgent("删除作废的草稿", CONTEXT), workspace, CONTEXT);

    const result = executeAgentPlan(workspace, plan, {
      now: NOW,
      confirmed: false,
      createId: () => "unused",
      positionFor: () => ({ x: 100, y: 120 }),
    });

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(workspace);
    expect(workspace.cards[0].status).toBe("open");
  });

  it("keeps a confirmed batch a no-op when a target changes after preview", () => {
    let workspace = addCard(createEmptyWorkspace(NOW), "提交报销", "card-1");
    workspace = addCard(workspace, "整理发票", "card-2");
    const plan = prepareAgentPlan(
      interpretLocalAgent("把今天没做完的移到周五", CONTEXT),
      workspace,
      CONTEXT,
    );
    const changedAfterPreview = workspaceReducer(workspace, {
      type: "toggle-card",
      cardId: "card-1",
      now: NOW,
    });

    const result = executeAgentPlan(changedAfterPreview, plan, {
      now: NOW,
      confirmed: true,
      createId: () => "unused",
      positionFor: () => ({ x: 480, y: 520 }),
    });

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(changedAfterPreview);
    expect(result.workspace.cards.find((card) => card.id === "card-1")?.status).toBe("completed");
    expect(result.workspace.cards.find((card) => card.id === "card-2")?.timeConstraint?.date)
      .toBe("2026-09-01");
  });

  it("creates a card through the same workspace model", () => {
    const workspace = createEmptyWorkspace(NOW);
    const plan = prepareAgentPlan(interpretLocalAgent("明天下午交水电费", CONTEXT), workspace, CONTEXT);

    const result = executeAgentPlan(workspace, plan, {
      now: NOW,
      confirmed: false,
      createId: () => "agent-card",
      positionFor: () => ({ x: 320, y: 480 }),
    });

    expect(result.workspace.cards[0]).toMatchObject({
      id: "agent-card",
      title: "交水电费",
      timeConstraint: { date: "2026-09-02", period: "afternoon" },
    });
    expect(result.workspace.placements[0]).toMatchObject({
      cardId: "agent-card",
      pageKey: "2026-09-02",
      x: 320,
      y: 480,
    });
  });
});
