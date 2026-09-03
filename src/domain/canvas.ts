import type { LegacyTask, LegacyTaskPriority } from "./legacyTasks";
import { isLocalDateKey, isTimeConstraint } from "./dates";

export type CardPriority = LegacyTaskPriority;
export type CardStatus = "open" | "completed" | "deleted";
export type TimePeriod = "anytime" | "morning" | "afternoon" | "evening";
export type CanvasPageKey = "loose" | string;

export const LOOSE_PAGE_KEY = "loose" as const;
export const MAIN_CANVAS_ID = "main-canvas";

export function isCanvasPageKey(value: unknown): value is CanvasPageKey {
  return value === LOOSE_PAGE_KEY || isLocalDateKey(value);
}

export interface TimeConstraint {
  date: string;
  period: TimePeriod;
  startTime?: string;
  endTime?: string;
}

export interface Card {
  id: string;
  schemaVersion: 2;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority | null;
  timeConstraint: TimeConstraint | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CardInput {
  title: string;
  notes?: string;
  priority?: CardPriority | null;
  timeConstraint?: TimeConstraint | null;
}

export interface Canvas {
  id: string;
  title: string;
  viewportX: number;
  viewportY: number;
  zoom: number;
  updatedAt: string;
}

export interface CardPlacement {
  cardId: string;
  canvasId: string;
  pageKey: CanvasPageKey;
  x: number;
  y: number;
  zIndex: number;
  areaId: string | null;
  updatedAt: string;
}

export interface Area {
  id: string;
  canvasId: string;
  pageKey: CanvasPageKey;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  schemaVersion: 3;
  canvas: Canvas;
  cards: Card[];
  placements: CardPlacement[];
  areas: Area[];
}

export type WorkspaceAction =
  | { type: "add-card"; card: Card; position: { x: number; y: number }; pageKey?: CanvasPageKey }
  | { type: "move-card"; cardId: string; position: { x: number; y: number }; now: Date }
  | {
      type: "schedule-card";
      cardId: string;
      timeConstraint: TimeConstraint | null;
      position: { x: number; y: number };
      now: Date;
    }
  | { type: "toggle-card"; cardId: string; now: Date }
  | {
      type: "update-card";
      cardId: string;
      patch: Partial<Pick<Card, "title" | "notes" | "priority" | "timeConstraint">>;
      now: Date;
    }
  | { type: "delete-card"; cardId: string; now: Date }
  | {
      type: "update-viewport";
      viewport: { x: number; y: number; zoom: number };
      allowBelowManualLimit?: boolean;
      now: Date;
    }
  | { type: "add-area"; area: Area }
  | {
      type: "update-area";
      areaId: string;
      patch: Partial<Pick<Area, "title" | "x" | "y" | "width" | "height">>;
      now: Date;
    }
  | { type: "remove-area"; areaId: string };

interface CardFactoryContext {
  id?: string;
  now?: Date;
}

export function pageKeyForCard(card: Pick<Card, "timeConstraint">): CanvasPageKey {
  return card.timeConstraint?.date ?? LOOSE_PAGE_KEY;
}

export function createCard(input: CardInput, context: CardFactoryContext = {}): Card {
  const title = input.title.trim();
  if (!title) throw new Error("卡片标题不能为空");
  if (input.timeConstraint !== undefined
    && input.timeConstraint !== null
    && !isTimeConstraint(input.timeConstraint)) throw new Error("卡片时间无效");

  const timestamp = (context.now ?? new Date()).toISOString();
  return {
    id: context.id ?? crypto.randomUUID(),
    schemaVersion: 2,
    title,
    notes: input.notes?.trim() ?? "",
    status: "open",
    priority: input.priority ?? null,
    timeConstraint: input.timeConstraint ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  };
}

export function migrateTasksToWorkspace(tasks: LegacyTask[]): Workspace {
  const updatedAt = tasks.reduce(
    (latest, task) => task.updatedAt > latest ? task.updatedAt : latest,
    new Date(0).toISOString(),
  );

  const cards: Card[] = tasks.map((task) => ({
    id: task.id,
    schemaVersion: 2,
    title: task.title,
    notes: task.notes,
    status: task.status === "completed" ? "completed" : "open",
    priority: task.priority,
    timeConstraint: task.dueDate ? { date: task.dueDate, period: "anytime" } : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  }));

  return {
    schemaVersion: 3,
    canvas: {
      id: MAIN_CANVAS_ID,
      title: "我的画布",
      viewportX: 0,
      viewportY: 0,
      zoom: 1,
      updatedAt,
    },
    cards,
    placements: cards.map((card, index) => ({
      cardId: card.id,
      canvasId: MAIN_CANVAS_ID,
      pageKey: pageKeyForCard(card),
      x: 96 + (index % 3) * 280,
      y: 88 + Math.floor(index / 3) * 180,
      zIndex: index + 1,
      areaId: null,
      updatedAt: card.updatedAt,
    })),
    areas: [],
  };
}

export function createEmptyWorkspace(now = new Date()): Workspace {
  const timestamp = now.toISOString();
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
    cards: [],
    placements: [],
    areas: [],
  };
}

export function fitWorkspaceView(
  workspace: Workspace,
  viewport: { width: number; height: number },
  pageKey?: CanvasPageKey,
): { x: number; y: number; zoom: number } {
  const openIds = new Set(workspace.cards.filter((card) => card.status === "open").map((card) => card.id));
  const bounds = [
    ...workspace.placements
      .filter((placement) => openIds.has(placement.cardId) && (!pageKey || placement.pageKey === pageKey))
      .map((placement) => ({
        left: placement.x,
        top: placement.y,
        right: placement.x + 248,
        bottom: placement.y + 140,
      })),
    ...workspace.areas
      .filter((area) => !pageKey || area.pageKey === pageKey)
      .map((area) => ({
        left: area.x,
        top: area.y,
        right: area.x + area.width,
        bottom: area.y + area.height,
      })),
  ];

  if (bounds.length === 0) {
    return { x: workspace.canvas.viewportX, y: workspace.canvas.viewportY, zoom: workspace.canvas.zoom };
  }

  const padding = 72;
  const left = Math.min(...bounds.map((bound) => bound.left)) - padding;
  const top = Math.min(...bounds.map((bound) => bound.top)) - padding;
  const right = Math.max(...bounds.map((bound) => bound.right)) + padding;
  const bottom = Math.max(...bounds.map((bound) => bound.bottom)) + padding;
  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const width = Math.max(320, viewport.width);
  const height = Math.max(240, viewport.height);

  return {
    x: left,
    y: top,
    zoom: Math.min(1, width / contentWidth, height / contentHeight),
  };
}

export function workspaceReducer(workspace: Workspace, action: WorkspaceAction): Workspace {
  const nextZIndex = workspace.placements.reduce((highest, placement) => Math.max(highest, placement.zIndex), 0) + 1;

  switch (action.type) {
    case "add-card": {
      const pageKey = action.pageKey ?? pageKeyForCard(action.card);
      if (!isCanvasPageKey(pageKey)
        || pageKey !== pageKeyForCard(action.card)
        || workspace.cards.some((card) => card.id === action.card.id)) return workspace;
      return {
        ...workspace,
        cards: [...workspace.cards, action.card],
        placements: [...workspace.placements, {
          cardId: action.card.id,
          canvasId: workspace.canvas.id,
          pageKey,
          x: action.position.x,
          y: action.position.y,
          zIndex: nextZIndex,
          areaId: null,
          updatedAt: action.card.updatedAt,
        }],
      };
    }
    case "move-card": {
      const card = workspace.cards.find((item) => item.id === action.cardId);
      const placement = workspace.placements.find((item) => item.cardId === action.cardId);
      if (!card || !placement) return workspace;
      const areaChanged = placement.areaId !== null;
      const positionChanged = placement.x !== action.position.x || placement.y !== action.position.y;
      if (!areaChanged && !positionChanged) return workspace;
      return {
        ...workspace,
        placements: workspace.placements.map((item) => item.cardId === action.cardId
          ? { ...item, ...action.position, areaId: null, zIndex: nextZIndex, updatedAt: action.now.toISOString() }
          : item),
      };
    }
    case "schedule-card": {
      if (action.timeConstraint !== null && !isTimeConstraint(action.timeConstraint)) return workspace;
      const card = workspace.cards.find((item) => item.id === action.cardId);
      const placement = workspace.placements.find((item) => item.cardId === action.cardId);
      if (!card || !placement) return workspace;
      const timestamp = action.now.toISOString();
      const pageKey = action.timeConstraint?.date ?? LOOSE_PAGE_KEY;
      const constraint = action.timeConstraint;
      const sameConstraint = card.timeConstraint === constraint
        || (card.timeConstraint !== null && constraint !== null
          && card.timeConstraint.date === constraint.date
          && card.timeConstraint.period === constraint.period
          && card.timeConstraint.startTime === constraint.startTime
          && card.timeConstraint.endTime === constraint.endTime);
      if (sameConstraint
        && placement.pageKey === pageKey
        && placement.x === action.position.x
        && placement.y === action.position.y
        && placement.areaId === null) return workspace;
      return {
        ...workspace,
        cards: workspace.cards.map((item) => item.id === action.cardId
          ? { ...item, timeConstraint: action.timeConstraint, updatedAt: timestamp }
          : item),
        placements: workspace.placements.map((item) => item.cardId === action.cardId
          ? { ...item, ...action.position, pageKey, areaId: null, zIndex: nextZIndex, updatedAt: timestamp }
          : item),
      };
    }
    case "toggle-card": {
      const target = workspace.cards.find((card) => card.id === action.cardId);
      if (!target || target.status === "deleted") return workspace;
      return {
        ...workspace,
        cards: workspace.cards.map((card) => {
          if (card.id !== action.cardId) return card;
          const complete = card.status !== "completed";
          return {
            ...card,
            status: complete ? "completed" : "open",
            completedAt: complete ? action.now.toISOString() : null,
            updatedAt: action.now.toISOString(),
          };
        }),
      };
    }
    case "update-card": {
      if (action.patch.timeConstraint !== undefined
        && action.patch.timeConstraint !== null
        && !isTimeConstraint(action.patch.timeConstraint)) return workspace;
      const card = workspace.cards.find((item) => item.id === action.cardId);
      if (!card) return workspace;
      const nextTitle = action.patch.title !== undefined
        ? action.patch.title.trim() || card.title
        : card.title;
      const nextNotes = action.patch.notes !== undefined ? action.patch.notes : card.notes;
      const nextPriority = action.patch.priority !== undefined ? action.patch.priority : card.priority;
      const nextTimeConstraint = action.patch.timeConstraint !== undefined
        ? action.patch.timeConstraint
        : card.timeConstraint;
      const sameTime = card.timeConstraint === nextTimeConstraint
        || (card.timeConstraint !== null && nextTimeConstraint !== null
          && card.timeConstraint.date === nextTimeConstraint.date
          && card.timeConstraint.period === nextTimeConstraint.period
          && card.timeConstraint.startTime === nextTimeConstraint.startTime
          && card.timeConstraint.endTime === nextTimeConstraint.endTime);
      if (card.title === nextTitle
        && card.notes === nextNotes
        && card.priority === nextPriority
        && sameTime) return workspace;
      const timestamp = action.now.toISOString();
      const changesPage = action.patch.timeConstraint !== undefined;
      const pageKey = nextTimeConstraint?.date ?? LOOSE_PAGE_KEY;
      return {
        ...workspace,
        cards: workspace.cards.map((card) => card.id === action.cardId
          ? {
              ...card,
              ...action.patch,
              title: nextTitle,
              notes: nextNotes,
              priority: nextPriority,
              timeConstraint: nextTimeConstraint,
              updatedAt: timestamp,
            }
          : card),
        placements: changesPage
          ? workspace.placements.map((placement) => placement.cardId === action.cardId
            ? { ...placement, pageKey, areaId: null, updatedAt: timestamp }
            : placement)
          : workspace.placements,
      };
    }
    case "delete-card": {
      const target = workspace.cards.find((card) => card.id === action.cardId);
      if (!target || target.status === "deleted") return workspace;
      return {
        ...workspace,
        cards: workspace.cards.map((card) => card.id === action.cardId
          ? { ...card, status: "deleted", updatedAt: action.now.toISOString() }
          : card),
      };
    }
    case "update-viewport":
    {
      const zoom = Math.min(1.8, Math.max(action.allowBelowManualLimit ? 0.05 : 0.5, action.viewport.zoom));
      if (workspace.canvas.viewportX === action.viewport.x
        && workspace.canvas.viewportY === action.viewport.y
        && workspace.canvas.zoom === zoom) return workspace;
      return {
        ...workspace,
        canvas: {
          ...workspace.canvas,
          viewportX: action.viewport.x,
          viewportY: action.viewport.y,
          zoom,
          updatedAt: action.now.toISOString(),
        },
      };
    }
    case "add-area":
      if (action.area.pageKey !== LOOSE_PAGE_KEY
        || action.area.canvasId !== workspace.canvas.id
        || workspace.areas.some((area) => area.id === action.area.id)) return workspace;
      return { ...workspace, areas: [...workspace.areas, action.area] };
    case "update-area": {
      const area = workspace.areas.find((item) => item.id === action.areaId);
      if (!area) return workspace;
      const nextTitle = action.patch.title !== undefined ? action.patch.title.trim() || area.title : area.title;
      const nextX = action.patch.x ?? area.x;
      const nextY = action.patch.y ?? area.y;
      const nextWidth = Math.max(220, action.patch.width ?? area.width);
      const nextHeight = Math.max(120, action.patch.height ?? area.height);
      if (area.title === nextTitle
        && area.x === nextX
        && area.y === nextY
        && area.width === nextWidth
        && area.height === nextHeight) return workspace;
      return {
        ...workspace,
        areas: workspace.areas.map((item) => item.id === action.areaId
          ? {
              ...item,
              ...action.patch,
              title: nextTitle,
              x: nextX,
              y: nextY,
              width: nextWidth,
              height: nextHeight,
              updatedAt: action.now.toISOString(),
            }
          : item),
      };
    }
    case "remove-area":
      if (!workspace.areas.some((area) => area.id === action.areaId)) return workspace;
      return {
        ...workspace,
        areas: workspace.areas.filter((area) => area.id !== action.areaId),
        placements: workspace.placements.map((placement) => placement.areaId === action.areaId
          ? { ...placement, areaId: null }
          : placement),
      };
  }
}
