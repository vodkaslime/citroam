import type { PointerEvent as ReactPointerEvent } from "react";
import { memo } from "react";
import type { Card, CardPlacement, CardPriority } from "../domain/canvas";
import { formatTimeWithinDatePage } from "../domain/dates";

export type CanvasCardMotion = "entering" | "dropping" | "locating";

interface CanvasCardProps {
  card: Card;
  placement: CardPlacement;
  selected: boolean;
  completing: boolean;
  motion: CanvasCardMotion | null;
  inlineEditing: boolean;
  inlineTitleDraft: string;
  onArticleRef: (cardId: string, element: HTMLElement | null) => void;
  onOpenRef: (cardId: string, element: HTMLButtonElement | null) => void;
  onBeginDrag: (
    event: ReactPointerEvent<HTMLElement>,
    cardId: string,
    placement: { x: number; y: number },
  ) => void;
  onToggle: (cardId: string) => void;
  onInlineTitleChange: (cardId: string, value: string) => void;
  onCommitInlineTitle: (cardId: string, restoreFocus?: boolean) => void;
  onCancelInlineTitle: (cardId: string) => void;
  onOpen: (cardId: string) => void;
  onStartInlineEdit: (cardId: string) => void;
}

function CanvasCardComponent({
  card,
  placement,
  selected,
  completing,
  motion,
  inlineEditing,
  inlineTitleDraft,
  onArticleRef,
  onOpenRef,
  onBeginDrag,
  onToggle,
  onInlineTitleChange,
  onCommitInlineTitle,
  onCancelInlineTitle,
  onOpen,
  onStartInlineEdit,
}: CanvasCardProps) {
  const timeLabel = card.timeConstraint ? formatTimeWithinDatePage(card.timeConstraint) : "";

  return (
    <article
      className={`canvas-card${selected ? " is-selected" : ""}${completing ? " is-completing" : ""}${motion ? ` is-${motion}` : ""}`}
      aria-label={`卡片：${card.title}`}
      data-card-id={card.id}
      ref={(element) => onArticleRef(card.id, element)}
      style={{ left: placement.x, top: placement.y, zIndex: selected || motion === "locating" ? 100000 : placement.zIndex }}
      onPointerDown={(event) => onBeginDrag(event, card.id, placement)}
    >
      <button
        className="canvas-card-complete"
        type="button"
        aria-label={`完成卡片：${card.title}`}
        title="完成"
        disabled={completing}
        onClick={() => onToggle(card.id)}
      >
      </button>
      {inlineEditing ? (
        <div className="canvas-card-inline-edit">
          <input
            type="text"
            aria-label={`就地编辑卡片：${card.title}`}
            value={inlineTitleDraft}
            autoFocus
            onChange={(event) => onInlineTitleChange(card.id, event.target.value)}
            onBlur={(event) => {
              if (event.currentTarget.dataset.cancelled !== "true"
                && event.currentTarget.dataset.committed !== "true") onCommitInlineTitle(card.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.dataset.committed = "true";
                onCommitInlineTitle(card.id, true);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.dataset.cancelled = "true";
                onCancelInlineTitle(card.id);
              }
            }}
          />
        </div>
      ) : (
        <button
          className="canvas-card-open"
          type="button"
          aria-label={`打开卡片：${card.title}`}
          ref={(element) => onOpenRef(card.id, element)}
          onClick={() => onOpen(card.id)}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartInlineEdit(card.id);
          }}
        >
          <p>{card.title}</p>
          {(timeLabel || card.priority || card.notes) && (
            <span className="canvas-card-meta">
              {timeLabel && (
                <span className="is-time">◷ {timeLabel}</span>
              )}
              {card.priority && (
                <span>⚑ {
                  ({ high: "高", normal: "中", low: "低" } satisfies Record<CardPriority, string>)[card.priority]
                }</span>
              )}
              {card.notes && <span>✎ 备注</span>}
            </span>
          )}
        </button>
      )}
    </article>
  );
}

export const CanvasCard = memo(CanvasCardComponent);
