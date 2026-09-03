import type { PointerEvent as ReactPointerEvent } from "react";
import { CornersOut, DotsSixVertical } from "@phosphor-icons/react";
import type { Area } from "../domain/canvas";

interface CanvasAreaProps {
  area: Area;
  selected: boolean;
  entering: boolean;
  onMoveRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onBeginGesture: (
    event: ReactPointerEvent<HTMLButtonElement>,
    area: Area,
    mode: "move" | "resize",
  ) => void;
}

export function CanvasArea({
  area,
  selected,
  entering,
  onMoveRef,
  onSelect,
  onBeginGesture,
}: CanvasAreaProps) {
  return (
    <section
      className={`canvas-area${selected ? " is-selected" : ""}${entering ? " is-entering" : ""}`}
      role="region"
      aria-label={`区域：${area.title}`}
      data-area-id={area.id}
      style={{ left: area.x, top: area.y, width: area.width, height: area.height }}
      onClick={onSelect}
    >
      <button
        className="canvas-area-move"
        ref={onMoveRef}
        type="button"
        aria-label={`移动区域：${area.title}`}
        onPointerDown={(event) => onBeginGesture(event, area, "move")}
      >
        <DotsSixVertical size={15} />
        <span>{area.title}</span>
      </button>
      <button
        className="canvas-area-resize"
        type="button"
        aria-label={`调整区域大小：${area.title}`}
        onPointerDown={(event) => onBeginGesture(event, area, "resize")}
      >
        <CornersOut size={13} />
      </button>
    </section>
  );
}
