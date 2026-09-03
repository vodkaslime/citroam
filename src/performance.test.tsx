import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "./App";
import type { WorkspaceRepository } from "./data/workspaceRepository";
import {
  MAIN_CANVAS_ID,
  type Card,
  type CardPlacement,
  type CanvasPageKey,
  type Workspace,
} from "./domain/canvas";

const NOW = new Date("2026-08-25T09:00:00+08:00");
const DATE_PAGES = [
  "2026-08-25",
  "2026-08-26",
  "2026-08-24",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
] as const;

const PERFORMANCE_BUDGET_MS = {
  capture: 40,
  pageFlip: 40,
  cardDrop: 40,
  search: 30,
  overview: 80,
} as const;

function largeWorkspace(cardCount = 1_000): Workspace {
  const timestamp = NOW.toISOString();
  const cards: Card[] = [];
  const placements: CardPlacement[] = [];

  for (let index = 0; index < cardCount; index += 1) {
    const pageKey: CanvasPageKey = index % 8 === 7
      ? "loose"
      : DATE_PAGES[index % DATE_PAGES.length];
    const status = index >= 900 ? "deleted" : index >= 800 ? "completed" : "open";
    const period = (["anytime", "morning", "afternoon", "evening"] as const)[index % 4];
    cards.push({
      id: `performance-card-${index}`,
      schemaVersion: 2,
      title: index === 721 ? "唯一的柚子针线" : `生活卡片 ${index + 1}`,
      notes: index % 11 === 0 ? `第 ${index + 1} 张卡片的补充内容` : "",
      status,
      priority: index % 9 === 0 ? "high" : index % 5 === 0 ? "normal" : null,
      timeConstraint: pageKey === "loose" ? null : { date: pageKey, period },
      createdAt: new Date(NOW.getTime() + index * 1_000).toISOString(),
      updatedAt: timestamp,
      completedAt: status === "completed" ? timestamp : null,
    });
    placements.push({
      cardId: `performance-card-${index}`,
      canvasId: MAIN_CANVAS_ID,
      pageKey,
      x: 150 + (index % 4) * 270,
      y: 170 + (index % 12) * 118,
      zIndex: index + 1,
      areaId: null,
      updatedAt: timestamp,
    });
  }

  return {
    schemaVersion: 3,
    canvas: {
      id: MAIN_CANVAS_ID,
      title: "我的画布",
      viewportX: 0,
      viewportY: 0,
      zoom: 1,
      updatedAt: timestamp,
    },
    cards,
    placements,
    areas: [],
  };
}

function memoryRepository(initial: Workspace) {
  let current = initial;
  return {
    repository: {
      load: async () => current,
      save: async (workspace) => {
        current = workspace;
      },
    } satisfies WorkspaceRepository,
    current: () => current,
  };
}

describe("1,000-card interaction performance", () => {
  it("keeps capture, page flip, card drop, search, and overview inside direct-operation budgets", async () => {
    const tracked = memoryRepository(largeWorkspace());
    const renderDurations: number[] = [];
    const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
      renderDurations.push(actualDuration);
    };
    const measure = async (action: () => void) => {
      renderDurations.length = 0;
      await act(async () => {
        action();
        await Promise.resolve();
        await Promise.resolve();
      });
      return renderDurations.reduce((total, duration) => total + duration, 0);
    };

    render(
      <Profiler id="citroam-performance" onRender={onRender}>
        <App repository={tracked.repository} now={() => NOW} />
      </Profiler>,
    );
    expect(await screen.findByRole("region", { name: "今天的画布" })).toBeInTheDocument();

    const captureInput = screen.getByRole("textbox", { name: "快速记录卡片" });
    fireEvent.change(captureInput, { target: { value: "规模测试中新记下的事情" } });
    const capture = await measure(() => fireEvent.submit(captureInput.closest("form")!));
    expect(tracked.current().cards).toHaveLength(1_001);

    const pageFlip = await measure(() => fireEvent.click(screen.getByRole("button", { name: "后一天" })));
    expect(screen.getByRole("region", { name: "明天的画布" })).toBeInTheDocument();

    await measure(() => fireEvent.click(screen.getByRole("button", { name: "前一天" })));
    const draggable = document.querySelector<HTMLElement>('[data-card-id="performance-card-0"]')!;
    const cardDrop = await measure(() => {
      fireEvent.pointerDown(draggable, { pointerId: 901, button: 0, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(window, { pointerId: 901, clientX: 260, clientY: 250 });
      fireEvent.pointerUp(window, { pointerId: 901, clientX: 260, clientY: 250 });
    });
    expect(tracked.current().placements[0]).toMatchObject({ x: 210, pageKey: "2026-08-25" });

    fireEvent.click(screen.getByRole("button", { name: "搜索卡片" }));
    const search = await measure(() => fireEvent.change(screen.getByRole("searchbox", { name: "搜索卡片" }), {
      target: { value: "柚子针线" },
    }));
    expect(screen.getByRole("option", { name: /唯一的柚子针线/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭搜索" }));

    const overview = await measure(() => fireEvent.click(screen.getByRole("button", { name: "总览" })));
    expect(screen.getByRole("region", { name: "卡片总览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /未完成 801/ })).toBeInTheDocument();
    const firstOverviewBatch = screen.getAllByRole("listitem", { name: /未完成卡片/ }).length;
    expect(firstOverviewBatch).toBeLessThanOrEqual(100);
    fireEvent.click(screen.getByRole("button", { name: "显示更多卡片" }));
    expect(screen.getAllByRole("listitem", { name: /未完成卡片/ }).length).toBeGreaterThan(firstOverviewBatch);

    const measurements = { capture, pageFlip, cardDrop, search, overview };
    const context = `render durations: ${JSON.stringify(measurements)}`;
    expect.soft(capture, context).toBeLessThan(PERFORMANCE_BUDGET_MS.capture);
    expect.soft(pageFlip, context).toBeLessThan(PERFORMANCE_BUDGET_MS.pageFlip);
    expect.soft(cardDrop, context).toBeLessThan(PERFORMANCE_BUDGET_MS.cardDrop);
    expect.soft(search, context).toBeLessThan(PERFORMANCE_BUDGET_MS.search);
    expect.soft(overview, context).toBeLessThan(PERFORMANCE_BUDGET_MS.overview);
  }, 20_000);

  it("continues the overview when the end of the current batch enters the scroll range", async () => {
    let callback: IntersectionObserverCallback | null = null;
    let observedTarget: Element | null = null;
    let observerInstance: IntersectionObserver | null = null;
    class TestIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];

      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
        observerInstance = this as unknown as IntersectionObserver;
      }

      observe(target: Element) {
        observedTarget = target;
      }

      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    }

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    try {
      render(<App repository={memoryRepository(largeWorkspace(130)).repository} now={() => NOW} />);
      expect(await screen.findByRole("region", { name: "今天的画布" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "总览" }));

      const firstBatch = screen.getAllByRole("listitem", { name: /未完成卡片/ }).length;
      expect(firstBatch).toBeLessThan(130);
      act(() => {
        callback?.(
          [{ isIntersecting: true, target: observedTarget } as IntersectionObserverEntry],
          observerInstance!,
        );
      });
      await waitFor(() => {
        expect(screen.getAllByRole("listitem", { name: /未完成卡片/ }).length).toBeGreaterThan(firstBatch);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
