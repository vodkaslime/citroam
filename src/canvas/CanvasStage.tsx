import type { PointerEventHandler, ReactNode, Ref, WheelEventHandler } from "react";
import { CornersOut, Minus, Plus, WarningCircle } from "@phosphor-icons/react";
import type { Workspace } from "../domain/canvas";

interface CanvasStageProps {
  workspace: Workspace | null;
  loadFailed: boolean;
  locating: boolean;
  worldTransform: string | null;
  visibleZoom: number;
  canFit: boolean;
  allowArea: boolean;
  stageRef: Ref<HTMLDivElement>;
  worldRef: Ref<HTMLDivElement>;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onZoom: (direction: -1 | 1) => void;
  onFit: () => void;
  onAddArea: () => void;
  onRetryLoad: () => void;
  children: ReactNode;
}

export function CanvasStage({
  workspace,
  loadFailed,
  locating,
  worldTransform,
  visibleZoom,
  canFit,
  allowArea,
  stageRef,
  worldRef,
  onWheel,
  onPointerDown,
  onZoom,
  onFit,
  onAddArea,
  onRetryLoad,
  children,
}: CanvasStageProps) {
  return (
    <div
      className="canvas-stage"
      ref={stageRef}
      role="region"
      aria-label="画布操作区"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
    >
      {workspace && (
        <div className="canvas-controls" role="group" aria-label="画布导航">
          <button type="button" aria-label="缩小画布" title="缩小画布" onClick={() => onZoom(-1)} disabled={visibleZoom <= 0.5}><Minus size={15} /></button>
          <span data-testid="canvas-zoom">{Math.round(visibleZoom * 100)}%</span>
          <button type="button" aria-label="放大画布" title="放大画布" onClick={() => onZoom(1)} disabled={visibleZoom >= 1.8}><Plus size={15} /></button>
          <button type="button" aria-label="看全本页" title="看全本页" onClick={onFit} disabled={!canFit}><CornersOut size={15} /><span>看全本页</span></button>
          {allowArea && <button type="button" aria-label="新建区域" title="新建区域" onClick={onAddArea}><Plus size={15} /><span>区域</span></button>}
        </div>
      )}
      {!workspace && loadFailed ? (
        <div className="canvas-load-error" role="alert">
          <WarningCircle size={22} />
          <h1>没能打开本地内容</h1>
          <p>内容仍保留在设备上。citroam 不会用空画布覆盖它。</p>
          <button type="button" aria-label="重新打开本地内容" onClick={onRetryLoad}>重新打开</button>
        </div>
      ) : !workspace ? (
        <div className="canvas-loading" aria-label="正在加载画布"><span /><span /><span /></div>
      ) : (
        <div
          className={`canvas-world${locating ? " is-locating" : ""}`}
          ref={worldRef}
          aria-label="画布内容"
          style={{ transform: worldTransform ?? undefined }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
