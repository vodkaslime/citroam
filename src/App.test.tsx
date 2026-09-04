import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "./App";
import type { WorkspaceRepository } from "./data/workspaceRepository";
import { createCard, createEmptyWorkspace, workspaceReducer, type Area, type Workspace } from "./domain/canvas";

const NOW = new Date("2026-08-25T09:00:00+08:00");

function trackedRepository(initial: Workspace = createEmptyWorkspace(NOW)) {
  let current = initial;
  const saves: Workspace[] = [];
  return {
    repository: {
      load: async () => current,
      save: async (workspace) => {
        current = workspace;
        saves.push(workspace);
      },
    } satisfies WorkspaceRepository,
    current: () => current,
    saves,
  };
}

function workspaceWithYesterdayCard(): Workspace {
  const card = createCard({
    title: "昨天还没寄出的包裹",
    timeConstraint: { date: "2026-08-24", period: "afternoon" },
  }, { id: "yesterday-card", now: NOW });
  return workspaceReducer(createEmptyWorkspace(NOW), {
    type: "add-card",
    card,
    pageKey: "2026-08-24",
    position: { x: 320, y: 480 },
  });
}

function workspaceWithTodayCard(): Workspace {
  const card = createCard({
    title: "把卡片放在时间围栏外",
    timeConstraint: { date: "2026-08-25", period: "morning" },
  }, { id: "today-card", now: NOW });
  return workspaceReducer(createEmptyWorkspace(NOW), {
    type: "add-card",
    card,
    pageKey: "2026-08-25",
    position: { x: 320, y: 360 },
  });
}

function workspaceWithLooseAreaAndCard(): Workspace {
  const area: Area = {
    id: "loose-area",
    canvasId: "main-canvas",
    pageKey: "loose",
    title: "工作草稿",
    x: 180,
    y: 140,
    width: 520,
    height: 320,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const card = createCard({ title: "随手里的卡片" }, { id: "loose-card", now: NOW });
  let workspace = workspaceReducer(createEmptyWorkspace(NOW), { type: "add-area", area });
  workspace = workspaceReducer(workspace, {
    type: "add-card",
    card,
    pageKey: "loose",
    position: { x: 840, y: 520 },
  });
  return workspace;
}

function workspaceWithSearchCards(count = 8): Workspace {
  return Array.from({ length: count }, (_, index) => createCard({
    title: `搜索卡片 ${index + 1}`,
    timeConstraint: { date: "2026-08-25", period: "anytime" },
  }, { id: `search-${index + 1}`, now: NOW })).reduce((workspace, card, index) => workspaceReducer(workspace, {
    type: "add-card",
    card,
    pageKey: "2026-08-25",
    position: { x: 180 + (index % 3) * 270, y: 180 + Math.floor(index / 3) * 140 },
  }), createEmptyWorkspace(NOW));
}

function workspaceWithAgentCards(): Workspace {
  const cards = [
    createCard({
      title: "提交报销",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    }, { id: "agent-expense-1", now: NOW }),
    createCard({
      title: "整理报销",
      timeConstraint: { date: "2026-08-25", period: "morning" },
    }, { id: "agent-expense-2", now: NOW }),
  ];
  return cards.reduce((workspace, card, index) => workspaceReducer(workspace, {
    type: "add-card",
    card,
    pageKey: "2026-08-25",
    position: { x: 240 + index * 280, y: 220 + index * 120 },
  }), createEmptyWorkspace(NOW));
}

describe("date page canvas", () => {
  it("uses the page navigation as the only date heading", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    expect(await screen.findByRole("region", { name: "今天的画布" })).toBeInTheDocument();
    const dateControl = screen.getByRole("button", { name: "选择日期页面" });
    expect(dateControl).toHaveTextContent("今天");
    expect(dateControl).toHaveAccessibleDescription(/今天.*8月25日/);
    expect(screen.queryByText("这一天还是空白的。想到什么，直接放下来。")).not.toBeInTheDocument();
    expect(document.querySelector(".canvas-day-page-header")).not.toBeInTheDocument();
    expect(document.querySelector(".canvas-day-page-count")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加日期" })).not.toBeInTheDocument();
    expect(screen.queryByText("放下一天")).not.toBeInTheDocument();
  });

  it("opens today's date page in a safe viewport on a narrow window", async () => {
    let resolveLoad: ((workspace: Workspace) => void) | null = null;
    const tracked = trackedRepository();
    const repository: WorkspaceRepository = {
      load: () => new Promise<Workspace>((resolve) => { resolveLoad = resolve; }),
      save: tracked.repository.save,
    };
    render(<App repository={repository} now={() => NOW} />);

    const stage = screen.getByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });

    await act(async () => {
      resolveLoad?.(createEmptyWorkspace(NOW));
    });

    await screen.findByRole("region", { name: "今天的画布" });
    const world = document.querySelector<HTMLElement>(".canvas-world");
    const transform = world?.style.transform ?? "";
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)?.[1]);

    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    expect(tracked.saves).toHaveLength(0);
  });

  it("does not double-reserve the floating capture area when fitting a measured stage", async () => {
    let resolveLoad: ((workspace: Workspace) => void) | null = null;
    const tracked = trackedRepository();
    const repository: WorkspaceRepository = {
      load: () => new Promise<Workspace>((resolve) => { resolveLoad = resolve; }),
      save: tracked.repository.save,
    };
    render(<App repository={repository} now={() => NOW} />);

    const stage = screen.getByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      // This is the measured content height of a compact desktop stage. The
      // capture bar floats over the stage and must not be subtracted again.
      clientHeight: { configurable: true, value: 360 },
    });

    await act(async () => {
      resolveLoad?.(createEmptyWorkspace(NOW));
    });

    await screen.findByRole("region", { name: "今天的画布" });
    const world = document.querySelector<HTMLElement>(".canvas-world");
    const transform = world?.style.transform ?? "";
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)?.[1]);

    // A 360px stage fits the date scene at roughly 0.37. The old
    // stageHeight - 84 calculation shrank it to about 0.29.
    expect(scale).toBeGreaterThan(0.34);
    expect(tracked.saves).toHaveLength(0);
  });

  it("keeps manual look-whole-page fitting consistent with the measured stage", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const stage = screen.getByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 360 },
    });

    await screen.findByRole("region", { name: "今天的画布" });
    await userEvent.click(screen.getByRole("button", { name: "看全本页" }));

    const world = document.querySelector<HTMLElement>(".canvas-world");
    const transform = world?.style.transform ?? "";
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)?.[1]);

    // Manual fitting must use the same real stage height as the initial fit;
    // subtracting the floating capture bar a second time shrinks the scene.
    expect(scale).toBeGreaterThan(0.34);
  });

  it("uses the measured stage when entering a date page from the loose page", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const stage = screen.getByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 360 },
    });

    await screen.findByRole("region", { name: "今天的画布" });
    await userEvent.click(screen.getByRole("button", { name: "打开随手页" }));
    await userEvent.click(screen.getByRole("button", { name: "后一天" }));
    await screen.findByRole("region", { name: "明天的画布" });

    const world = document.querySelector<HTMLElement>(".canvas-world");
    const transform = world?.style.transform ?? "";
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)?.[1]);

    expect(scale).toBeGreaterThan(0.34);
  });

  it("fits the initial date scene below the floating capture area on desktop", async () => {
    let resolveLoad: ((workspace: Workspace) => void) | null = null;
    const tracked = trackedRepository();
    const repository: WorkspaceRepository = {
      load: () => new Promise<Workspace>((resolve) => { resolveLoad = resolve; }),
      save: tracked.repository.save,
    };
    render(<App repository={repository} now={() => NOW} />);

    const stage = screen.getByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 1440 },
      // A 1440×900 window leaves an 844px content stage below the title bar.
      clientHeight: { configurable: true, value: 844 },
    });

    await act(async () => {
      resolveLoad?.(createEmptyWorkspace(NOW));
    });

    await screen.findByRole("region", { name: "今天的画布" });
    const world = document.querySelector<HTMLElement>(".canvas-world");
    const transform = world?.style.transform ?? "";
    const scale = Number(transform.match(/scale\(([\d.]+)\)/)?.[1]);

    // The whole date scene is 964px tall with its fit padding. A desktop
    // stage of 844px therefore needs a fit below 1, rather than leaving the
    // evening lane behind the floating capture bar at 100%.
    expect(scale).toBeLessThan(0.9);
    expect(tracked.saves).toHaveLength(0);
  });

  it("refreshes relative dates after midnight without moving the current page", async () => {
    let currentNow = NOW;
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => currentNow} />);

    expect(await screen.findByRole("region", { name: "今天的画布" })).toBeInTheDocument();

    currentNow = new Date("2026-08-26T00:01:00+08:00");
    fireEvent.focus(window);

    expect(await screen.findByRole("region", { name: "昨天的画布" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到今天" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开卡片：把卡片放在时间围栏外" })).toBeInTheDocument();
    expect(tracked.current().placements[0].pageKey).toBe("2026-08-25");
    expect(tracked.saves).toHaveLength(0);
  });

  it("refreshes relative dates at midnight while the app stays open", async () => {
    vi.useFakeTimers();
    let unmount: () => void = () => undefined;
    try {
      let currentNow = new Date("2026-08-25T23:59:59.900+08:00");
      const rendered = render(<App repository={trackedRepository().repository} now={() => currentNow} />);
      unmount = rendered.unmount;
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole("region", { name: "今天的画布" })).toBeInTheDocument();

      currentNow = new Date("2026-08-26T00:00:00.100+08:00");
      act(() => vi.advanceTimersByTime(200));

      expect(screen.getByRole("region", { name: "昨天的画布" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "回到今天" })).toBeInTheDocument();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("uses the date title as the only date picker trigger", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const dateControl = await screen.findByRole("button", { name: "选择日期页面" });
    expect(screen.queryByRole("button", { name: "打开日期选择器" })).not.toBeInTheDocument();
    await user.click(dateControl);

    expect(screen.getByRole("dialog", { name: "选择日期页面" })).toBeInTheDocument();
  });

  it("closes the canvas page picker when switching to overview", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "选择日期页面" }));
    expect(screen.getByRole("dialog", { name: "选择日期页面" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "总览" }));
    expect(screen.queryByRole("dialog", { name: "选择日期页面" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "画布" }));
    expect(screen.queryByRole("dialog", { name: "选择日期页面" })).not.toBeInTheDocument();
  });

  it("names the fit control after the user's outcome", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    expect(await screen.findByRole("button", { name: "看全本页" })).toBeInTheDocument();
  });

  it("exposes the canvas and its compact controls as named interaction regions", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    expect(await screen.findByRole("region", { name: "画布操作区" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "日期页面导航" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "画布导航" })).toBeInTheDocument();
  });

  it("gives persistent icon controls matching desktop hover hints", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    expect(screen.getByRole("button", { name: "前一天" })).toHaveAttribute("title", "前一天");
    expect(screen.getByRole("button", { name: "后一天" })).toHaveAttribute("title", "后一天");
    expect(screen.getByRole("button", { name: "缩小画布" })).toHaveAttribute("title", "缩小画布");
    expect(screen.getByRole("button", { name: "放大画布" })).toHaveAttribute("title", "放大画布");
  });

  it("gives completion circles one consistent desktop hover hint", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    expect(await screen.findByRole("button", { name: "完成卡片：把卡片放在时间围栏外" }))
      .toHaveAttribute("title", "完成");
    await user.click(screen.getByRole("button", { name: "总览" }));
    expect(screen.getByRole("button", { name: "完成总览卡片：把卡片放在时间围栏外" }))
      .toHaveAttribute("title", "完成");
  });

  it("keeps the theme hover hint synchronized with the next action", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const darkMode = await screen.findByRole("button", { name: "切换到深色模式" });
    expect(darkMode).toHaveAttribute("title", "切换到深色模式");
    await user.click(darkMode);

    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toHaveAttribute("title", "切换到浅色模式");
  });

  it("keeps controls discoverable when their labels collapse at narrow widths", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    expect(screen.getByRole("button", { name: "搜索卡片" })).toHaveAttribute("title", "搜索卡片");
    expect(screen.getByRole("button", { name: "看全本页" })).toHaveAttribute("title", "看全本页");

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    expect(screen.getByRole("button", { name: "新建区域" })).toHaveAttribute("title", "新建区域");
  });

  it("uses the page name as the loose capture placeholder", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "打开随手页" }));

    expect(input).toHaveAttribute("placeholder", "放进随手页...");
  });

  it("names the exact target date in capture outside relative days", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "选择日期页面" }));
    fireEvent.change(screen.getByLabelText("选择其他日期"), { target: { value: "2027-01-02" } });

    expect(input).toHaveAttribute("placeholder", "放进2027年1月2日...");
  });

  it("announces local save-state changes without adding another control", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    const saveState = document.querySelector(".canvas-save-state");

    expect(saveState).toHaveAttribute("aria-live", "polite");
    expect(saveState).toHaveAttribute("aria-atomic", "true");
    expect(saveState).toHaveClass("is-saved");
    expect(saveState?.querySelector("span")).toHaveTextContent("已存到本机");
  });

  it("keeps a save failure in the feedback rail instead of covering date navigation", async () => {
    const initial = createEmptyWorkspace(NOW);
    const repository: WorkspaceRepository = {
      load: async () => initial,
      save: async () => {
        throw new Error("disk unavailable");
      },
    };
    const user = userEvent.setup();
    render(<App repository={repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "写下不会丢的事{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("这次更改还没保存");
    expect(alert.parentElement).toHaveClass("canvas-feedback-rail");
    expect(screen.getByRole("button", { name: "选择日期页面" })).toBeInTheDocument();
  });

  it("returns to capture after local content is reopened successfully", async () => {
    let attempts = 0;
    const repository: WorkspaceRepository = {
      load: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporarily unreadable");
        return createEmptyWorkspace(NOW);
      },
      save: async () => undefined,
    };
    const user = userEvent.setup();
    render(<App repository={repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "重新打开本地内容" }));

    await screen.findByRole("region", { name: "今天的画布" });
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "快速记录卡片" }),
    ));
  });

  it("keeps the overview truthful while local content is still loading", async () => {
    let resolveLoad: ((workspace: Workspace) => void) | null = null;
    const repository: WorkspaceRepository = {
      load: () => new Promise<Workspace>((resolve) => { resolveLoad = resolve; }),
      save: async () => undefined,
    };
    const user = userEvent.setup();
    render(<App repository={repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "总览" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在打开本地内容");
    expect(screen.queryByText("没有未完成的卡片")).not.toBeInTheDocument();

    await act(async () => {
      resolveLoad?.(createEmptyWorkspace(NOW));
    });
    expect(await screen.findByText("没有未完成的卡片")).toBeInTheDocument();
  });

  it("keeps a local-content retry visible when overview opens after a load failure", async () => {
    const repository: WorkspaceRepository = {
      load: async () => { throw new Error("disk unavailable"); },
      save: async () => undefined,
    };
    const user = userEvent.setup();
    render(<App repository={repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    expect(screen.getByRole("alert")).toHaveTextContent("没能打开本地内容");
    expect(screen.getByRole("button", { name: "重新打开" })).toBeInTheDocument();
  });

  it("returns to the retry action when local content still cannot be opened", async () => {
    const repository: WorkspaceRepository = {
      load: async () => {
        throw new Error("still unreadable");
      },
      save: async () => undefined,
    };
    const user = userEvent.setup();
    render(<App repository={repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "重新打开本地内容" }));

    const retry = await screen.findByRole("button", { name: "重新打开本地内容" });
    await waitFor(() => expect(document.activeElement).toBe(retry));
  });

  it("returns focus to capture after retrying a failed save", async () => {
    const initial = createEmptyWorkspace(NOW);
    let attempts = 0;
    const repository: WorkspaceRepository = {
      load: async () => initial,
      save: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk unavailable");
      },
    };
    const user = userEvent.setup();
    render(<App repository={repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(input, "写下不会丢的事{Enter}");

    await user.click(await screen.findByRole("button", { name: "重试" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(input);
  });

  it("uses a direct notes placeholder", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));

    expect(screen.getByPlaceholderText("补充备注...")).toBeInTheDocument();
  });

  it("does not cancel a mouse click before a card drag is intentional", async () => {
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    const card = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.entries({ pointerId: 901, pointerType: "mouse", button: 0, clientX: 400, clientY: 400 })
      .forEach(([key, value]) => Object.defineProperty(pointerDown, key, { value, configurable: true }));

    card.dispatchEvent(pointerDown);

    expect(pointerDown.defaultPrevented).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 901, pointerType: "mouse", button: 0, clientX: 400, clientY: 400 });
  });

  it("keeps date page card metadata local to the page", async () => {
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    const card = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    expect(card).toHaveTextContent("上午");
    expect(card).not.toHaveTextContent("今天");
  });

  it("uses direct labels instead of explaining empty canvas surfaces", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    expect(screen.getByRole("group", { name: "上午" })).toBeInTheDocument();
    expect(screen.queryByText("慢慢醒来")).not.toBeInTheDocument();
    expect(screen.queryByText("顺着状态往前")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    expect(screen.queryByText("先放在这里，不急着想明白。")).not.toBeInTheDocument();
    expect(screen.queryByText("没有日期、没有顺序。之后想挪到哪一天，再挪。")).not.toBeInTheDocument();
  });

  it("keeps quick syntax descriptions factual", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "稍后整理 !");

    expect(screen.getByRole("option", { name: "!高 高优先级" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "!中 中优先级" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "!低 低优先级" })).toBeInTheDocument();
    expect(screen.queryByText("可以轻轻放在后面")).not.toBeInTheDocument();
  });

  it("uses one middle-priority label from capture through card details", async () => {
    const user = userEvent.setup();
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    fireEvent.change(input, { target: { value: "处理发票 !中" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(tracked.current().cards[0]?.priority).toBe("normal"));

    const card = screen.getByRole("button", { name: "打开卡片：处理发票" });
    expect(card).toHaveTextContent("中");
    expect(card).not.toHaveTextContent("普通");
    await user.click(card);
    expect(screen.getByRole("combobox", { name: "优先级" })).toHaveDisplayValue("中");
  });

  it("submits a complete quick token with one Enter while its suggestion is open", async () => {
    const user = userEvent.setup();
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "处理发票 !中{Enter}");

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0]).toMatchObject({ title: "处理发票", priority: "normal" });
    expect(input).toHaveValue("");
  });

  it("accepts quick tokens directly after a Chinese title without a separating space", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "买牛奶#");
    await user.click(screen.getByRole("option", { name: /^#今天 放到今天这一页$/ }));
    expect(input).toHaveValue("买牛奶");
    expect(screen.getByRole("button", { name: "移除日期：今天" })).toBeInTheDocument();

    await user.type(input, "！");
    await user.click(screen.getByRole("option", { name: /^!高 高优先级$/ }));
    expect(input).toHaveValue("买牛奶");
    expect(screen.getByRole("button", { name: "移除优先级：高" })).toBeInTheDocument();
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0]).toMatchObject({
      title: "买牛奶",
      priority: "high",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    });
  });

  it("submits a complete quick token attached directly to a Chinese title", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    fireEvent.change(input, { target: { value: "买牛奶#今天" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0]).toMatchObject({
      title: "买牛奶",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    });
  });

  it("renders a complete quick token as a removable chip while typing", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "买牛奶#今天");

    expect(input).toHaveValue("买牛奶");
    expect(screen.getByRole("button", { name: "移除日期：今天" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
  });

  it("turns pages without persisting empty date objects", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });

    await user.click(screen.getByRole("button", { name: "后一天" }));

    expect(screen.getByRole("region", { name: "明天的画布" })).toBeInTheDocument();
    expect(tracked.saves).toHaveLength(0);
  });

  it("keeps card detail when the current date is selected again", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const title = screen.getByRole("textbox", { name: "卡片标题" });
    fireEvent.change(title, { target: { value: "仍在今天编辑" } });
    await user.click(screen.getByRole("button", { name: "选择日期页面" }));
    const picker = screen.getByRole("dialog", { name: "选择日期页面" });
    await user.click(within(picker).getByRole("button", { name: /今天.*8月25日/ }));

    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "卡片标题" })).toHaveValue("仍在今天编辑");
    expect(screen.queryByRole("dialog", { name: "选择日期页面" })).not.toBeInTheDocument();
  });

  it("keeps area detail when the loose page is selected again", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const loosePage = await screen.findByRole("button", { name: "打开随手页" });
    await user.click(loosePage);
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    fireEvent.change(screen.getByRole("textbox", { name: "区域名称" }), {
      target: { value: "还在这张随手页" },
    });
    await user.click(loosePage);

    expect(screen.getByRole("complementary", { name: "区域详情" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "区域名称" })).toHaveValue("还在这张随手页");
  });

  it("creates a new area inside the loose page viewport that is actually visible", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    const stage = screen.getByLabelText("画布操作区");
    fireEvent.pointerDown(stage, { pointerId: 301, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 301, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 301, clientX: 100, clientY: 100 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 300, viewportY: 200 }));

    await user.click(screen.getByRole("button", { name: "回到今天" }));
    fireEvent.pointerDown(stage, { pointerId: 302, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 302, clientX: -200, clientY: -200 });
    fireEvent.pointerUp(window, { pointerId: 302, clientX: -200, clientY: -200 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 600, viewportY: 500 }));

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    expect(document.querySelector<HTMLElement>(".canvas-world")?.style.transform)
      .toBe("translate(-300px, -200px) scale(1)");
    await user.click(screen.getByRole("button", { name: "新建区域" }));

    expect(tracked.current().areas[0]).toMatchObject({ x: 396, y: 286 });
  });

  it("reuses a free area offset instead of exactly covering an existing area", async () => {
    const timestamp = NOW.toISOString();
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-area",
      area: {
        id: "existing-offset-area",
        canvasId: "main-canvas",
        pageKey: "loose",
        title: "已经存在的区域",
        x: 138,
        y: 124,
        width: 520,
        height: 320,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));

    expect(tracked.current().areas).toHaveLength(2);
    expect(tracked.current().areas.at(-1)).toMatchObject({ x: 96, y: 86 });
  });

  it("keeps the new-area screen inset stable when the loose page is zoomed", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "放大画布" }));
    await waitFor(() => expect(tracked.current().canvas.zoom).toBe(1.1));
    await user.click(screen.getByRole("button", { name: "新建区域" }));

    const area = tracked.current().areas[0];
    expect((area.x - tracked.current().canvas.viewportX) * tracked.current().canvas.zoom).toBeCloseTo(96);
    expect((area.y - tracked.current().canvas.viewportY) * tracked.current().canvas.zoom).toBeCloseTo(86);
  });

  it("creates a loose card inside the loose page viewport that is actually visible", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    const stage = screen.getByLabelText("画布操作区");
    fireEvent.pointerDown(stage, { pointerId: 303, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 303, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 303, clientX: 100, clientY: 100 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 300, viewportY: 200 }));

    await user.click(screen.getByRole("button", { name: "回到今天" }));
    fireEvent.pointerDown(stage, { pointerId: 304, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 304, clientX: -200, clientY: -200 });
    fireEvent.pointerUp(window, { pointerId: 304, clientX: -200, clientY: -200 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 600, viewportY: 500 }));

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "眼前的新卡片{Enter}");

    expect(tracked.current().placements[0]).toMatchObject({ pageKey: "loose", x: 426, y: 318 });
  });

  it("keeps the new loose-card screen inset stable when the page is zoomed", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "放大画布" }));
    await waitFor(() => expect(tracked.current().canvas.zoom).toBe(1.1));
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "缩放后的卡片{Enter}");

    const placement = tracked.current().placements[0];
    expect((placement.x - tracked.current().canvas.viewportX) * tracked.current().canvas.zoom).toBeCloseTo(126);
    expect((placement.y - tracked.current().canvas.viewportY) * tracked.current().canvas.zoom).toBeCloseTo(118);
  });

  it("keeps the visible center still when zooming with the canvas controls", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const stage = await screen.findByLabelText("画布操作区");
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    await user.click(screen.getByRole("button", { name: "放大画布" }));

    await waitFor(() => expect(tracked.current().canvas.zoom).toBe(1.1));
    expect(tracked.current().canvas.viewportX).toBeCloseTo(36.3636, 3);
    expect(tracked.current().canvas.viewportY).toBeCloseTo(27.2727, 3);
  });

  it("keeps the pointed canvas position still during modified-wheel zoom", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const stage = await screen.findByLabelText("画布操作区");
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
    });
    fireEvent.wheel(stage, { ctrlKey: true, deltaY: -100, clientX: 200, clientY: 150 });

    expect(document.querySelector<HTMLElement>(".canvas-world")?.style.transform)
      .toBe("translate(-20px, -15px) scale(1.1)");
  });

  it("keeps a newly captured loose card in view after the visible slots fill up", async () => {
    let workspace = createEmptyWorkspace(NOW);
    for (let index = 0; index < 8; index += 1) {
      const card = createCard({ title: `已有念头 ${index + 1}` }, { id: `loose-${index + 1}`, now: NOW });
      workspace = workspaceReducer(workspace, {
        type: "add-card",
        card,
        pageKey: "loose",
        position: { x: 126 + (index % 2) * 276, y: 118 + Math.floor(index / 2) * 168 },
      });
    }
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    const stage = screen.getByLabelText("画布操作区");
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "仍然落在眼前{Enter}");

    expect(tracked.current().placements.at(-1)).toMatchObject({ x: 126, y: 118 });
  });

  it("keeps an empty loose page still when there is nothing to fit", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    const stage = screen.getByLabelText("画布操作区");
    fireEvent.pointerDown(stage, { pointerId: 306, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 306, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 306, clientX: 100, clientY: 100 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 300, viewportY: 200 }));

    await user.click(screen.getByRole("button", { name: "回到今天" }));
    fireEvent.pointerDown(stage, { pointerId: 307, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 307, clientX: -200, clientY: -200 });
    fireEvent.pointerUp(window, { pointerId: 307, clientX: -200, clientY: -200 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 600, viewportY: 500 }));

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    const savesBeforeFit = tracked.saves.length;
    expect(document.querySelector<HTMLElement>(".canvas-world")?.style.transform)
      .toBe("translate(-300px, -200px) scale(1)");
    await user.click(screen.getByRole("button", { name: "看全本页" }));

    expect(document.querySelector<HTMLElement>(".canvas-world")?.style.transform)
      .toBe("translate(-300px, -200px) scale(1)");
    expect(tracked.saves).toHaveLength(savesBeforeFit);
  });

  it("does not resave a date page that is already fully in view", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const fit = await screen.findByRole("button", { name: "看全本页" });
    await user.click(fit);
    await waitFor(() => expect(tracked.saves).toHaveLength(1));
    const savesAfterFirstFit = tracked.saves.length;

    await user.click(fit);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tracked.saves).toHaveLength(savesAfterFirstFit);
  });

  it("disables look-whole-page when the loose page has nothing to fit", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));

    expect(screen.getByRole("button", { name: "看全本页" })).toBeDisabled();
  });

  it("commits and closes the old card detail when manually browsing another page", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "翻页前写完的标题" } });
    await user.click(screen.getByRole("button", { name: "后一天" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("翻页前写完的标题"));
    expect(screen.getByRole("region", { name: "明天的画布" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("commits and ends inline title editing when manually browsing another page", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    fireEvent.doubleClick(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" }), {
      target: { value: "翻页前在卡片上改好的标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "后一天" }));
    fireEvent.click(screen.getByRole("button", { name: "前一天" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("翻页前在卡片上改好的标题"));
    expect(screen.getByRole("button", { name: "打开卡片：翻页前在卡片上改好的标题" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /就地编辑卡片/ })).not.toBeInTheDocument();
  });

  it("commits and closes card detail when switching to overview", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "切换视图前写完的标题" } });
    await user.click(screen.getByRole("button", { name: "总览" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("切换视图前写完的标题"));
    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("commits and closes area detail when switching to overview", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    fireEvent.change(screen.getByLabelText("区域名称"), { target: { value: "还没整理的工作" } });
    await user.click(screen.getByRole("button", { name: "总览" }));

    await waitFor(() => expect(tracked.current().areas[0].title).toBe("还没整理的工作"));
    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("commits and ends inline title editing when switching views", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    const cardTitle = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    fireEvent.doubleClick(cardTitle);
    fireEvent.change(screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" }), {
      target: { value: "在卡片上直接改好的标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "总览" }));
    fireEvent.click(screen.getByRole("button", { name: "画布" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("在卡片上直接改好的标题"));
    expect(screen.getByRole("button", { name: "打开卡片：在卡片上直接改好的标题" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /就地编辑卡片/ })).not.toBeInTheDocument();
  });

  it("commits and closes area detail when leaving the loose page", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    fireEvent.change(screen.getByLabelText("区域名称"), { target: { value: "以后再整理" } });
    await user.click(screen.getByRole("button", { name: "回到今天" }));

    await waitFor(() => expect(tracked.current().areas[0].title).toBe("以后再整理"));
    expect(screen.getByRole("region", { name: "今天的画布" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("commits card detail before selecting an area", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "以后再整理{Enter}");
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(screen.getByRole("button", { name: "关闭区域详情" }));
    await user.click(screen.getByRole("button", { name: "打开卡片：以后再整理" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "已经写好的新标题" } });

    fireEvent.click(screen.getByRole("region", { name: "区域：新区域" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("已经写好的新标题"));
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "区域详情" })).toBeInTheDocument();
  });

  it("commits and closes card detail when the blank canvas is clicked", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "点回画布前写好的标题" } });
    await user.click(screen.getByRole("region", { name: "画布操作区" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("点回画布前写好的标题"));
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "打开卡片：点回画布前写好的标题" })).toHaveFocus());
  });

  it("commits and closes card detail when blank canvas is tapped", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "触屏点回画布前写好的标题" } });
    const stage = screen.getByRole("region", { name: "画布操作区" });
    const pointer = (type: string, target: EventTarget) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 411, button: 0, pointerType: "touch", clientX: 100, clientY: 100 })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", stage);
      pointer("pointerup", window);
    });

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("触屏点回画布前写好的标题"));
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "打开卡片：触屏点回画布前写好的标题" })).toHaveFocus());
  });

  it("returns focus to a card after blank canvas commits inline editing", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const open = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    await user.dblClick(open);
    fireEvent.change(screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" }), {
      target: { value: "点空白保存的就地标题" },
    });
    await user.click(screen.getByRole("region", { name: "画布操作区" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("点空白保存的就地标题"));
    await waitFor(() => expect(screen.getByRole("button", { name: "打开卡片：点空白保存的就地标题" })).toHaveFocus());
  });

  it("commits and closes area detail when the blank canvas is clicked", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    fireEvent.change(screen.getByRole("textbox", { name: "区域名称" }), { target: { value: "点击空白前命名" } });
    await user.click(screen.getByRole("region", { name: "画布操作区" }));

    await waitFor(() => expect(tracked.current().areas[0].title).toBe("点击空白前命名"));
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "移动区域：点击空白前命名" })).toHaveFocus());
  });

  it("commits and closes area detail when blank canvas is tapped", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    fireEvent.change(screen.getByRole("textbox", { name: "区域名称" }), { target: { value: "触屏点空白前命名" } });
    const stage = screen.getByRole("region", { name: "画布操作区" });
    const pointer = (type: string, target: EventTarget) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 412, button: 0, pointerType: "touch", clientX: 100, clientY: 100 })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", stage);
      pointer("pointerup", window);
    });

    await waitFor(() => expect(tracked.current().areas[0].title).toBe("触屏点空白前命名"));
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "移动区域：触屏点空白前命名" })).toHaveFocus());
  });

  it("captures plain text into the current date page and into loose when requested", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "给客户回电话{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0].timeConstraint).toEqual({ date: "2026-08-25", period: "anytime" });
    expect(tracked.current().placements[0].pageKey).toBe("2026-08-25");

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.type(input, "也许周末学陶艺{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(2));
    expect(tracked.current().cards[1].timeConstraint).toBeNull();
    expect(tracked.current().placements[1].pageKey).toBe("loose");
  });

  it("preserves a same-batch card completion when capturing another card", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    const complete = screen.getByRole("button", { name: "完成卡片：把卡片放在时间围栏外" });
    const form = capture.closest("form");
    expect(form).not.toBeNull();
    fireEvent.change(capture, { target: { value: "同时记下另一件事" } });

    await act(async () => {
      fireEvent.click(complete);
      fireEvent.submit(form!);
    });

    await waitFor(() => expect(tracked.current().cards).toHaveLength(2));
    expect(tracked.current().cards.find((card) => card.id === "today-card")?.status).toBe("completed");
    expect(tracked.current().cards.find((card) => card.title === "同时记下另一件事")?.status).toBe("open");
  });

  it("keeps a newly captured date card inside the visible part of a panned page", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });

    fireEvent.wheel(stage, { deltaX: 420, deltaY: 0 });
    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(420));
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "留在眼前的新卡片{Enter}");

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    const placement = tracked.current().placements[0];
    const viewport = tracked.current().canvas;
    const screenLeft = (placement.x - viewport.viewportX) * viewport.zoom;
    expect(screenLeft).toBeGreaterThanOrEqual(96);
    expect(screenLeft + 248).toBeLessThanOrEqual(760 - 36);
    expect(tracked.current().cards[0].timeConstraint).toEqual({ date: "2026-08-25", period: "anytime" });
  });

  it("reveals a newly captured date card when its time region is outside the current view", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });

    fireEvent.wheel(stage, { deltaX: 0, deltaY: 600 });
    await waitFor(() => expect(tracked.current().canvas.viewportY).toBe(600));
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "从视野外回到眼前{Enter}");

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    const placement = tracked.current().placements[0];
    const viewport = tracked.current().canvas;
    const screenTop = (placement.y - viewport.viewportY) * viewport.zoom;
    expect(screenTop).toBeGreaterThanOrEqual(88);
    expect(screenTop + 112).toBeLessThanOrEqual(560 - 112);

    await user.click(screen.getByRole("button", { name: "撤销上一步" }));
    await waitFor(() => expect(tracked.current().cards).toHaveLength(0));
    expect(tracked.current().canvas.viewportY).toBe(600);
  });

  it("reuses an open date-page slot before stacking a new card", async () => {
    const completed = createCard({
      title: "已经完成的上午事项",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    }, { id: "completed-date-slot", now: NOW });
    const remaining = createCard({
      title: "仍在第一排的事项",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    }, { id: "remaining-date-slot", now: NOW });
    let workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card: completed,
      pageKey: "2026-08-25",
      position: { x: 120, y: 170 },
    });
    workspace = workspaceReducer(workspace, {
      type: "add-card",
      card: remaining,
      pageKey: "2026-08-25",
      position: { x: 406, y: 185 },
    });
    workspace = workspaceReducer(workspace, { type: "toggle-card", cardId: completed.id, now: NOW });
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.type(await screen.findByRole("textbox", { name: "快速记录卡片" }), "占用空出来的位置{Enter}");

    await waitFor(() => expect(tracked.current().cards).toHaveLength(3));
    expect(tracked.current().placements.at(-1)).toMatchObject({ x: 120, y: 170 });
  });

  it("reuses an open loose-page slot before stacking a new card", async () => {
    const completed = createCard({ title: "已经完成的随手事项" }, { id: "completed-loose-slot", now: NOW });
    const remaining = createCard({ title: "仍在眼前的随手事项" }, { id: "remaining-loose-slot", now: NOW });
    let workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card: completed,
      pageKey: "loose",
      position: { x: 126, y: 118 },
    });
    workspace = workspaceReducer(workspace, {
      type: "add-card",
      card: remaining,
      pageKey: "loose",
      position: { x: 402, y: 118 },
    });
    workspace = workspaceReducer(workspace, { type: "toggle-card", cardId: completed.id, now: NOW });
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    const stage = screen.getByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "占用随手页空槽{Enter}");

    await waitFor(() => expect(tracked.current().cards).toHaveLength(3));
    expect(tracked.current().placements.at(-1)).toMatchObject({ x: 126, y: 118 });
  });

  it("keeps quick syntax visible as a token and lets it override the open page", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "预定车票 #明天");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /^#明天 放到明天这一页$/ }));
    expect(screen.getByRole("button", { name: "移除日期：明天" })).toBeInTheDocument();
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().placements[0].pageKey).toBe("2026-08-26");
    expect(screen.getByRole("region", { name: "今天的画布" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已放到明天");
  });

  it("keeps a card captured into another date visible in that page's saved view", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });

    await user.click(screen.getByRole("button", { name: "后一天" }));
    fireEvent.wheel(stage, { deltaX: 0, deltaY: 600 });
    await waitFor(() => expect(tracked.current().canvas.viewportY).toBe(600));
    await user.click(screen.getByRole("button", { name: "前一天" }));

    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "准备晨会 #明天上午{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "后一天" }));

    const placement = tracked.current().placements[0];
    const worldTransform = document.querySelector<HTMLElement>(".canvas-world")?.style.transform ?? "";
    const match = worldTransform.match(/translate\([^,]+, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
    expect(match).not.toBeNull();
    const viewportY = -Number(match![1]) / Number(match![2]);
    const screenTop = (placement.y - viewportY) * Number(match![2]);
    expect(screenTop).toBeGreaterThanOrEqual(88);
    expect(screenTop + 112 * Number(match![2])).toBeLessThanOrEqual(560 - 112);
  });

  it("keeps a card captured from overview visible when returning to its canvas", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });

    fireEvent.wheel(stage, { deltaX: 0, deltaY: 600 });
    await waitFor(() => expect(tracked.current().canvas.viewportY).toBe(600));
    await user.click(screen.getByRole("button", { name: "总览" }));
    await user.type(screen.getByRole("textbox", { name: "快速记录卡片" }), "从总览记下的卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "画布" }));
    const placement = tracked.current().placements[0];
    const worldTransform = document.querySelector<HTMLElement>(".canvas-world")?.style.transform ?? "";
    const match = worldTransform.match(/translate\([^,]+, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
    expect(match).not.toBeNull();
    const viewportY = -Number(match![1]) / Number(match![2]);
    const screenTop = (placement.y - viewportY) * Number(match![2]);
    expect(screenTop).toBeGreaterThanOrEqual(88);
    expect(screenTop + 112 * Number(match![2])).toBeLessThanOrEqual(560 - 112);
  });

  it("keeps destination feedback and undo together without stacking them", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "预定车票 #明天{Enter}");

    const notice = await screen.findByRole("status");
    const undo = screen.getByRole("button", { name: "撤销上一步" });
    expect(notice.parentElement).toBe(undo.parentElement);
    expect(notice.parentElement).toHaveClass("canvas-feedback-rail");
  });

  it("returns focus to capture after removing a quick token", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "预定车票 #明天");
    await user.click(screen.getByRole("option", { name: /^#明天 放到明天这一页$/ }));
    await user.click(screen.getByRole("button", { name: "移除日期：明天" }));

    expect(screen.queryByRole("button", { name: "移除日期：明天" })).not.toBeInTheDocument();
    expect(input).toHaveValue("预定车票");
    expect(document.activeElement).toBe(input);
  });

  it("closes quick suggestions when the user moves to another control", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "整理资料 #");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
    const theme = screen.getByRole("button", { name: "切换到深色模式" });
    await user.click(theme);

    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(theme);
  });

  it("reopens dismissed quick suggestions when capture regains focus", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "整理资料 #");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换到深色模式" }));
    await user.click(input);

    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
  });

  it("dismisses quick suggestions without closing the card inspector", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const capture = screen.getByRole("textbox", { name: "快速记录卡片" });
    await user.click(capture);
    await user.type(capture, "补一件事 #");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
    expect(capture).toHaveValue("补一件事 #");
    expect(document.activeElement).toBe(capture);
  });

  it("defers quick syntax parsing until Chinese IME composition ends", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "整理资料 #今天 " } });

    expect(screen.queryByRole("button", { name: "移除日期：今天" })).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(tracked.current().cards).toHaveLength(0);

    fireEvent.compositionEnd(input);

    await waitFor(() => expect(screen.getByRole("button", { name: "移除日期：今天" })).toBeInTheDocument());
    expect(tracked.current().cards).toHaveLength(0);
  });

  it("leaves composition keys to the Chinese IME", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    fireEvent.compositionStart(input);
    const imeHandled = fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(imeHandled).toBe(true);
    expect(tracked.current().cards).toHaveLength(0);
  });

  it("offers tomorrow's soft periods in the quick menu", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(input, "整理行李 #明天下午");
    await user.click(screen.getByRole("option", { name: /#明天下午/ }));
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0].timeConstraint).toEqual({ date: "2026-08-26", period: "afternoon" });
    expect(tracked.current().placements[0].pageKey).toBe("2026-08-26");
  });

  it("parses a complete quick token at submit without requiring a trailing space", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const input = await screen.findByRole("textbox", { name: "快速记录卡片" });

    fireEvent.change(input, { target: { value: "买牛奶 #今天" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0].title).toBe("买牛奶");
    expect(tracked.current().cards[0].timeConstraint).toEqual({ date: "2026-08-25", period: "anytime" });
  });

  it("keeps the date picker close to the page being viewed", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "后一天" }));
    await user.click(screen.getByRole("button", { name: "后一天" }));
    await user.click(screen.getByRole("button", { name: "选择日期页面" }));

    const picker = screen.getByRole("dialog", { name: "选择日期页面" });
    expect(picker).toHaveTextContent("8月27日");
    expect(picker).toHaveTextContent("8月26日");
  });

  it("marks the date picker option for the page currently being viewed", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "后一天" }));
    await user.click(screen.getByRole("button", { name: "选择日期页面" }));

    const picker = screen.getByRole("dialog", { name: "选择日期页面" });
    const options = picker.querySelectorAll<HTMLButtonElement>(":scope > div > button");
    expect(options).toHaveLength(5);
    expect(options[2]).toHaveAttribute("aria-current", "date");
    expect(options[2]).toHaveTextContent("明天");
  });

  it("does not mark a date page as current while viewing the loose page", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "选择日期页面" }));

    const picker = screen.getByRole("dialog", { name: "选择日期页面" });
    expect(picker.querySelector('[aria-current="date"]')).not.toBeInTheDocument();
  });

  it("shows the year when the canvas turns to another calendar year", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "选择日期页面" }));
    fireEvent.change(screen.getByLabelText("选择其他日期"), { target: { value: "2027-01-02" } });

    const dateButton = screen.getByRole("button", { name: "选择日期页面" });
    expect(dateButton).toHaveTextContent("2027年1月2日");
    expect(dateButton).not.toHaveTextContent(/周六.*周六/);
    expect(screen.getByRole("region", { name: "2027年1月2日的画布" })).toBeInTheDocument();
  });

  it("closes search from outside and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const searchButton = screen.getByRole("button", { name: "搜索卡片" });
    await user.click(searchButton);
    expect(screen.getByRole("dialog", { name: "搜索卡片" })).toBeInTheDocument();

    fireEvent.pointerDown(document.body, { pointerId: 90, button: 0 });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "搜索卡片" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(searchButton);
  });

  it("keeps focus on an outside action that closes search", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "搜索卡片" }));
    const theme = screen.getByRole("button", { name: "切换到深色模式" });
    await user.click(theme);

    expect(screen.queryByRole("dialog", { name: "搜索卡片" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "切换到浅色模式" }));
  });

  it("keeps focus on an outside action that closes the date picker", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "选择日期页面" }));
    const theme = screen.getByRole("button", { name: "切换到深色模式" });
    await user.click(theme);

    expect(screen.queryByRole("dialog", { name: "选择日期页面" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "切换到浅色模式" }));
  });

  it("keeps focus on the loose-page control when it closes the date picker", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "选择日期页面" }));
    const loosePage = screen.getByRole("button", { name: "打开随手页" });
    await user.click(loosePage);

    await waitFor(() => expect(document.activeElement).toBe(loosePage));
  });

  it("keeps focus on the next-day control when it closes the date picker", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "选择日期页面" }));
    const nextDay = screen.getByRole("button", { name: "后一天" });
    await user.click(nextDay);

    await waitFor(() => expect(document.activeElement).toBe(nextDay));
  });

  it("shows the shortcut that matches the current desktop platform", async () => {
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
    try {
      render(<App repository={trackedRepository().repository} now={() => NOW} />);

      expect(await screen.findByRole("button", { name: "搜索卡片" })).toHaveTextContent("Ctrl K");
    } finally {
      platform.mockRestore();
    }
  });

  it("returns command search to the control that had focus", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    capture.focus();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "搜索卡片" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(capture));
  });

  it("keeps an existing search query when its shortcut is pressed again", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "搜索卡片" }));
    const searchbox = screen.getByRole("searchbox", { name: "搜索卡片" });
    await user.type(searchbox, "时间围栏");
    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getAllByRole("dialog", { name: "搜索卡片" })).toHaveLength(1);
    expect(searchbox).toHaveValue("时间围栏");
    expect(document.activeElement).toBe(searchbox);
  });

  it("hands quick suggestions to search and restores them on return", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(capture, "整理资料 #");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(capture, { key: "k", ctrlKey: true });
    });

    expect(screen.getByRole("dialog", { name: "搜索卡片" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索卡片" }), { key: "Escape" });
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(capture);
    expect(capture).toHaveValue("整理资料 #");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
  });

  it("keeps keyboard navigation inside the search dialog", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    await user.click(screen.getByRole("button", { name: "搜索卡片" }));
    const searchbox = screen.getByRole("searchbox", { name: "搜索卡片" });
    const close = screen.getByRole("button", { name: "关闭搜索" });
    expect(document.activeElement).toBe(searchbox);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(searchbox);
  });

  it("does not let workspace undo pass through the search dialog", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(capture, "保留搜索背后的卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "搜索卡片" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭搜索" }));
    await user.keyboard("{Control>}z{/Control}");

    expect(screen.getByRole("dialog", { name: "搜索卡片" })).toBeInTheDocument();
    expect(tracked.current().cards[0].title).toBe("保留搜索背后的卡片");
  });

  it("scrolls the active search result into view during keyboard browsing", async () => {
    render(<App repository={trackedRepository(workspaceWithSearchCards()).repository} now={() => NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "搜索卡片" }));
    const searchbox = screen.getByRole("searchbox", { name: "搜索卡片" });
    fireEvent.change(searchbox, { target: { value: "搜索卡片" } });
    const results = await screen.findAllByRole("option");
    const scrollIntoView = vi.fn();
    Object.defineProperty(results[1], "scrollIntoView", { value: scrollIntoView });

    fireEvent.keyDown(searchbox, { key: "ArrowDown" });

    await waitFor(() => expect(results[1]).toHaveAttribute("aria-selected", "true"));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("connects keyboard search focus to the visibly active result", async () => {
    render(<App repository={trackedRepository(workspaceWithSearchCards(2)).repository} now={() => NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "搜索卡片" }));
    const searchbox = screen.getByRole("searchbox", { name: "搜索卡片" });
    fireEvent.change(searchbox, { target: { value: "搜索卡片" } });

    const results = await screen.findAllByRole("option");
    expect(searchbox).toHaveAttribute("aria-controls", "canvas-search-results");
    expect(searchbox).toHaveAttribute("aria-activedescendant", results[0].id);

    fireEvent.keyDown(searchbox, { key: "ArrowDown" });

    expect(searchbox).toHaveAttribute("aria-activedescendant", results[1].id);
  });

  it("shows completion status for dated cards in search results", async () => {
    const completed = workspaceReducer(workspaceWithTodayCard(), {
      type: "toggle-card",
      cardId: "today-card",
      now: NOW,
    });
    const user = userEvent.setup();
    render(<App repository={trackedRepository(completed).repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "搜索卡片" }));
    const searchbox = screen.getByRole("searchbox", { name: "搜索卡片" });
    await user.type(searchbox, "把卡片放在时间围栏外");

    expect(screen.getByRole("option", { name: /把卡片放在时间围栏外/ })).toHaveTextContent("已完成");
  });

  it("closes old card detail when a completed search result opens in overview", async () => {
    const completedCard = createCard({
      title: "已经完成的旧事项",
      timeConstraint: { date: "2026-08-24", period: "afternoon" },
    }, { id: "completed-card", now: NOW });
    const withCompletedCard = workspaceReducer(workspaceWithTodayCard(), {
      type: "add-card",
      card: completedCard,
      pageKey: "2026-08-24",
      position: { x: 240, y: 460 },
    });
    const tracked = trackedRepository(workspaceReducer(withCompletedCard, {
      type: "toggle-card",
      cardId: completedCard.id,
      now: NOW,
    }));
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "搜索卡片" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索卡片" }), "已经完成");
    await user.click(screen.getByRole("option", { name: /已经完成的旧事项/ }));

    expect(screen.getByRole("button", { name: "已完成 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("listitem", { name: "已完成卡片：已经完成的旧事项" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("returns focus to the date control after closing the date picker", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const dateControl = await screen.findByRole("button", { name: "选择日期页面" });

    await user.click(dateControl);
    await user.click(screen.getByRole("button", { name: "关闭日期选择器" }));

    await waitFor(() => expect(document.activeElement).toBe(dateControl));
  });

  it("does not let workspace undo pass through the date picker", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(capture, "保留日期选择器背后的卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "选择日期页面" }));
    await waitFor(() => expect(document.activeElement).toHaveTextContent("今天"));
    await user.keyboard("{Control>}z{/Control}");

    expect(screen.getByRole("dialog", { name: "选择日期页面" })).toBeInTheDocument();
    expect(tracked.current().cards[0].title).toBe("保留日期选择器背后的卡片");
  });

  it("offers low-frequency local backup actions without adding them to the main flow", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const backupTrigger = screen.getByRole("button", { name: "打开本地备份菜单" });
    expect(backupTrigger).toHaveAttribute("aria-haspopup", "menu");
    expect(backupTrigger).toHaveAttribute("title", "本地备份");
    expect(backupTrigger.querySelector("path")?.getAttribute("d"))
      .toContain("M224,64H32");
    expect(screen.getByRole("button", { name: "搜索卡片" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("button", { name: "选择日期页面" })).toHaveAttribute("aria-haspopup", "dialog");

    await user.click(backupTrigger);
    expect(screen.getByRole("menuitem", { name: "导出本地备份" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "导入本地备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "画布" })).toBeInTheDocument();
  });

  it("reports whether command search is expanded", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    const trigger = screen.getByRole("button", { name: "搜索卡片" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("names the backup trigger after its next action", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    const trigger = screen.getByRole("button", { name: "打开本地备份菜单" });

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-label", "关闭本地备份菜单");
  });

  it("supports keyboard navigation in the backup menu and restores its trigger", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const trigger = screen.getByRole("button", { name: "打开本地备份菜单" });

    await user.click(trigger);
    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "本地备份" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not let workspace undo pass through the backup menu", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(capture, "保留备份菜单背后的卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "打开本地备份菜单" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "导出本地备份" })));
    await user.keyboard("{Control>}z{/Control}");

    expect(screen.getByRole("menu", { name: "本地备份" })).toBeInTheDocument();
    expect(tracked.current().cards[0].title).toBe("保留备份菜单背后的卡片");
  });

  it("closes the backup menu before opening the file picker", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开本地备份菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));

    expect(screen.queryByRole("menu", { name: "本地备份" })).not.toBeInTheDocument();
  });

  it("returns focus to the backup trigger when file selection is cancelled", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const trigger = screen.getByRole("button", { name: "打开本地备份菜单" });
    const input = screen.getByLabelText("选择本地备份文件");

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));
    fireEvent(input, new Event("cancel", { bubbles: true }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("returns focus to the backup trigger after exporting", async () => {
    const createObjectURL = vi.fn(() => "blob:citroam-backup");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const user = userEvent.setup();

    try {
      render(<App repository={trackedRepository().repository} now={() => NOW} />);
      const trigger = screen.getByRole("button", { name: "打开本地备份菜单" });

      await user.click(trigger);
      await user.click(screen.getByRole("menuitem", { name: "导出本地备份" }));

      expect(screen.queryByRole("menu", { name: "本地备份" })).not.toBeInTheDocument();
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(screen.getByRole("status")).toHaveTextContent("备份已经导出");
    } finally {
      anchorClick.mockRestore();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  it("returns focus to the backup trigger after an invalid import", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const trigger = screen.getByRole("button", { name: "打开本地备份菜单" });
    const invalid = new File(["not-json"], "broken.json", { type: "application/json" });
    Object.defineProperty(invalid, "text", { value: async () => "not-json" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));
    fireEvent.change(screen.getByLabelText("选择本地备份文件"), {
      target: { files: [invalid] },
    });

    expect(await screen.findByRole("status")).toHaveTextContent("备份无法读取，当前内容没有改变");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("imports a validated local backup without corrupting the current workspace", async () => {
    const user = userEvent.setup();
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const imported = workspaceWithTodayCard();
    const backup = new File([JSON.stringify(imported)], "backup.json", { type: "application/json" });
    Object.defineProperty(backup, "text", { value: async () => JSON.stringify(imported) });
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const backupTrigger = screen.getByRole("button", { name: "打开本地备份菜单" });
    await user.click(backupTrigger);
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));
    fireEvent.change(screen.getByLabelText("选择本地备份文件"), {
      target: { files: [backup] },
    });

    const importDialog = await screen.findByRole("dialog", { name: "导入这份备份？" });
    expect(importDialog).toHaveAccessibleDescription("当前画布会被替换。导入后仍可以撤销。");
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(tracked.current().cards).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("把卡片放在时间围栏外"));
    expect(tracked.current().placements[0].pageKey).toBe("2026-08-25");
    await waitFor(() => expect(document.activeElement).toBe(backupTrigger));
  });

  it("cancels a local backup import and returns focus to the backup trigger", async () => {
    const user = userEvent.setup();
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const backup = new File([JSON.stringify(workspaceWithTodayCard())], "backup.json", { type: "application/json" });
    Object.defineProperty(backup, "text", { value: async () => JSON.stringify(workspaceWithTodayCard()) });
    const trigger = screen.getByRole("button", { name: "打开本地备份菜单" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));
    fireEvent.change(screen.getByLabelText("选择本地备份文件"), {
      target: { files: [backup] },
    });
    await screen.findByRole("dialog", { name: "导入这份备份？" });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "导入这份备份？" })).not.toBeInTheDocument();
    expect(tracked.current().cards).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not open search over a backup import confirmation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const backup = new File([JSON.stringify(workspaceWithTodayCard())], "backup.json", { type: "application/json" });
    Object.defineProperty(backup, "text", { value: async () => JSON.stringify(workspaceWithTodayCard()) });

    await user.click(screen.getByRole("button", { name: "打开本地备份菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));
    fireEvent.change(screen.getByLabelText("选择本地备份文件"), {
      target: { files: [backup] },
    });
    const importDialog = await screen.findByRole("dialog", { name: "导入这份备份？" });
    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    await user.keyboard("{Control>}k{/Control}");

    expect(importDialog).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "搜索卡片" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(cancel);
  });

  it("does not let workspace undo pass through a backup import confirmation", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(capture, "保留导入确认背后的卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    const backup = new File([JSON.stringify(workspaceWithTodayCard())], "backup.json", { type: "application/json" });
    Object.defineProperty(backup, "text", { value: async () => JSON.stringify(workspaceWithTodayCard()) });

    await user.click(screen.getByRole("button", { name: "打开本地备份菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "导入本地备份" }));
    fireEvent.change(screen.getByLabelText("选择本地备份文件"), {
      target: { files: [backup] },
    });
    await screen.findByRole("dialog", { name: "导入这份备份？" });
    await user.keyboard("{Control>}z{/Control}");

    expect(screen.getByRole("dialog", { name: "导入这份备份？" })).toBeInTheDocument();
    expect(tracked.current().cards[0].title).toBe("保留导入确认背后的卡片");
  });

  it("raises a selected card above an overlapping card without changing stored order", async () => {
    const first = createCard({ title: "底下的卡片", timeConstraint: { date: "2026-08-25", period: "anytime" } }, { id: "under", now: NOW });
    const second = createCard({ title: "上面的卡片", timeConstraint: { date: "2026-08-25", period: "anytime" } }, { id: "over", now: NOW });
    let workspace = createEmptyWorkspace(NOW);
    workspace = workspaceReducer(workspace, { type: "add-card", card: first, pageKey: "2026-08-25", position: { x: 320, y: 220 } });
    workspace = workspaceReducer(workspace, { type: "add-card", card: second, pageKey: "2026-08-25", position: { x: 320, y: 220 } });
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspace).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：上面的卡片" }));
    expect(screen.getByRole("article", { name: "卡片：上面的卡片" })).toHaveStyle({ zIndex: "100000" });
  });

  it("moves the visible viewport when locating a card after the canvas was panned", async () => {
    const farCard = createCard({
      title: "画布远处的卡片",
      timeConstraint: { date: "2026-08-25", period: "anytime" },
    }, { id: "far-card", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card: farCard,
      pageKey: "2026-08-25",
      position: { x: 2000, y: 1500 },
    });
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");

    fireEvent.pointerDown(stage, { pointerId: 90, button: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 90, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 90, clientX: 160, clientY: 100 });
    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));

    await user.click(screen.getByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "定位卡片：画布远处的卡片" }));

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(1624));
    const world = document.querySelector<HTMLElement>(".canvas-world");
    expect(world?.style.transform).toBe("translate(-1624px, -1246px) scale(1)");
  });

  it("preserves the open inspector draft before locating another card", async () => {
    const tracked = trackedRepository(workspaceWithSearchCards(2));
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：搜索卡片 1" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "已经写好的新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "定位卡片：搜索卡片 2" }));

    await waitFor(() => expect(tracked.current().cards.find((card) => card.id === "search-1")?.title)
      .toBe("已经写好的新标题"));
  });

  it("allows a touch drag on empty canvas to pan the viewport", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");

    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 91, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };
    act(() => {
      pointer("pointerdown", stage, {});
      pointer("pointermove", window, { clientX: 160, clientY: 140 });
      pointer("pointerup", window, { clientX: 160, clientY: 140 });
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(tracked.current().canvas.viewportY).toBe(-40);
  });

  it("lets space-pan start on a card without moving the card", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    const card = screen.getByRole("article", { name: "卡片：把卡片放在时间围栏外" });

    act(() => {
      fireEvent.keyDown(stage, { key: " ", code: "Space" });
      fireEvent.pointerDown(card, { pointerId: 102, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 102, clientX: 160, clientY: 140 });
      fireEvent.pointerUp(window, { pointerId: 102, clientX: 160, clientY: 140 });
      fireEvent.keyUp(stage, { key: " ", code: "Space" });
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(tracked.current().placements[0]).toMatchObject({ x: 320, y: 360 });
  });

  it("ignores sub-threshold space-pan jitter", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");

    act(() => {
      fireEvent.keyDown(stage, { key: " ", code: "Space" });
      fireEvent.pointerDown(stage, { pointerId: 309, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 309, clientX: 102, clientY: 101 });
      fireEvent.pointerUp(window, { pointerId: 309, clientX: 102, clientY: 101 });
      fireEvent.keyUp(stage, { key: " ", code: "Space" });
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(tracked.current().canvas).toMatchObject({ viewportX: 0, viewportY: 0, zoom: 1 });
    expect(tracked.saves).toHaveLength(0);
  });

  it("does not open card detail from the click synthesized after space-panning from it", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    const open = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });

    act(() => {
      fireEvent.keyDown(stage, { key: " ", code: "Space" });
      fireEvent.pointerDown(open, { pointerId: 104, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 104, clientX: 160, clientY: 140 });
      fireEvent.pointerUp(window, { pointerId: 104, clientX: 160, clientY: 140 });
      fireEvent.click(open);
      fireEvent.keyUp(stage, { key: " ", code: "Space" });
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("does not open card detail after a drag returns to its starting point", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);
    const article = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    const open = screen.getByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    article.setPointerCapture = vi.fn();
    article.hasPointerCapture = vi.fn(() => true);
    article.releasePointerCapture = vi.fn();
    const placementBefore = { ...tracked.current().placements[0] };

    fireEvent.pointerDown(article, { pointerId: 307, button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 307, clientX: 410, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 307, clientX: 400, clientY: 400 });
    fireEvent.pointerUp(window, { pointerId: 307, clientX: 400, clientY: 400 });
    fireEvent.click(open);

    expect(tracked.current().placements[0]).toEqual(placementBefore);
    expect(tracked.saves).toHaveLength(0);
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("releases space-to-pan when the window loses focus", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");

    fireEvent.keyDown(stage, { key: " ", code: "Space" });
    fireEvent.blur(window);
    fireEvent.pointerDown(stage, { pointerId: 98, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 98, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 98, clientX: 160, clientY: 140 });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(tracked.saves).toHaveLength(0);
    expect(tracked.current().canvas.viewportX).toBe(0);
    expect(tracked.current().canvas.viewportY).toBe(0);
  });

  it("does not open area detail from the click synthesized after space-panning from it", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const area = screen.getByRole("region", { name: "区域：新区域" });

    act(() => {
      fireEvent.keyDown(stage, { key: " ", code: "Space" });
      fireEvent.pointerDown(area, { pointerId: 101, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 101, clientX: 160, clientY: 140 });
      fireEvent.pointerUp(window, { pointerId: 101, clientX: 160, clientY: 140 });
      fireEvent.click(area);
      fireEvent.keyUp(stage, { key: " ", code: "Space" });
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("lets space-pan start on an area handle without moving the area", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const move = screen.getByRole("button", { name: "移动区域：新区域" });

    act(() => {
      fireEvent.keyDown(stage, { key: " ", code: "Space" });
      fireEvent.pointerDown(move, { pointerId: 105, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 105, clientX: 160, clientY: 140 });
      fireEvent.pointerUp(window, { pointerId: 105, clientX: 160, clientY: 140 });
      fireEvent.keyUp(stage, { key: " ", code: "Space" });
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(tracked.current().areas[0]).toMatchObject({ x: 96, y: 86 });
  });

  it("allows a touch drag to pan from the blank interior of an area", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await userEvent.setup().click(screen.getByRole("button", { name: "打开随手页" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "新建区域" }));
    const area = await screen.findByRole("region", { name: "区域：新区域" });

    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 98, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };
    act(() => {
      pointer("pointerdown", area, {});
      pointer("pointermove", window, { clientX: 160, clientY: 140 });
      pointer("pointerup", window, { clientX: 160, clientY: 140 });
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(tracked.current().canvas.viewportY).toBe(-40);
  });

  it("does not open area detail from the click synthesized after a touch pan", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const area = screen.getByRole("region", { name: "区域：新区域" });

    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 99, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };
    act(() => {
      pointer("pointerdown", area, {});
      pointer("pointermove", window, { clientX: 160, clientY: 140 });
      pointer("pointerup", window, { clientX: 160, clientY: 140 });
      fireEvent.click(area);
    });

    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(-60));
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("opens area detail from a touch tap without relying on a synthesized click", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const area = screen.getByRole("region", { name: "区域：新区域" });

    const pointer = (type: string, target: EventTarget) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 100, button: 0, pointerType: "touch", clientX: 100, clientY: 100 })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };
    act(() => {
      pointer("pointerdown", area);
      pointer("pointerup", window);
    });

    expect(screen.getByRole("complementary", { name: "区域详情" })).toBeInTheDocument();
  });

  it("opens card detail from a touch tap without relying on a synthesized click", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);
    const article = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });

    const pointer = (type: string, target: EventTarget) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 106, button: 0, pointerType: "touch", clientX: 400, clientY: 400 })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };
    act(() => {
      pointer("pointerdown", article);
      pointer("pointerup", window);
    });

    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("remembers each date page viewport without saving the page turn", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");

    const pan = (pointerId: number, startX: number, endX: number) => {
      fireEvent.pointerDown(stage, { pointerId, button: 1, clientX: startX, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId, clientX: endX, clientY: 100 });
      fireEvent.pointerUp(window, { pointerId, clientX: endX, clientY: 100 });
    };

    pan(99, 100, 160);
    await waitFor(() => expect(tracked.saves).toHaveLength(1));
    expect(tracked.current().canvas.viewportX).toBe(-60);

    await user.click(screen.getByRole("button", { name: "后一天" }));
    pan(100, 100, 160);
    await waitFor(() => expect(tracked.saves).toHaveLength(2));
    expect(tracked.current().canvas.viewportX).toBe(-120);

    await user.click(screen.getByRole("button", { name: "前一天" }));
    const world = document.querySelector<HTMLElement>(".canvas-world");
    expect(world?.style.transform).toContain("translate(60px");
    expect(tracked.saves).toHaveLength(2);
  });

  it("does not carry a far-panned loose viewport into a first date page", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    fireEvent.pointerDown(stage, { pointerId: 201, button: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 201, clientX: -900, clientY: -700 });
    fireEvent.pointerUp(window, { pointerId: 201, clientX: -900, clientY: -700 });
    await waitFor(() => expect(tracked.current().canvas.viewportX).toBe(1000));

    await user.click(screen.getByRole("button", { name: "前一天" }));

    const world = document.querySelector<HTMLElement>(".canvas-world");
    expect(world?.style.transform).not.toContain("translate(-1000px");
    expect(screen.getByRole("region", { name: "昨天的画布" })).toBeInTheDocument();
    expect(tracked.saves).toHaveLength(1);
  });

  it("opens an existing loose page in a safe viewport on its first visit", async () => {
    const looseCard = createCard({ title: "随手页远处的卡片" }, { id: "first-loose-card", now: NOW });
    const workspace = workspaceReducer(createEmptyWorkspace(NOW), {
      type: "add-card",
      card: looseCard,
      pageKey: "loose",
      position: { x: 1400, y: 720 },
    });
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));

    const world = document.querySelector<HTMLElement>(".canvas-world");
    expect(world?.style.transform).not.toContain("translate(0px, 0px) scale(1)");
    expect(screen.getByRole("button", { name: "打开卡片：随手页远处的卡片" })).toBeInTheDocument();
  });

  it("uses the restored page zoom when dragging an area", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    const zoomIn = screen.getByRole("button", { name: "放大画布" });
    for (let index = 0; index < 8; index += 1) await user.click(zoomIn);
    await waitFor(() => expect(tracked.current().canvas.zoom).toBeCloseTo(1.8));

    await user.click(screen.getByRole("button", { name: "回到今天" }));
    const zoomOut = screen.getByRole("button", { name: "缩小画布" });
    await user.click(zoomOut);
    await user.click(screen.getByRole("button", { name: "放大画布" }));
    await waitFor(() => expect(tracked.current().canvas.zoom).toBeCloseTo(1));

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    expect(screen.getByTestId("canvas-zoom")).toHaveTextContent("180%");
    expect(screen.getByRole("button", { name: "放大画布" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    const area = await screen.findByRole("region", { name: "区域：新区域" });
    const move = screen.getByRole("button", { name: "移动区域：新区域" });
    const initialX = tracked.current().areas[0].x;

    fireEvent.pointerDown(move, { pointerId: 101, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 101, clientX: 280, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 101, clientX: 280, clientY: 100 });

    await waitFor(() => expect(tracked.current().areas[0].x).toBeCloseTo(initialX + 100));
    expect(area).toBeInTheDocument();
  });

  it("does not move an area for sub-threshold pointer jitter", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const move = screen.getByRole("button", { name: "移动区域：新区域" });
    const savesBeforeJitter = tracked.saves.length;

    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 108, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 108, clientX: 102, clientY: 101 });
      fireEvent.pointerUp(window, { pointerId: 108, clientX: 102, clientY: 101 });
      await Promise.resolve();
    });

    expect(tracked.current().areas[0]).toMatchObject({ x: 96, y: 86 });
    expect(tracked.saves).toHaveLength(savesBeforeJitter);
  });

  it("does not resize an area for sub-threshold pointer jitter", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const resize = screen.getByRole("button", { name: "调整区域大小：新区域" });
    const savesBeforeJitter = tracked.saves.length;

    await act(async () => {
      fireEvent.pointerDown(resize, { pointerId: 109, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 109, clientX: 102, clientY: 101 });
      fireEvent.pointerUp(window, { pointerId: 109, clientX: 102, clientY: 101 });
      await Promise.resolve();
    });

    expect(tracked.current().areas[0]).toMatchObject({ width: 520, height: 320 });
    expect(tracked.saves).toHaveLength(savesBeforeJitter);
  });

  it("preserves an area title draft when the area is moved", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    const title = await screen.findByDisplayValue("新区域");
    fireEvent.change(title, { target: { value: "这周顺手处理" } });

    const move = screen.getByRole("button", { name: "移动区域：新区域" });
    fireEvent.pointerDown(move, { pointerId: 102, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 102, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 102, clientX: 160, clientY: 140 });

    await waitFor(() => expect(tracked.current().areas[0]).toMatchObject({
      title: "这周顺手处理",
      x: 156,
      y: 126,
    }));
  });

  it("does not open area detail from the click synthesized after moving the area", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const move = screen.getByRole("button", { name: "移动区域：新区域" });

    act(() => {
      fireEvent.pointerDown(move, { pointerId: 103, button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 103, clientX: 160, clientY: 140 });
      fireEvent.pointerUp(window, { pointerId: 103, clientX: 160, clientY: 140 });
      fireEvent.click(move);
    });

    await waitFor(() => expect(tracked.current().areas[0].x).toBe(156));
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("opens area detail when the move handle is clicked without moving", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));

    await user.click(screen.getByRole("button", { name: "移动区域：新区域" }));

    expect(screen.getByRole("complementary", { name: "区域详情" })).toBeInTheDocument();
  });

  it("keeps a mouse area-handle tap cancelable until movement begins", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));

    const move = screen.getByRole("button", { name: "移动区域：新区域" });
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.entries({ pointerId: 902, pointerType: "mouse", button: 0, clientX: 400, clientY: 300 })
      .forEach(([key, value]) => Object.defineProperty(pointerDown, key, { value, configurable: true }));

    move.dispatchEvent(pointerDown);

    expect(pointerDown.defaultPrevented).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 902, pointerType: "mouse", button: 0, clientX: 400, clientY: 300 });
  });

  it("returns focus to capture after an area is deleted", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "删除区域" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "区域：新区域" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(capture);
  });

  it("focuses the area title after a new area is created", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));

    const title = await screen.findByDisplayValue("新区域");
    expect(document.activeElement).toBe(title);
  });

  it("selects the default area name for immediate replacement", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));

    const title = await screen.findByRole<HTMLInputElement>("textbox", { name: "区域名称" });
    expect(title.selectionStart).toBe(0);
    expect(title.selectionEnd).toBe("新区域".length);
  });

  it("does not reselect an existing area that is intentionally named new area", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    await user.click(screen.getByRole("region", { name: "区域：新区域" }));

    const title = await screen.findByRole<HTMLInputElement>("textbox", { name: "区域名称" });
    expect(title.selectionStart).toBe(title.selectionEnd);
  });

  it("keeps focus in the area title after saving with Enter", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    const title = await screen.findByRole("textbox", { name: "区域名称" });
    fireEvent.change(title, { target: { value: "周末灵感" } });

    await user.keyboard("{Enter}");

    await waitFor(() => expect(tracked.current().areas[0].title).toBe("周末灵感"));
    expect(document.activeElement).toBe(title);
  });

  it("does not open area detail merely when keyboard focus enters its move control", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const move = screen.getByRole("button", { name: "移动区域：新区域" });
    act(() => move.focus());

    expect(document.activeElement).toBe(move);
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("returns focus to the area after its detail is closed", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    const move = await screen.findByRole("button", { name: "移动区域：新区域" });
    await user.click(screen.getByRole("button", { name: "关闭区域详情" }));

    await waitFor(() => expect(document.activeElement).toBe(move));
    expect(screen.queryByRole("complementary", { name: "区域详情" })).not.toBeInTheDocument();
  });

  it("presents overview as a counted index without an introduction", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "总览" }));

    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "未完成 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已完成 0" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "未完成卡片：把卡片放在时间围栏外" })).toBeInTheDocument();
    expect(screen.queryByText("全都在这")).not.toBeInTheDocument();
    expect(screen.queryByText("画布负责随性，这里负责看全。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "已完成 0" }));
    expect(screen.getByText("还没有完成的卡片")).toBeInTheDocument();
    expect(screen.queryByText("做完的卡片会安静地留在这里。")).not.toBeInTheDocument();
  });

  it("ends old card detail when switching overview status", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：把卡片放在时间围栏外" }));
    const title = screen.getByRole("textbox", { name: "卡片标题" });
    await user.clear(title);
    await user.type(title, "切换前写完的标题");

    const completed = screen.getByRole("button", { name: "已完成 0" });
    await user.click(completed);

    expect(screen.queryByLabelText("卡片详情")).not.toBeInTheDocument();
    expect(completed).toHaveFocus();
    await waitFor(() => expect(tracked.current().cards[0].title).toBe("切换前写完的标题"));
  });

  it("keeps an empty overview to one direct line", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "总览" }));

    expect(screen.getByText("没有未完成的卡片")).toBeInTheDocument();
    expect(screen.queryByText("这里暂时没有要处理的卡片")).not.toBeInTheDocument();
    expect(screen.queryByText("想到什么，仍然可以直接写在下方。")).not.toBeInTheDocument();
  });

  it("explains an area as spatial range in one direct sentence", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));

    expect(await screen.findByText("区域只表示空间范围。移动区域不会带走卡片。")).toBeInTheDocument();
    expect(screen.queryByText(/轻轻圈住/)).not.toBeInTheDocument();
  });

  it("zooms around the midpoint during a two-finger canvas gesture and commits once", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 92, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", stage, { pointerId: 92, clientX: 50, clientY: 100 });
      pointer("pointerdown", stage, { pointerId: 93, clientX: 150, clientY: 100 });
      pointer("pointermove", window, { pointerId: 93, clientX: 200, clientY: 100 });
      pointer("pointerup", window, { pointerId: 93, clientX: 200, clientY: 100 });
    });

    await waitFor(() => expect(tracked.current().canvas.zoom).toBeCloseTo(1.5, 5));
    expect(tracked.current().canvas.viewportX).toBeCloseTo(16.6667, 3);
    expect(tracked.saves).toHaveLength(1);
  });

  it("cancels a two-finger gesture without persisting its temporary viewport", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 94, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", stage, { pointerId: 94, clientX: 50, clientY: 100 });
      pointer("pointerdown", stage, { pointerId: 95, clientX: 150, clientY: 100 });
      pointer("pointermove", window, { pointerId: 95, clientX: 200, clientY: 100 });
      pointer("pointercancel", window, { pointerId: 95, clientX: 200, clientY: 100 });
    });

    await waitFor(() => expect(tracked.current().canvas.zoom).toBe(1));
    expect(tracked.current().canvas.viewportX).toBe(0);
    expect(tracked.current().canvas.viewportY).toBe(0);
    expect(tracked.saves).toHaveLength(0);
  });

  it("keeps the second touch available for pinch when it lands on a card", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 96, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", stage, { pointerId: 96, clientX: 50, clientY: 100 });
      pointer("pointerdown", card, { pointerId: 97, clientX: 150, clientY: 100 });
      pointer("pointermove", window, { pointerId: 97, clientX: 200, clientY: 100 });
      pointer("pointerup", window, { pointerId: 97, clientX: 200, clientY: 100 });
    });

    await waitFor(() => expect(tracked.current().canvas.zoom).toBeCloseTo(1.5, 5));
    expect(tracked.saves).toHaveLength(1);
  });

  it("upgrades a card touch to a pinch when the second touch starts on blank canvas", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByLabelText("画布操作区");
    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    const initialPlacement = tracked.current().placements.find((placement) => placement.cardId === "today-card");
    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 98, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", card, { pointerId: 98, clientX: 50, clientY: 100 });
      pointer("pointerdown", stage, { pointerId: 99, clientX: 150, clientY: 100 });
      pointer("pointermove", window, { pointerId: 99, clientX: 200, clientY: 100 });
      pointer("pointerup", window, { pointerId: 99, clientX: 200, clientY: 100 });
    });

    await waitFor(() => expect(tracked.current().canvas.zoom).toBeCloseTo(1.5, 5));
    expect(tracked.current().placements.find((placement) => placement.cardId === "today-card"))
      .toMatchObject({ x: initialPlacement?.x, y: initialPlacement?.y });
    expect(tracked.saves).toHaveLength(1);
  });

  it("keeps the second touch available for pinch when it lands on an area handle", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    await user.click(await screen.findByRole("button", { name: "关闭区域详情" }));
    const move = screen.getByRole("button", { name: "移动区域：新区域" });
    const initialArea = tracked.current().areas[0];

    const pointer = (type: string, target: EventTarget, values: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries({ pointerId: 110, button: 0, pointerType: "touch", clientX: 100, clientY: 100, ...values })
        .forEach(([key, value]) => Object.defineProperty(event, key, { value, configurable: true }));
      target.dispatchEvent(event);
    };

    act(() => {
      pointer("pointerdown", screen.getByLabelText("画布操作区"), { pointerId: 110, clientX: 50, clientY: 100 });
      pointer("pointerdown", move, { pointerId: 111, clientX: 150, clientY: 100 });
      pointer("pointermove", window, { pointerId: 111, clientX: 200, clientY: 100 });
      pointer("pointerup", window, { pointerId: 111, clientX: 200, clientY: 100 });
    });

    await waitFor(() => expect(tracked.current().canvas.zoom).toBeCloseTo(1.5, 5));
    expect(tracked.current().areas[0]).toMatchObject({ x: initialArea.x, y: initialArea.y });
  });

  it("moves a card to another page when its date changes in the inspector", async () => {
    const tracked = trackedRepository(workspaceWithYesterdayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await screen.findByRole("region", { name: "今天的画布" });
    await user.click(screen.getByRole("button", { name: "前一天" }));
    await user.click(screen.getByRole("button", { name: "打开卡片：昨天还没寄出的包裹" }));

    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });

    await waitFor(() => expect(tracked.current().placements[0].pageKey).toBe("2026-08-27"));
    expect(tracked.current().cards[0].timeConstraint?.date).toBe("2026-08-27");
    expect(screen.getByRole("region", { name: "8月27日的画布" })).toBeInTheDocument();
  });

  it("reveals a card moved into a date page whose time region was out of view", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const stage = await screen.findByRole("region", { name: "画布操作区" });
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 760 },
      clientHeight: { configurable: true, value: 560 },
    });

    await user.click(screen.getByRole("button", { name: "选择日期页面" }));
    fireEvent.change(screen.getByLabelText("选择其他日期"), { target: { value: "2026-08-27" } });
    await screen.findByRole("region", { name: "8月27日的画布" });
    fireEvent.wheel(stage, { deltaY: 600 });
    await waitFor(() => expect(tracked.current().canvas.viewportY).toBe(600));

    await user.click(screen.getByRole("button", { name: "选择日期页面" }));
    fireEvent.change(screen.getByLabelText("选择其他日期"), { target: { value: "2026-08-25" } });
    await user.click(screen.getByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });

    await waitFor(() => expect(tracked.current().placements[0].pageKey).toBe("2026-08-27"));
    const placement = tracked.current().placements[0];
    const viewport = tracked.current().canvas;
    const screenTop = (placement.y - viewport.viewportY) * viewport.zoom;
    expect(screenTop).toBeGreaterThanOrEqual(88);
    expect(screenTop + 112).toBeLessThanOrEqual(560 - 112);
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("closes an overview-opened inspector back to the visible canvas card after a date change", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });
    const visibleCard = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    await user.click(screen.getByRole("button", { name: "关闭卡片详情" }));

    await waitFor(() => expect(document.activeElement).toBe(visibleCard));
  });

  it("focuses the start field when the exact-time editor appears", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "添加具体时间" }));

    const startTime = await screen.findByLabelText("开始时间");
    await waitFor(() => expect(document.activeElement).toBe(startTime));
  });

  it("keeps a still-valid end time when the start time changes", async () => {
    const timedWorkspace = workspaceReducer(workspaceWithTodayCard(), {
      type: "update-card",
      cardId: "today-card",
      patch: {
        timeConstraint: {
          date: "2026-08-25",
          period: "morning",
          startTime: "09:00",
          endTime: "10:00",
        },
      },
      now: NOW,
    });
    const tracked = trackedRepository(timedWorkspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "09:30" } });
    });
    await waitFor(() => expect(tracked.current().cards[0].timeConstraint?.startTime).toBe("09:30"));

    expect(tracked.current().cards[0].timeConstraint).toEqual({
      date: "2026-08-25",
      period: "morning",
      startTime: "09:30",
      endTime: "10:00",
    });
  });

  it("returns focus to the date field after moving a card to loose", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "移到随手页" }));

    await waitFor(() => expect(tracked.current().placements[0].pageKey).toBe("loose"));
    expect(screen.getByRole("region", { name: "随手页画布" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText("日期"));
  });

  it("places a card moved to loose inside the loose page viewport", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    const stage = screen.getByLabelText("画布操作区");
    fireEvent.pointerDown(stage, { pointerId: 305, button: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 305, clientX: -400, clientY: -300 });
    fireEvent.pointerUp(window, { pointerId: 305, clientX: -400, clientY: -300 });
    await waitFor(() => expect(tracked.current().canvas).toMatchObject({ viewportX: 800, viewportY: 600 }));

    await user.click(screen.getByRole("button", { name: "回到今天" }));
    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "移到随手页" }));

    expect(tracked.current().placements[0]).toMatchObject({ pageKey: "loose", x: 926, y: 718 });
    expect(document.querySelector<HTMLElement>(".canvas-world")?.style.transform)
      .toBe("translate(-800px, -600px) scale(1)");
  });

  it("avoids an existing loose card when moving a card out of a date page", async () => {
    const datedCard = createCard({
      title: "移到随手页的卡片",
      timeConstraint: { date: "2026-08-25", period: "morning" },
    }, { id: "move-to-loose-card", now: NOW });
    const looseCard = createCard({ title: "已经在随手页的卡片" }, { id: "existing-loose-card", now: NOW });
    let workspace = createEmptyWorkspace(NOW);
    workspace = workspaceReducer(workspace, {
      type: "add-card",
      card: datedCard,
      pageKey: "2026-08-25",
      position: { x: 320, y: 360 },
    });
    workspace = workspaceReducer(workspace, {
      type: "add-card",
      card: looseCard,
      pageKey: "loose",
      position: { x: 126, y: 118 },
    });
    const tracked = trackedRepository(workspace);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：移到随手页的卡片" }));
    await user.click(screen.getByRole("button", { name: "移到随手页" }));

    await waitFor(() => expect(tracked.current().placements.find((item) => item.cardId === datedCard.id)?.pageKey).toBe("loose"));
    const movedPlacement = tracked.current().placements.find((item) => item.cardId === datedCard.id);
    expect(movedPlacement).toMatchObject({ pageKey: "loose", x: 402, y: 118 });
  });

  it("follows an inspected card back to its page when its date change is undone", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));

    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });
    await waitFor(() => expect(screen.getByRole("region", { name: "8月27日的画布" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "撤销上一步" }));

    await waitFor(() => expect(tracked.current().placements[0].pageKey).toBe("2026-08-25"));
    expect(screen.getByRole("region", { name: "今天的画布" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("returns focus to capture when the final undo action disappears", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(capture, "临时记下一件事{Enter}");
    const undo = await screen.findByRole("button", { name: "撤销上一步" });
    await user.click(undo);

    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销上一步" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(capture);
  });

  it("does not treat the redo chord as another workspace undo", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(capture, "第一张卡片{Enter}第二张卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(2));
    const undo = screen.getByRole("button", { name: "撤销上一步" });
    undo.focus();

    fireEvent.keyDown(undo, { key: "z", ctrlKey: true, shiftKey: true });

    expect(tracked.current().cards).toHaveLength(2);
    fireEvent.keyDown(undo, { key: "z", ctrlKey: true });
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));
    expect(tracked.current().cards[0].title).toBe("第一张卡片");
  });

  it("follows a date change from overview back to the target canvas page", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });

    await waitFor(() => expect(tracked.current().placements[0].pageKey).toBe("2026-08-27"));
    expect(screen.getByRole("button", { name: "画布" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "8月27日的画布" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("keeps a completed card in overview when its date changes", async () => {
    const completed = workspaceReducer(workspaceWithTodayCard(), {
      type: "toggle-card",
      cardId: "today-card",
      now: NOW,
    });
    const tracked = trackedRepository(completed);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: /^已完成/ }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });

    await waitFor(() => expect(tracked.current().placements[0].pageKey).toBe("2026-08-27"));
    expect(screen.getByRole("button", { name: "总览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("keeps the canvas page stable when a completed card date change is undone", async () => {
    const completed = workspaceReducer(workspaceWithYesterdayCard(), {
      type: "toggle-card",
      cardId: "yesterday-card",
      now: NOW,
    });
    const tracked = trackedRepository(completed);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: /^已完成/ }));
    await user.click(screen.getByRole("button", { name: "打开总览卡片：昨天还没寄出的包裹" }));
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-27" } });
    await user.click(screen.getByRole("button", { name: "撤销上一步" }));
    await user.click(screen.getByRole("button", { name: "画布" }));

    expect(screen.getByRole("region", { name: "今天的画布" })).toBeInTheDocument();
    expect(tracked.current().placements[0].pageKey).toBe("2026-08-24");
  });

  it("keeps focus inside the delete confirmation and returns it on cancel", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const deleteTrigger = screen.getByRole("button", { name: "删除卡片" });
    await user.click(deleteTrigger);
    const deleteDialog = screen.getByRole("dialog", { name: "删除这张卡片？" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认删除" });
    expect(deleteDialog).toHaveAccessibleDescription(/把卡片放在时间围栏外.*会从画布移除/);
    expect(document.activeElement).toBe(cancel);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.click(cancel);

    await waitFor(() => expect(document.activeElement).toBe(deleteTrigger));
  });

  it("does not open search over a delete confirmation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);
    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "删除卡片" }));
    const deleteDialog = screen.getByRole("dialog", { name: "删除这张卡片？" });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(document.activeElement).toBe(cancel);

    await user.keyboard("{Control>}k{/Control}");

    expect(deleteDialog).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "搜索卡片" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(cancel);
  });

  it("does not let workspace undo pass through a delete confirmation", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });
    await user.type(capture, "保留删除确认里的卡片{Enter}");
    await waitFor(() => expect(tracked.current().cards).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "打开卡片：保留删除确认里的卡片" }));
    await user.click(screen.getByRole("button", { name: "删除卡片" }));
    await user.keyboard("{Control>}z{/Control}");

    expect(screen.getByRole("dialog", { name: "删除这张卡片？" })).toBeInTheDocument();
    expect(tracked.current().cards[0].title).toBe("保留删除确认里的卡片");
  });

  it("quietly points back to unfinished cards on the previous day", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithYesterdayCard()).repository} now={() => NOW} />);

    const bookmark = await screen.findByRole("button", { name: "查看前一天留下的 1 张卡片" });
    expect(bookmark).toHaveTextContent("前一天还留着 1 张");
    await user.click(bookmark);
    expect(screen.getByRole("button", { name: "打开卡片：昨天还没寄出的包裹" })).toBeInTheDocument();
  });

  it("lets a dated card leave every time fence while keeping its day", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    card.setPointerCapture = vi.fn();
    card.hasPointerCapture = vi.fn(() => true);
    card.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(card, { pointerId: 9, button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 400, clientY: -100 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 400, clientY: -100 });

    await waitFor(() => expect(tracked.current().cards[0].timeConstraint).toEqual({ date: "2026-08-25", period: "anytime" }));
    expect(tracked.current().placements[0].y).toBe(-140);
  });

  it("snaps a dated card into a time fence when released inside it", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    card.setPointerCapture = vi.fn();
    card.hasPointerCapture = vi.fn(() => true);
    card.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(card, { pointerId: 10, button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 400, clientY: 540 });
    fireEvent.pointerUp(window, { pointerId: 10, clientX: 400, clientY: 540 });

    await waitFor(() => expect(tracked.current().cards[0].timeConstraint).toEqual({ date: "2026-08-25", period: "afternoon" }));
    expect(tracked.current().placements[0].y).toBe(512);
    expect(card.style.getPropertyValue("--drop-offset-y")).toBe("-12px");
  });

  it("keeps a card visible while its completion feedback is playing", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    fireEvent.click(screen.getByRole("button", { name: "完成卡片：把卡片放在时间围栏外" }));

    expect(card).toHaveClass("is-completing");
    await waitFor(() => expect(tracked.saves).toHaveLength(1));
    expect(tracked.current().cards[0].status).toBe("completed");
    await waitFor(() => expect(screen.queryByRole("article", { name: "卡片：把卡片放在时间围栏外" })).not.toBeInTheDocument(), { timeout: 700 });
  });

  it("returns focus to capture after a completed card leaves the canvas", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "完成卡片：把卡片放在时间围栏外" }));

    await waitFor(() => expect(screen.queryByRole("article", { name: "卡片：把卡片放在时间围栏外" })).not.toBeInTheDocument(), { timeout: 700 });
    expect(document.activeElement).toBe(capture);
  });

  it("returns focus to capture after a completed card leaves overview", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "完成总览卡片：把卡片放在时间围栏外" }));

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "未完成卡片：把卡片放在时间围栏外" })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(capture), { timeout: 700 });
  });

  it("returns focus immediately when a completed overview row has no exit animation", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "完成总览卡片：把卡片放在时间围栏外" }));

    expect(screen.queryByRole("listitem", { name: "未完成卡片：把卡片放在时间围栏外" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(capture);
  });

  it("returns focus to capture after a restored card leaves completed overview", async () => {
    const completed = workspaceReducer(workspaceWithTodayCard(), {
      type: "toggle-card",
      cardId: "today-card",
      now: NOW,
    });
    const tracked = trackedRepository(completed);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.click(screen.getByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "已完成 1" }));
    await user.click(screen.getByRole("button", { name: "恢复总览卡片：把卡片放在时间围栏外" }));

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "已完成卡片：把卡片放在时间围栏外" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(capture);
  });

  it("keeps the latest inspector draft when completing its card", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "完成前刚写好的标题" } });
    fireEvent.click(screen.getByRole("button", { name: "完成卡片：把卡片放在时间围栏外" }));

    await waitFor(() => expect(tracked.current().cards[0]).toMatchObject({
      title: "完成前刚写好的标题",
      status: "completed",
    }));
  });

  it("previews the time fence while a card is being dragged", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    card.setPointerCapture = vi.fn();
    card.hasPointerCapture = vi.fn(() => true);
    card.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(card, { pointerId: 11, button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 400, clientY: 540 });

    expect(document.querySelector(".canvas-day-period.is-afternoon.is-active")).toBeInTheDocument();
    expect(screen.getByText("放进下午")).toBeInTheDocument();

    fireEvent.pointerCancel(window, { pointerId: 11 });
    expect(document.querySelector(".canvas-day-period.is-active")).not.toBeInTheDocument();
    expect(tracked.current().cards[0].timeConstraint?.period).toBe("morning");
  });

  it("commits inspector title edits once on blur", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const title = screen.getByLabelText("卡片标题");
    fireEvent.change(title, { target: { value: "改过的标题" } });

    expect(tracked.current().cards[0].title).toBe("把卡片放在时间围栏外");
    expect(tracked.saves).toHaveLength(0);
    fireEvent.blur(title);

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("改过的标题"));
    expect(tracked.saves).toHaveLength(1);
  });

  it("preserves an inspector title draft when another property changes", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const title = screen.getByLabelText("卡片标题");
    const priority = screen.getByLabelText("优先级");
    act(() => {
      fireEvent.change(title, { target: { value: "标题和优先级一起修改" } });
      fireEvent.blur(title);
      fireEvent.change(priority, { target: { value: "high" } });
    });

    await waitFor(() => expect(tracked.current().cards[0]).toMatchObject({
      title: "标题和优先级一起修改",
      priority: "high",
    }));
  });

  it("keeps the already-selected time period idempotent", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const placementBefore = { ...tracked.current().placements[0] };
    await user.click(screen.getByRole("button", { name: "上午" }));

    expect(tracked.current().placements[0]).toEqual(placementBefore);
    expect(tracked.saves).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "撤销上一步" })).not.toBeInTheDocument();
  });

  it("preserves an inspector title draft when the date changes", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const title = screen.getByLabelText("卡片标题");
    const date = screen.getByLabelText("日期");
    act(() => {
      fireEvent.change(title, { target: { value: "标题和日期一起修改" } });
      fireEvent.blur(title);
      fireEvent.change(date, { target: { value: "2026-08-26" } });
    });

    await waitFor(() => expect(tracked.current().cards[0]).toMatchObject({
      title: "标题和日期一起修改",
      timeConstraint: { date: "2026-08-26" },
    }));
  });

  it("preserves an inspector title draft when the card is moved", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const title = screen.getByLabelText("卡片标题");
    fireEvent.change(title, { target: { value: "标题和位置一起修改" } });

    const card = screen.getByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    card.setPointerCapture = vi.fn();
    card.hasPointerCapture = vi.fn(() => true);
    card.releasePointerCapture = vi.fn();
    act(() => {
      fireEvent.pointerDown(card, { pointerId: 12, button: 0, clientX: 400, clientY: 400 });
      fireEvent.pointerMove(window, { pointerId: 12, clientX: 460, clientY: 430 });
      fireEvent.pointerUp(window, { pointerId: 12, clientX: 460, clientY: 430 });
    });

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("标题和位置一起修改"));
    expect(tracked.current().placements[0]).toMatchObject({ x: 380, y: 346 });
  });

  it("saves an area rename once on blur instead of once per character", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    const title = await screen.findByDisplayValue("新区域");
    await waitFor(() => expect(tracked.saves.length).toBeGreaterThanOrEqual(1));
    const savesAfterCreate = tracked.saves.length;

    fireEvent.change(title, { target: { value: "灵感收集" } });
    expect(tracked.current().areas[0].title).toBe("新区域");
    expect(tracked.saves).toHaveLength(savesAfterCreate);

    fireEvent.blur(title);
    await waitFor(() => expect(tracked.current().areas[0].title).toBe("灵感收集"));
    expect(tracked.saves).toHaveLength(savesAfterCreate + 1);
  });

  it("keeps only inline editing after a real double click", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    render(<App repository={tracked.repository} now={() => NOW} />);

    const opener = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    fireEvent.click(opener);
    fireEvent.click(opener);
    fireEvent.doubleClick(opener);

    expect(screen.queryByLabelText("卡片详情")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" })).toBeInTheDocument();
  });

  it("returns focus to the card after cancelling inline title editing", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    const opener = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    fireEvent.doubleClick(opener);
    const inlineTitle = screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" });
    expect(document.activeElement).toBe(inlineTitle);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }),
    ));
  });

  it("returns focus to the card after saving inline title editing with Enter", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    fireEvent.doubleClick(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    const inlineTitle = screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" });
    fireEvent.change(inlineTitle, { target: { value: "按回车保存的标题" } });

    await user.keyboard("{Enter}");

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("按回车保存的标题"));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "打开卡片：按回车保存的标题" }),
    ));
  });

  it("commits the latest inspector draft on Escape and restores the card focus", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const opener = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    await user.click(opener);
    const title = screen.getByLabelText("卡片标题");
    fireEvent.change(title, { target: { value: "Escape 保存的新标题" } });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("Escape 保存的新标题"));
    expect(screen.queryByLabelText("卡片详情")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("flushes the latest inspector draft when the app unmounts", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    const rendered = render(<App repository={tracked.repository} now={() => NOW} />);
    const opener = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    await user.click(opener);
    const title = screen.getByLabelText("卡片标题");
    fireEvent.change(title, { target: { value: "卸载前保存的新标题" } });

    expect(tracked.current().cards[0].title).toBe("把卡片放在时间围栏外");
    rendered.unmount();

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("卸载前保存的新标题"));
    expect(tracked.saves).toHaveLength(1);
  });

  it("flushes the latest inline title draft when the app unmounts", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const rendered = render(<App repository={tracked.repository} now={() => NOW} />);
    const opener = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });

    fireEvent.doubleClick(opener);
    const title = screen.getByRole("textbox", { name: "就地编辑卡片：把卡片放在时间围栏外" });
    fireEvent.change(title, { target: { value: "就地编辑后直接退出" } });
    expect(tracked.current().cards[0].title).toBe("把卡片放在时间围栏外");

    rendered.unmount();

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("就地编辑后直接退出"));
    expect(tracked.saves).toHaveLength(1);
  });

  it("flushes the latest inspector draft before the window unloads", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);
    const opener = await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" });
    await user.click(opener);
    fireEvent.change(screen.getByLabelText("卡片标题"), { target: { value: "关闭窗口前保存的新标题" } });

    fireEvent(window, new Event("beforeunload"));

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("关闭窗口前保存的新标题"));
    expect(tracked.saves).toHaveLength(1);
  });

  it("flushes the latest area draft when the app unmounts", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    const rendered = render(<App repository={tracked.repository} now={() => NOW} />);
    await user.click(screen.getByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "新建区域" }));
    const title = await screen.findByDisplayValue("新区域");
    fireEvent.change(title, { target: { value: "卸载前保存的区域" } });

    rendered.unmount();

    await waitFor(() => expect(tracked.current().areas[0].title).toBe("卸载前保存的区域"));
    expect(tracked.saves).toHaveLength(2);
  });
});

describe("native agent workspace", () => {
  it("exposes conversation as a primary view without a temporary capture-bar trigger", async () => {
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    const navigation = screen.getByRole("navigation", { name: "主要视图" });
    const conversation = within(navigation).getByRole("button", { name: "对话" });

    expect(conversation).toHaveAttribute("aria-pressed", "false");
    expect(within(navigation).getAllByRole("button")).toHaveLength(3);
    expect(document.querySelector(".canvas-agent-trigger")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "对话工作区" })).not.toBeInTheDocument();
  });

  it("enters the native conversation workspace from navigation or Ctrl J and focuses its input", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const conversation = await screen.findByRole("button", { name: "对话" });
    await user.click(conversation);

    expect(conversation).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "对话输入" }));

    await user.click(screen.getByRole("button", { name: "画布" }));
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "对话输入" }));
  });

  it("keeps the ordinary capture bar visible beneath the canvas agent panel", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));

    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "快速记录卡片" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "今天的画布" })).toBeInTheDocument();
  });

  it("uses Ctrl J as a primary-view shortcut and restores the canvas capture focus", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await screen.findByRole("region", { name: "今天的画布" });
    expect(screen.getByRole("navigation", { name: "主要视图" })).toHaveTextContent("画布总览对话");

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "对话输入" }));
    await user.click(screen.getByRole("button", { name: "画布" }));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "快速记录卡片" }),
    ));
  });

  it("marks the feedback rail for the native agent view", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(capture, "临时卡片{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "撤销上一步" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "对话" }));

    expect(screen.getByRole("button", { name: "撤销上一步" }).closest(".canvas-feedback-rail"))
      .toHaveClass("is-agent-view");
  });

  it("keeps the ordinary capture draft separate and restores its quick candidates", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);
    const capture = await screen.findByRole("textbox", { name: "快速记录卡片" });

    await user.type(capture, "买牛奶#");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "对话" }));

    expect(capture).toHaveValue("买牛奶#");
    expect(screen.queryByRole("listbox", { name: "快速语法候选" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "明天下午交水电费");
    await user.click(screen.getByRole("button", { name: "画布" }));

    expect(capture).toHaveValue("买牛奶#");
    expect(screen.getByRole("listbox", { name: "快速语法候选" })).toBeInTheDocument();
    expect(screen.queryByText("明天下午交水电费")).not.toBeInTheDocument();
  });

  it("creates a card from one sentence and shows a grounded receipt", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "明天下午交水电费{Enter}");

    expect(await screen.findByText("好，放到明天下午了。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看交水电费" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销这次操作" })).toBeInTheDocument();
    await waitFor(() => expect(tracked.current().cards[0]).toMatchObject({
      title: "交水电费",
      timeConstraint: { date: "2026-08-26", period: "afternoon" },
    }));
  });

  it("keeps the conversation input ready for the next sentence after an action", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "明天下午交水电费{Enter}");

    await screen.findByText("好，放到明天下午了。");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("does not submit the conversation while Chinese IME composition is active", async () => {
    const tracked = trackedRepository();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    const form = input.closest("form");
    expect(form).not.toBeNull();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "明天下午交水电费" } });
    const enterDuringComposition = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enterDuringComposition);
    expect(enterDuringComposition.defaultPrevented).toBe(false);
    await act(async () => {
      fireEvent.submit(form!);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(tracked.current().cards).toHaveLength(0);
    expect(screen.queryByText("好，放到明天下午了。")).not.toBeInTheDocument();
    expect(input).toHaveValue("明天下午交水电费");

    fireEvent.compositionEnd(input);
    expect(input).toHaveValue("明天下午交水电费");
    expect(tracked.current().cards).toHaveLength(0);
  });

  it("uses a newly created card as the next conversation target", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "明天下午交水电费{Enter}");

    await waitFor(() => expect(screen.getByText("正在处理：交水电费")).toBeInTheDocument());
    await user.type(input, "这个做完了{Enter}");

    await waitFor(() => expect(tracked.current().cards[0]?.status).toBe("completed"));
  });

  it("undoes the exact action from its receipt", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "明天下午交水电费{Enter}");
    await user.click(await screen.findByRole("button", { name: "撤销这次操作" }));

    await waitFor(() => expect(tracked.current().cards).toHaveLength(0));
    expect(screen.getByText("刚才的更改已经撤销。")).toBeInTheDocument();
  });

  it("does not misreport a receipt when canvas undo already reverted the agent action", async () => {
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "记下买牛奶{Enter}");
    await screen.findByText("好，放到今天了。");

    await user.click(screen.getByRole("button", { name: "画布" }));
    await user.click(screen.getByRole("button", { name: "撤销上一步" }));
    await waitFor(() => expect(tracked.current().cards).toHaveLength(0));

    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.click(screen.getByRole("button", { name: "撤销这次操作" }));

    expect(screen.getByText("这次操作已经撤销。")).toBeInTheDocument();
    expect(screen.queryByText("这次操作之后已有新的更改，请使用画布上的撤销。")).not.toBeInTheDocument();
  });

  it("restores the deleted card as the conversation target after undo", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "删除把卡片放在时间围栏外{Enter}");
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(tracked.current().cards[0].status).toBe("deleted"));

    await user.click(screen.getByRole("button", { name: "撤销这次操作" }));
    await waitFor(() => expect(tracked.current().cards[0].status).toBe("open"));
    expect(screen.getByText("正在处理：把卡片放在时间围栏外")).toBeInTheDocument();

    await user.type(input, "这个完成了{Enter}");
    await waitFor(() => expect(tracked.current().cards[0].status).toBe("completed"));
  });

  it("keeps conversation turn keys unique after undo and an immediate follow-up", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      render(<App repository={tracked.repository} now={() => NOW} />);

      await user.click(await screen.findByRole("button", { name: "对话" }));
      const input = screen.getByRole("textbox", { name: "对话输入" });
      await user.type(input, "删除把卡片放在时间围栏外{Enter}");
      await user.click(screen.getByRole("button", { name: "确认删除" }));
      await waitFor(() => expect(tracked.current().cards[0].status).toBe("deleted"));
      await user.click(screen.getByRole("button", { name: "撤销这次操作" }));
      await waitFor(() => expect(tracked.current().cards[0].status).toBe("open"));
      await user.type(input, "这个完成了{Enter}");
      await waitFor(() => expect(tracked.current().cards[0].status).toBe("completed"));

      expect(consoleError.mock.calls.some(([message]) => String(message).includes("same key"))).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps ordinary capture local even when an agent model is provided", async () => {
    const interpret = vi.fn(async () => ({ type: "unsupported", message: "不应调用" } as const));
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={{ interpret }} />);

    await user.type(await screen.findByRole("textbox", { name: "快速记录卡片" }), "直接记录{Enter}");

    expect(interpret).not.toHaveBeenCalled();
    await waitFor(() => expect(tracked.current().cards[0].title).toBe("直接记录"));
  });

  it("keeps the canvas unchanged when the agent model fails", async () => {
    const interpret = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={{ interpret }} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "明天下午交水电费{Enter}");

    expect(await screen.findByText("现在没有处理成功，画布没有变化。")).toBeInTheDocument();
    expect(tracked.current().cards).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "撤销这次操作" })).not.toBeInTheDocument();
  });

  it("asks one small question and executes only the chosen matching card", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把报销放到明天下午{Enter}");

    expect(screen.getByText("找到两张“报销”，你指哪一张？")).toBeInTheDocument();
    const choices = screen.getByRole("listbox", { name: "请选择卡片" });
    expect(within(choices).getAllByRole("option")).toHaveLength(2);
    expect(tracked.current().cards.every((card) => card.timeConstraint?.date === "2026-08-25")).toBe(true);

    await user.click(within(choices).getByRole("option", { name: /提交报销.*未完成.*今天/ }));

    await waitFor(() => expect(tracked.current().cards.find((card) => card.id === "agent-expense-1")?.timeConstraint)
      .toMatchObject({ date: "2026-08-26", period: "afternoon" }));
    expect(tracked.current().cards.find((card) => card.id === "agent-expense-2")?.timeConstraint?.date)
      .toBe("2026-08-25");
  });

  it("supports keyboard selection of an ambiguous agent candidate", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把报销放到明天下午{Enter}");

    const choices = screen.getByRole("listbox", { name: "请选择卡片" });
    const options = within(choices).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    options[0].focus();
    expect(document.activeElement).toBe(options[0]);
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(tracked.current().cards.find((card) => card.id === "agent-expense-2")?.timeConstraint)
      .toMatchObject({ date: "2026-08-26", period: "afternoon" }));
    expect(tracked.current().cards.find((card) => card.id === "agent-expense-1")?.timeConstraint?.date)
      .toBe("2026-08-25");
  });

  it("places focus on the first ambiguous agent candidate", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithAgentCards()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把报销放到明天下午{Enter}");

    const choices = screen.getByRole("listbox", { name: "请选择卡片" });
    const options = within(choices).getAllByRole("option");
    await waitFor(() => expect(document.activeElement).toBe(options[0]));
    expect(options[0]).toHaveAttribute("tabindex", "0");
    expect(options[1]).toHaveAttribute("tabindex", "-1");
  });

  it("places focus on the primary action for a batch confirmation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithAgentCards()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把今天没做完的移到周五{Enter}");

    const confirm = screen.getByRole("button", { name: "确认这次操作" });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
  });

  it("keeps the chosen candidate as the next conversation target", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "把报销放到明天下午{Enter}");
    const choices = screen.getByRole("listbox", { name: "请选择卡片" });
    await user.click(within(choices).getByRole("option", { name: /整理报销.*未完成.*今天/ }));

    expect(screen.getByText("正在处理：整理报销")).toBeInTheDocument();
    await user.type(input, "这个做完了{Enter}");

    await waitFor(() => expect(tracked.current().cards.find((card) => card.id === "agent-expense-2")?.status)
      .toBe("completed"));
    expect(tracked.current().cards.find((card) => card.id === "agent-expense-1")?.status).toBe("open");
  });

  it("previews a batch and commits it as one undoable action", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把今天没做完的移到周五{Enter}");

    expect(screen.getByText("会移动 2 张 Card 到周五。")).toBeInTheDocument();
    expect(tracked.current().cards.every((card) => card.timeConstraint?.date === "2026-08-25")).toBe(true);
    await user.click(screen.getByRole("button", { name: "确认这次操作" }));

    await waitFor(() => expect(tracked.current().cards.every((card) => card.timeConstraint?.date === "2026-08-28")).toBe(true));
    await user.click(screen.getByRole("button", { name: "撤销这次操作" }));
    await waitFor(() => expect(tracked.current().cards.every((card) => card.timeConstraint?.date === "2026-08-25")).toBe(true));
  });

  it("does not choose a conversational target for a one-card batch", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    await user.type(input, "把今天没做完的移到周五{Enter}");
    await user.click(screen.getByRole("button", { name: "确认这次操作" }));

    await waitFor(() => expect(tracked.current().cards[0].timeConstraint?.date).toBe("2026-08-28"));
    expect(screen.queryByText("正在处理：把卡片放在时间围栏外")).not.toBeInTheDocument();
  });

  it("shows non-persistent outlines for visible cards in a pending batch", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把今天没做完的移到周五{Enter}");

    expect(screen.getByText("会移动 2 张 Card 到周五。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "画布" }));
    const previews = document.querySelectorAll(".canvas-agent-preview");
    expect(previews).toHaveLength(2);
    expect(Array.from(previews).every((preview) => preview.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(tracked.current().cards.every((card) => card.timeConstraint?.date === "2026-08-25")).toBe(true);

    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(document.querySelectorAll(".canvas-agent-preview")).toHaveLength(0);
  });

  it("requires the existing safe confirmation before destructive execution", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "删除把卡片放在时间围栏外{Enter}");

    const confirm = screen.getByRole("dialog", { name: "删除这张卡片？" });
    expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "取消" }));
    expect(tracked.current().cards[0].status).toBe("open");
    await user.click(within(confirm).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(tracked.current().cards[0].status).toBe("deleted"));
    expect(screen.getByText("会删除“把卡片放在时间围栏外”。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销这次操作" })).toBeInTheDocument();
  });

  it("backs out of a pending batch without leaving the conversation workspace", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把今天没做完的移到周五{Enter}");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认这次操作" })).not.toBeInTheDocument();
    expect(tracked.current().cards.every((card) => card.timeConstraint?.date === "2026-08-25")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "对话输入" }));
  });

  it("keeps a factual today query in conversation until the user opens overview", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "今天还有什么{Enter}");

    expect(await screen.findByText("今天还有 2 张未完成。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对话" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤销这次操作" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "在总览中查看" }));
    expect(screen.getByRole("button", { name: "总览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /未完成 2/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps an explicit-date query read-only instead of creating a card", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "明天有什么任务{Enter}");

    expect(await screen.findByText("明天没有未完成的 Card。", { exact: false })).toBeInTheDocument();
    expect(tracked.current().cards).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "查看任务" })).not.toBeInTheDocument();
  });

  it("keeps an incomplete schedule request read-only instead of creating a card", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把报销放到那里{Enter}");

    expect(await screen.findByText("请说清要放到哪一天或时段，画布没有变化。", { exact: false })).toBeInTheDocument();
    expect(tracked.current().cards).toHaveLength(2);
  });

  it("replaces search with conversation instead of stacking transient layers", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "搜索卡片" }));
    expect(screen.getByRole("dialog", { name: "搜索卡片" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(screen.queryByRole("dialog", { name: "搜索卡片" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
  });

  it("temporarily replaces conversation with search and returns to the same draft", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "先留在这里");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.queryByRole("region", { name: "对话工作区" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "搜索卡片" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue("先留在这里");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "对话输入" }));
  });

  it("unmounts conversation when switching primary views", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "总览" }));

    expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "对话工作区" })).not.toBeInTheDocument();
  });

  it("keeps the selected primary-view button focused after leaving conversation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const overview = screen.getByRole("button", { name: "总览" });
    await user.click(overview);

    expect(document.activeElement).toBe(overview);
  });

  it("does not open search over an agent deletion confirmation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "删除把卡片放在时间围栏外{Enter}");
    expect(screen.getByRole("dialog", { name: "删除这张卡片？" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByRole("dialog", { name: "删除这张卡片？" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "搜索卡片" })).not.toBeInTheDocument();
  });

  it("uses the visibly selected card for this and closes its inspector on completion", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("正在处理：把卡片放在时间围栏外")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");

    await waitFor(() => expect(tracked.current().cards[0].status).toBe("completed"));
    expect(screen.getByText("完成了。")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("invalidates the agent card context when the selected card is deleted", async () => {
    let receivedContext: { selectedCardId: string | null } | null = null;
    const agentModel = {
      interpret: async (_request: string, context: { selectedCardId: string | null }) => {
        receivedContext = context;
        return { type: "unsupported" as const, message: "没有处理。" };
      },
    };
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "删除卡片" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");

    await screen.findByText("没有处理。");
    expect((receivedContext as { selectedCardId: string | null } | null)?.selectedCardId).toBeNull();
  });

  it("keeps an agent schedule in conversation until the user views the moved card", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把这个放到明天下午{Enter}");

    await waitFor(() => expect(tracked.current().cards[0].timeConstraint).toMatchObject({
      date: "2026-08-26",
      period: "afternoon",
    }));
    expect(screen.getByRole("button", { name: "对话" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "查看把卡片放在时间围栏外" }));
    expect(screen.getByRole("button", { name: "选择日期页面" })).toHaveTextContent("明天");
    expect(screen.getByRole("article", { name: "卡片：把卡片放在时间围栏外" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("keeps a selected card in place when an agent only adds an exact time", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    const before = { ...tracked.current().placements[0] };
    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把这个改成上午十点{Enter}");

    await waitFor(() => expect(tracked.current().cards[0].timeConstraint).toMatchObject({
      date: "2026-08-25",
      period: "morning",
      startTime: "10:00",
    }));
    expect(tracked.current().placements[0]).toMatchObject({ x: before.x, y: 346 });
  });

  it("keeps selected-card context when the agent renames it and opens the updated result", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把这个标题改成整理桌面{Enter}");

    await waitFor(() => expect(tracked.current().cards[0].title).toBe("整理桌面"));
    expect(screen.getByText("正在处理：整理桌面")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看整理桌面" }));
    expect(screen.getByRole("textbox", { name: "卡片标题" })).toHaveValue("整理桌面");
  });

  it("keeps an uncommitted inspector draft when the agent completes that card", async () => {
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    fireEvent.change(screen.getByRole("textbox", { name: "卡片标题" }), {
      target: { value: "完成前写下的新标题" },
    });
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");

    await waitFor(() => expect(tracked.current().cards[0]).toMatchObject({
      title: "完成前写下的新标题",
      status: "completed",
    }));
  });

  it("shows factual search matches as lightweight view actions", async () => {
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "找报销{Enter}");

    expect(await screen.findByText("找到 2 张相关 Card。")).toBeInTheDocument();
    const results = screen.getByRole("list", { name: "相关卡片" });
    expect(within(results).getAllByRole("button")).toHaveLength(2);
    await user.click(within(results).getByRole("button", { name: /查看提交报销.*今天/ }));
    expect(screen.getByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
  });

  it("uses a card opened from agent results as the next conversation target", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithAgentCards()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "找报销{Enter}");
    const results = await screen.findByRole("list", { name: "相关卡片" });
    await user.click(within(results).getByRole("button", { name: /查看整理报销.*今天/ }));
    expect(screen.getByRole("textbox", { name: "卡片标题" })).toHaveValue("整理报销");

    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("正在处理：整理报销")).toBeInTheDocument();
  });

  it("opens a completed agent result in the completed overview", async () => {
    const completed = workspaceReducer(workspaceWithAgentCards(), {
      type: "toggle-card",
      cardId: "agent-expense-1",
      now: NOW,
    });
    const user = userEvent.setup();
    render(<App repository={trackedRepository(completed).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "找提交报销{Enter}");

    const results = await screen.findByRole("list", { name: "相关卡片" });
    await user.click(within(results).getByRole("button", { name: /查看提交报销.*已完成/ }));

    expect(screen.getByRole("button", { name: /已完成 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("listitem", { name: "已完成卡片：提交报销" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "卡片详情" })).not.toBeInTheDocument();
  });

  it("keeps a completed card as the conversation target after viewing its result", async () => {
    const completed = workspaceReducer(workspaceWithAgentCards(), {
      type: "toggle-card",
      cardId: "agent-expense-1",
      now: NOW,
    });
    const tracked = trackedRepository(completed);
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "找提交报销{Enter}");
    const results = await screen.findByRole("list", { name: "相关卡片" });
    await user.click(within(results).getByRole("button", { name: /查看提交报销.*已完成/ }));

    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个恢复{Enter}");

    await waitFor(() => expect(tracked.current().cards.find((card) => card.id === "agent-expense-1")?.status)
      .toBe("open"));
    expect(tracked.current().cards).toHaveLength(2);
    expect(screen.getByText("恢复了。")) .toBeInTheDocument();
  });

  it("opens one uniquely named card directly from a conversation request", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithAgentCards()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "打开提交报销{Enter}");

    expect(await screen.findByRole("complementary", { name: "卡片详情" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "卡片标题" })).toHaveValue("提交报销");
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("找到了。")).toBeInTheDocument();
  });

  it("shows a real busy state while the model is interpreting", async () => {
    let resolveIntent: ((intent: { type: "create"; title: string; timeConstraint: null }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{ type: "create"; title: string; timeConstraint: null }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "记下等待{Enter}");

    const dialog = screen.getByRole("region", { name: "对话工作区" });
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("正在处理");
    expect(screen.getByRole("textbox", { name: "对话输入" })).not.toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "下一句先写着");
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue("下一句先写着");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    await act(async () => resolveIntent?.({ type: "create", title: "等待完成", timeConstraint: null }));
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
  });

  it("finishes a valid model request after the user switches to canvas", async () => {
    let resolveIntent: ((intent: { type: "create"; title: string; timeConstraint: null }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{ type: "create"; title: string; timeConstraint: null }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository();
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "稍后才回来{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));
    await act(async () => resolveIntent?.({ type: "create", title: "稍后出现", timeConstraint: null }));

    await waitFor(() => expect(tracked.current().cards[0]?.title).toBe("稍后出现"));
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("好，放到随手页了。")).toBeInTheDocument();
  });

  it("keeps a selected-card request valid when only the primary view changes", async () => {
    let resolveIntent: ((intent: {
      type: "set-status";
      target: { kind: "id"; cardId: string };
      status: "completed";
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "set-status";
        target: { kind: "id"; cardId: string };
        status: "completed";
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));
    await act(async () => resolveIntent?.({
      type: "set-status",
      target: { kind: "id", cardId: "today-card" },
      status: "completed",
    }));

    await waitFor(() => expect(tracked.current().cards[0].status).toBe("completed"));
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("完成了。")).toBeInTheDocument();
  });

  it("drops a selected-card request when the user explicitly selects another card", async () => {
    let resolveIntent: ((intent: {
      type: "set-status";
      target: { kind: "id"; cardId: string };
      status: "completed";
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "set-status";
        target: { kind: "id"; cardId: string };
        status: "completed";
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：提交报销" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));
    await user.click(screen.getByRole("button", { name: "打开卡片：整理报销" }));

    await act(async () => {
      resolveIntent?.({
        type: "set-status",
        target: { kind: "id", cardId: "agent-expense-1" },
        status: "completed",
      });
    });

    expect(tracked.current().cards.find((card) => card.id === "agent-expense-1")?.status).toBe("open");
    expect(tracked.current().cards.find((card) => card.id === "agent-expense-2")?.status).toBe("open");
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("当前现场已经变化，这次没有执行。画布没有变化。", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("完成了。"), "stale selected-card action must not execute").not.toBeInTheDocument();
  });

  it("uses the active canvas view for a result that resolves after switching views", async () => {
    let resolveIntent: ((intent: {
      type: "schedule";
      target: { kind: "id"; cardId: string };
      timeConstraint: { date: string; period: "afternoon" };
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "schedule";
        target: { kind: "id"; cardId: string };
        timeConstraint: { date: string; period: "afternoon" };
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "把这个放到下午{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));

    await act(async () => {
      resolveIntent?.({
        type: "schedule",
        target: { kind: "id", cardId: "today-card" },
        timeConstraint: { date: "2026-08-25", period: "afternoon" },
      });
    });

    const card = await screen.findByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    await waitFor(() => expect(card).toHaveClass("is-dropping"));
    expect(tracked.current().cards[0].timeConstraint?.period).toBe("afternoon");
  });

  it("drops a pending result when the visible page context changes", async () => {
    let resolveIntent: ((intent: {
      type: "set-status";
      target: { kind: "id"; cardId: string };
      status: "completed";
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "set-status";
        target: { kind: "id"; cardId: string };
        status: "completed";
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));
    await user.click(screen.getByRole("button", { name: "后一天" }));

    await act(async () => {
      resolveIntent?.({
        type: "set-status",
        target: { kind: "id", cardId: "today-card" },
        status: "completed",
      });
    });

    expect(tracked.current().cards[0].status).toBe("open");
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("当前现场已经变化，这次没有执行。画布没有变化。", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("完成了。")).not.toBeInTheDocument();
  });

  it("drops a pending result even when the page leaves and returns before it resolves", async () => {
    let resolveIntent: ((intent: {
      type: "set-status";
      target: { kind: "id"; cardId: string };
      status: "completed";
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "set-status";
        target: { kind: "id"; cardId: string };
        status: "completed";
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "这个做完了{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));
    await user.click(screen.getByRole("button", { name: "后一天" }));
    await user.click(screen.getByRole("button", { name: "前一天" }));

    await act(async () => {
      resolveIntent?.({
        type: "set-status",
        target: { kind: "id", cardId: "today-card" },
        status: "completed",
      });
    });

    expect(tracked.current().cards[0].status).toBe("open");
    await user.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.getByText("当前现场已经变化，这次没有执行。画布没有变化。", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("完成了。")) .not.toBeInTheDocument();
  });

  it("drops a pending result when the overview status changes", async () => {
    let resolveIntent: ((intent: {
      type: "set-status";
      target: { kind: "id"; cardId: string };
      status: "completed";
    }) => void) | null = null;
    const agentModel = {
      interpret: () => {
        return new Promise<{
          type: "set-status";
          target: { kind: "id"; cardId: string };
          status: "completed";
        }>((resolve) => {
          resolveIntent = resolve;
        });
      },
    };
    const tracked = trackedRepository(workspaceWithAgentCards());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "完成提交报销{Enter}");
    await user.click(screen.getByRole("button", { name: "总览" }));
    await user.click(screen.getByRole("button", { name: /已完成/ }));
    expect(screen.getByRole("button", { name: /已完成/ })).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      resolveIntent?.({
        type: "set-status",
        target: { kind: "id", cardId: "agent-expense-1" },
        status: "completed",
      });
    });

    expect(tracked.current().cards.find((card) => card.id === "agent-expense-1")?.status).toBe("open");
    expect(screen.queryByText("完成了。")).not.toBeInTheDocument();
  });

  it("does not let an in-flight card drag overwrite a completed agent change", async () => {
    let resolveIntent: ((intent: {
      type: "update";
      target: { kind: "id"; cardId: string };
      patch: { title: string };
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "update";
        target: { kind: "id"; cardId: string };
        patch: { title: string };
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "改一下{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));

    const card = screen.getByRole("article", { name: "卡片：把卡片放在时间围栏外" });
    fireEvent.pointerDown(card, { pointerId: 501, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 501, clientX: 180, clientY: 100 });
    expect(card).toHaveClass("is-dragging");

    await act(async () => {
      resolveIntent?.({
        type: "update",
        target: { kind: "id", cardId: "today-card" },
        patch: { title: "Agent 改好的标题" },
      });
    });
    await waitFor(() => expect(tracked.current().cards[0].title).toBe("Agent 改好的标题"));

    fireEvent.pointerUp(window, { pointerId: 501, button: 0, clientX: 180, clientY: 100 });

    await waitFor(() => expect(tracked.saves).toHaveLength(2));
    expect(tracked.current().cards[0].title).toBe("Agent 改好的标题");
    expect(tracked.current().placements[0].x).toBe(400);
  });

  it("does not play a drop animation for a metadata-only agent update", async () => {
    let resolveIntent: ((intent: {
      type: "update";
      target: { kind: "id"; cardId: string };
      patch: { title: string };
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "update";
        target: { kind: "id"; cardId: string };
        patch: { title: string };
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithTodayCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "改一下{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));

    await act(async () => {
      resolveIntent?.({
        type: "update",
        target: { kind: "id", cardId: "today-card" },
        patch: { title: "只改文字" },
      });
    });

    const card = await screen.findByRole("article", { name: "卡片：只改文字" });
    expect(card).not.toHaveClass("is-dropping");
    expect(tracked.current().cards[0].title).toBe("只改文字");
  });

  it("does not let an in-flight area gesture overwrite a completed agent change", async () => {
    let resolveIntent: ((intent: {
      type: "update";
      target: { kind: "id"; cardId: string };
      patch: { title: string };
    }) => void) | null = null;
    const agentModel = {
      interpret: () => new Promise<{
        type: "update";
        target: { kind: "id"; cardId: string };
        patch: { title: string };
      }>((resolve) => {
        resolveIntent = resolve;
      }),
    };
    const tracked = trackedRepository(workspaceWithLooseAreaAndCard());
    const user = userEvent.setup();
    render(<App repository={tracked.repository} now={() => NOW} agentModel={agentModel} />);

    await user.click(await screen.findByRole("button", { name: "打开随手页" }));
    await user.click(screen.getByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "改一下{Enter}");
    await user.click(screen.getByRole("button", { name: "画布" }));

    const moveHandle = screen.getByRole("button", { name: "移动区域：工作草稿" });
    fireEvent.pointerDown(moveHandle, { pointerId: 502, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 502, clientX: 180, clientY: 140 });
    expect(moveHandle.closest(".canvas-area")).toHaveClass("is-transforming");

    await act(async () => {
      resolveIntent?.({
        type: "update",
        target: { kind: "id", cardId: "loose-card" },
        patch: { title: "Agent 改好的随手卡片" },
      });
    });
    await waitFor(() => expect(tracked.current().cards.find((card) => card.id === "loose-card")?.title)
      .toBe("Agent 改好的随手卡片"));

    fireEvent.pointerUp(window, { pointerId: 502, button: 0, clientX: 180, clientY: 140 });

    await waitFor(() => expect(tracked.saves).toHaveLength(2));
    expect(tracked.current().cards.find((card) => card.id === "loose-card")?.title)
      .toBe("Agent 改好的随手卡片");
    expect(tracked.current().areas[0]).toMatchObject({ x: 260, y: 180 });
  });

  it("keeps the short conversation across primary-view switches", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "明天下午交水电费{Enter}");
    await screen.findByText("好，放到明天下午了。");
    await user.click(screen.getByRole("button", { name: "画布" }));
    await user.click(screen.getByRole("button", { name: "对话" }));

    expect(screen.getByText("明天下午交水电费")).toBeInTheDocument();
    expect(screen.getByText("好，放到明天下午了。")).toBeInTheDocument();
  });

  it("keeps a long agent session as a short rolling transcript", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    const dialog = screen.getByRole("region", { name: "对话工作区" });
    for (let index = 1; index <= 5; index += 1) {
      await user.type(input, `记下第${index}件事{Enter}`);
      await within(dialog).findByText(`记下第${index}件事`);
    }

    expect(within(dialog).queryByText("记下第1件事")).not.toBeInTheDocument();
    expect(within(dialog).getByText("记下第5件事")).toBeInTheDocument();
    expect(dialog.querySelectorAll(".canvas-agent-turn")).toHaveLength(8);
  });

  it("keeps an agent undo receipt within the rolling transcript limit", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    const input = screen.getByRole("textbox", { name: "对话输入" });
    const dialog = screen.getByRole("region", { name: "对话工作区" });
    for (let index = 1; index <= 4; index += 1) {
      await user.type(input, `记下第${index}件事{Enter}`);
      await within(dialog).findByText(`记下第${index}件事`);
    }

    const undoButtons = within(dialog).getAllByRole("button", { name: "撤销这次操作" });
    expect(undoButtons).toHaveLength(4);
    await user.click(undoButtons[undoButtons.length - 1]);

    await waitFor(() => {
      expect(dialog.querySelectorAll(".canvas-agent-turn")).toHaveLength(8);
    });
  });

  it("replaces the date picker with conversation instead of stacking two transient papers", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "选择日期页面" }));
    expect(screen.getByRole("dialog", { name: "选择日期页面" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(screen.queryByRole("dialog", { name: "选择日期页面" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
  });

  it("temporarily replaces conversation with the backup menu and restores it on close", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.click(screen.getByRole("button", { name: "打开本地备份菜单" }));

    expect(screen.queryByRole("region", { name: "对话工作区" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "本地备份" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "对话输入" }));
  });

  it("replaces the backup menu with conversation instead of stacking input surfaces", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开本地备份菜单" }));
    expect(screen.getByRole("menu", { name: "本地备份" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(screen.queryByRole("menu", { name: "本地备份" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "对话工作区" })).toBeInTheDocument();
  });

  it("returns from conversation to canvas before opening the date picker", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.click(screen.getByRole("button", { name: "画布" }));
    await user.click(screen.getByRole("button", { name: "选择日期页面" }));

    expect(screen.queryByRole("region", { name: "对话工作区" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "选择日期页面" })).toBeInTheDocument();
  });

  it("does not let Ctrl J replace an agent deletion confirmation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.type(screen.getByRole("textbox", { name: "对话输入" }), "删除把卡片放在时间围栏外{Enter}");
    const confirm = screen.getByRole("dialog", { name: "删除这张卡片？" });

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(confirm).toBeInTheDocument();
    expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "取消" }));
  });

  it("does not let Ctrl J replace a canvas deletion confirmation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository(workspaceWithTodayCard()).repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开卡片：把卡片放在时间围栏外" }));
    await user.click(screen.getByRole("button", { name: "删除卡片" }));
    const confirm = screen.getByRole("dialog", { name: "删除这张卡片？" });

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(confirm).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "画布" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("region", { name: "对话工作区" })).not.toBeInTheDocument();
  });

  it("does not initialize or call an agent model during app startup", async () => {
    const interpret = vi.fn(async () => ({ type: "unsupported", message: "不应调用" } as const));

    render(<App repository={trackedRepository().repository} now={() => NOW} agentModel={{ interpret }} />);

    await screen.findByRole("region", { name: "今天的画布" });
    expect(interpret).not.toHaveBeenCalled();
  });
});

describe("application settings", () => {
  it("opens one settings panel for appearance, Agent, and local data", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "打开设置" }));

    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    expect(within(dialog).getByRole("navigation", { name: "设置分类" })).toHaveTextContent("外观Agent数据");
    expect(within(dialog).getByRole("group", { name: "外观模式" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Agent" }));
    expect(within(dialog).getByLabelText("DeepSeek API Key")).toHaveAttribute("type", "password");
    expect(within(dialog).getByLabelText("模型")).toHaveValue("deepseek-v4-flash");

    await user.click(within(dialog).getByRole("button", { name: "数据" }));
    expect(within(dialog).getByRole("button", { name: "导出本地备份" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "导入本地备份" })).toBeInTheDocument();
  });

  it("opens the settings panel directly on model settings from conversation", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    await user.click(await screen.findByRole("button", { name: "对话" }));
    await user.click(screen.getByRole("button", { name: "打开模型设置" }));

    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    expect(within(dialog).getByRole("button", { name: "Agent" })).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getByLabelText("DeepSeek API Key")).toBeInTheDocument();
  });

  it("closes settings with Escape and restores the opening control", async () => {
    const user = userEvent.setup();
    render(<App repository={trackedRepository().repository} now={() => NOW} />);

    const trigger = await screen.findByRole("button", { name: "打开设置" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "应用设置" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "应用设置" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
