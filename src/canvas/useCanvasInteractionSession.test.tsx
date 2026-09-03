import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCanvasInteractionSession } from "./useCanvasInteractionSession";

describe("useCanvasInteractionSession", () => {
  it("captures the active pointer on its owner and releases it after commit", () => {
    const commit = vi.fn();

    function Harness() {
      const interaction = useCanvasInteractionSession();
      return (
        <button
          type="button"
          onPointerDown={(event) => interaction.begin({
            kind: "card-drag",
            pointerId: 7,
            owner: event.currentTarget,
            move: () => undefined,
            commit,
            cancel: () => undefined,
          })}
        >
          drag owner
        </button>
      );
    }

    render(<Harness />);
    const owner = screen.getByRole("button", { name: "drag owner" });
    owner.setPointerCapture = vi.fn();
    owner.releasePointerCapture = vi.fn();
    owner.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(owner, { pointerId: 7, button: 0 });
    expect(owner.setPointerCapture).toHaveBeenCalledWith(7);

    const pointerUp = new Event("pointerup");
    Object.defineProperty(pointerUp, "pointerId", { value: 7 });
    window.dispatchEvent(pointerUp);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(owner.releasePointerCapture).toHaveBeenCalledWith(7);

    expect(() => fireEvent.pointerMove(window, {})).not.toThrow();
  });

  it("can defer pointer capture until a gesture becomes intentional", () => {
    const commit = vi.fn();

    function Harness() {
      const interaction = useCanvasInteractionSession();
      return (
        <button
          type="button"
          onPointerDown={(event) => interaction.begin({
            kind: "card-drag",
            pointerId: 8,
            owner: event.currentTarget,
            captureOnBegin: false,
            move: () => undefined,
            commit,
            cancel: () => undefined,
          })}
        >
          click owner
        </button>
      );
    }

    render(<Harness />);
    const owner = screen.getByRole("button", { name: "click owner" });
    owner.setPointerCapture = vi.fn();

    fireEvent.pointerDown(owner, { pointerId: 8, button: 0 });

    expect(owner.setPointerCapture).not.toHaveBeenCalled();
  });
});
