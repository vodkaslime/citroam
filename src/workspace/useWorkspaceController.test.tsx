import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRepository } from "../data/workspaceRepository";
import { createCard, createEmptyWorkspace, workspaceReducer, type Workspace } from "../domain/canvas";
import { useWorkspaceController } from "./useWorkspaceController";

const NOW = new Date("2026-08-24T09:00:00+08:00");

function repositoryWithSaves(initial: Workspace) {
  const saves: Workspace[] = [];
  const repository: WorkspaceRepository = {
    load: async () => initial,
    save: async (workspace) => {
      saves.push(workspace);
    },
  };
  return { repository, saves };
}

describe("useWorkspaceController", () => {
  it("commits one undoable workspace change with exactly one save", async () => {
    const initial = createEmptyWorkspace(NOW);
    const tracked = repositoryWithSaves(initial);
    const { result } = renderHook(() => useWorkspaceController(tracked.repository));
    await waitFor(() => expect(result.current.workspace).toEqual(initial));
    const card = createCard({ title: "提交周报" }, { id: "card-1", now: NOW });
    const next = workspaceReducer(initial, {
      type: "add-card",
      card,
      position: { x: 120, y: 100 },
    });

    act(() => result.current.commit(next, { undo: true }));

    expect(result.current.workspace).toEqual(next);
    expect(result.current.undoCount).toBe(1);
    await waitFor(() => expect(tracked.saves).toEqual([next]));
  });

  it("restores the previous workspace through the same save pipeline", async () => {
    const initial = createEmptyWorkspace(NOW);
    const tracked = repositoryWithSaves(initial);
    const { result } = renderHook(() => useWorkspaceController(tracked.repository));
    await waitFor(() => expect(result.current.workspace).toEqual(initial));
    const next = workspaceReducer(initial, {
      type: "add-card",
      card: createCard({ title: "提交周报" }, { id: "card-1", now: NOW }),
      position: { x: 120, y: 100 },
    });
    act(() => result.current.commit(next, { undo: true }));
    await waitFor(() => expect(tracked.saves).toHaveLength(1));
    tracked.saves.length = 0;

    let restored: Workspace | null = null;
    act(() => {
      restored = result.current.undo();
    });

    expect(restored).toEqual(initial);
    expect(result.current.workspace).toEqual(initial);
    expect(result.current.undoCount).toBe(0);
    await waitFor(() => expect(tracked.saves).toEqual([initial]));
  });

  it("coalesces rapid debounced workspace commits into the final save", async () => {
    const initial = createEmptyWorkspace(NOW);
    const tracked = repositoryWithSaves(initial);
    const { result } = renderHook(() => useWorkspaceController(tracked.repository));
    await waitFor(() => expect(result.current.workspace).toEqual(initial));
    vi.useFakeTimers();
    try {
      const first = workspaceReducer(initial, {
        type: "update-viewport",
        viewport: { x: 10, y: 0, zoom: 1 },
        now: NOW,
      });
      const second = workspaceReducer(first, {
        type: "update-viewport",
        viewport: { x: 20, y: 0, zoom: 1 },
        now: NOW,
      });

      await act(async () => {
        result.current.commit(first, { persistence: "debounced" });
        result.current.commit(second, { persistence: "debounced" });
        await Promise.resolve();
      });
      expect(tracked.saves).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(tracked.saves).toEqual([second]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a pending debounced save behind an in-flight save on unmount", async () => {
    const initial = createEmptyWorkspace(NOW);
    const saves: Workspace[] = [];
    let resolveFirst: (() => void) | null = null;
    let first = true;
    const repository: WorkspaceRepository = {
      load: async () => initial,
      save: async (workspace) => {
        saves.push(workspace);
        if (first) {
          first = false;
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
      },
    };
    let unmount: (() => void) | null = null;
    try {
      const rendered = renderHook(() => useWorkspaceController(repository));
      const { result } = rendered;
      await waitFor(() => expect(result.current.workspace).toEqual(initial));
      unmount = rendered.unmount;
      vi.useFakeTimers();
      const firstChange = workspaceReducer(initial, {
        type: "update-viewport",
        viewport: { x: 10, y: 0, zoom: 1 },
        now: NOW,
      });
      const latestChange = workspaceReducer(firstChange, {
        type: "update-viewport",
        viewport: { x: 20, y: 0, zoom: 1 },
        now: NOW,
      });

      act(() => {
        result.current.commit(firstChange);
        result.current.commit(latestChange, { persistence: "debounced" });
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(saves).toEqual([firstChange]);

      unmount();
      expect(saves).toEqual([firstChange]);

      await act(async () => {
        resolveFirst?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(saves).toEqual([firstChange, latestChange]);
    } finally {
      if (unmount) unmount();
      vi.useRealTimers();
    }
  });

  it("retries a failed workspace load without creating a fake empty canvas", async () => {
    const initial = createEmptyWorkspace(NOW);
    let attempts = 0;
    const repository: WorkspaceRepository = {
      load: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("unreadable");
        return initial;
      },
      save: async () => undefined,
    };
    const { result } = renderHook(() => useWorkspaceController(repository));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.workspace).toBeNull();

    await act(async () => {
      await result.current.retryLoad();
    });

    expect(result.current.workspace).toEqual(initial);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.saveState).toBe("saved");
  });

  it("retries the latest in-memory workspace after a save failure", async () => {
    const initial = createEmptyWorkspace(NOW);
    const successfulSaves: Workspace[] = [];
    let attempts = 0;
    const repository: WorkspaceRepository = {
      load: async () => initial,
      save: async (workspace) => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk unavailable");
        successfulSaves.push(workspace);
      },
    };
    const { result } = renderHook(() => useWorkspaceController(repository));
    await waitFor(() => expect(result.current.workspace).toEqual(initial));
    const next = workspaceReducer(initial, {
      type: "update-viewport",
      viewport: { x: 40, y: 20, zoom: 1 },
      now: NOW,
    });
    act(() => result.current.commit(next));
    await waitFor(() => expect(result.current.saveState).toBe("error"));

    act(() => result.current.retrySave());

    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    expect(attempts).toBe(2);
    expect(successfulSaves).toEqual([next]);
  });
});
