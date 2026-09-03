import {
  createEmptyWorkspace,
  isCanvasPageKey,
  LOOSE_PAGE_KEY,
  migrateTasksToWorkspace,
  type Area,
  type Card,
  type CardPlacement,
  type CardPriority,
  type CardStatus,
  type Canvas,
  type Workspace,
} from "../domain/canvas";
import { isLegacyTask } from "../domain/legacyTasks";
import { isLocalDateKey, isTimeConstraint } from "../domain/dates";

export interface WorkspaceRepository {
  load(): Promise<Workspace>;
  save(workspace: Workspace): Promise<void>;
}

const WORKSPACE_STORAGE_KEY = "citroam.workspace";
const LEGACY_STORAGE_KEY = "notes.tasks";
const LEGACY_STORE_PATH = "notes.store.json";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableDateKey(value: unknown): value is string | null {
  return value === null || isLocalDateKey(value);
}

interface StoredCardV1 {
  id: string;
  schemaVersion: 1;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority | null;
  date: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface StoredPlacementV1 {
  cardId: string;
  canvasId: string;
  x: number;
  y: number;
  zIndex: number;
  areaId: string | null;
  updatedAt: string;
}

interface StoredAreaV2 extends Omit<Area, "pageKey"> {}

interface StoredWorkspaceV1 {
  schemaVersion: 1;
  canvas: Canvas;
  cards: StoredCardV1[];
  placements: StoredPlacementV1[];
  areas: StoredAreaV2[];
}

interface StoredPlacementV2 extends StoredPlacementV1 {
  timeFenceId: string | null;
}

interface StoredTimeFenceV2 {
  id: string;
  canvasId: string;
  date: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredWorkspaceV2 {
  schemaVersion: 2;
  canvas: Canvas;
  cards: Card[];
  placements: StoredPlacementV2[];
  areas: StoredAreaV2[];
  timeFences: StoredTimeFenceV2[];
}

function hasValidCanvas(value: Record<string, unknown>): value is Record<string, unknown> & { canvas: Canvas } {
  const canvas = value.canvas;
  return isRecord(canvas)
    && typeof canvas.id === "string"
    && typeof canvas.title === "string"
    && isFiniteNumber(canvas.viewportX)
    && isFiniteNumber(canvas.viewportY)
    && isFiniteNumber(canvas.zoom)
    && typeof canvas.updatedAt === "string";
}

function isStoredArea(area: unknown, canvasId: string, withPageKey: boolean): boolean {
  return isRecord(area)
    && typeof area.id === "string"
    && area.canvasId === canvasId
    && (!withPageKey || area.pageKey === LOOSE_PAGE_KEY)
    && typeof area.title === "string"
    && isFiniteNumber(area.x)
    && isFiniteNumber(area.y)
    && isFiniteNumber(area.width)
    && isFiniteNumber(area.height)
    && typeof area.createdAt === "string"
    && typeof area.updatedAt === "string";
}

function isStoredCard(card: unknown, schemaVersion: 1 | 2): boolean {
  if (!isRecord(card)
    || card.schemaVersion !== schemaVersion
    || typeof card.id !== "string"
    || typeof card.title !== "string"
    || typeof card.notes !== "string"
    || (card.status !== "open" && card.status !== "completed" && card.status !== "deleted")
    || (card.priority !== null && card.priority !== "low" && card.priority !== "normal" && card.priority !== "high")
    || typeof card.createdAt !== "string"
    || typeof card.updatedAt !== "string"
    || !isNullableString(card.completedAt)) return false;
  return schemaVersion === 1
    ? isNullableDateKey(card.date)
    : card.timeConstraint === null || isTimeConstraint(card.timeConstraint);
}

function isWorkspaceV1(value: unknown): value is StoredWorkspaceV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !hasValidCanvas(value)) return false;
  const canvas = value.canvas;
  if (!Array.isArray(value.cards) || !value.cards.every((card) => isStoredCard(card, 1))) return false;
  if (!Array.isArray(value.areas) || !value.areas.every((area) => isStoredArea(area, canvas.id, false))) return false;
  const cardIds = new Set(value.cards.map((card) => (card as StoredCardV1).id));
  const areaIds = new Set(value.areas.map((area) => (area as StoredAreaV2).id));
  if (cardIds.size !== value.cards.length || areaIds.size !== value.areas.length) return false;
  if (!Array.isArray(value.placements)
    || value.placements.length !== cardIds.size
    || !value.placements.every((placement) => isRecord(placement)
      && typeof placement.cardId === "string"
      && cardIds.has(placement.cardId)
      && placement.canvasId === canvas.id
      && isFiniteNumber(placement.x)
      && isFiniteNumber(placement.y)
      && isFiniteNumber(placement.zIndex)
      && (placement.areaId === null || (typeof placement.areaId === "string" && areaIds.has(placement.areaId)))
      && typeof placement.updatedAt === "string")) return false;
  return new Set(value.placements.map((placement) => (placement as StoredPlacementV1).cardId)).size === cardIds.size;
}

function isWorkspaceV2(value: unknown): value is StoredWorkspaceV2 {
  if (!isRecord(value) || value.schemaVersion !== 2 || !hasValidCanvas(value)) return false;
  const canvas = value.canvas;
  if (!Array.isArray(value.cards) || !value.cards.every((card) => isStoredCard(card, 2))) return false;
  if (!Array.isArray(value.areas) || !value.areas.every((area) => isStoredArea(area, canvas.id, false))) return false;
  if (!Array.isArray(value.timeFences)
    || !value.timeFences.every((fence) => isRecord(fence)
      && typeof fence.id === "string"
      && fence.canvasId === canvas.id
      && isLocalDateKey(fence.date)
      && isFiniteNumber(fence.x)
      && isFiniteNumber(fence.y)
      && isFiniteNumber(fence.width)
      && fence.width > 0
      && isFiniteNumber(fence.height)
      && fence.height > 0
      && typeof fence.collapsed === "boolean"
      && typeof fence.createdAt === "string"
      && typeof fence.updatedAt === "string")) return false;
  const cards = value.cards as Card[];
  const fences = value.timeFences as StoredTimeFenceV2[];
  const cardIds = new Set(cards.map((card) => card.id));
  const areaIds = new Set((value.areas as StoredAreaV2[]).map((area) => area.id));
  const fenceIds = new Set(fences.map((fence) => fence.id));
  if (cardIds.size !== cards.length || areaIds.size !== value.areas.length || fenceIds.size !== fences.length) return false;
  if (!Array.isArray(value.placements)
    || value.placements.length !== cardIds.size
    || !value.placements.every((placement) => {
      if (!isRecord(placement)
        || typeof placement.cardId !== "string"
        || !cardIds.has(placement.cardId)
        || placement.canvasId !== canvas.id
        || !isFiniteNumber(placement.x)
        || !isFiniteNumber(placement.y)
        || !isFiniteNumber(placement.zIndex)
        || (placement.areaId !== null && (typeof placement.areaId !== "string" || !areaIds.has(placement.areaId)))
        || (placement.timeFenceId !== null && (typeof placement.timeFenceId !== "string" || !fenceIds.has(placement.timeFenceId)))
        || typeof placement.updatedAt !== "string") return false;
      if (placement.timeFenceId === null) return true;
      const card = cards.find((item) => item.id === placement.cardId);
      const fence = fences.find((item) => item.id === placement.timeFenceId);
      return card?.timeConstraint?.date === fence?.date;
    })) return false;
  return new Set(value.placements.map((placement) => (placement as StoredPlacementV2).cardId)).size === cardIds.size;
}

function isWorkspaceV3(value: unknown): value is Workspace {
  if (!isRecord(value)
    || value.schemaVersion !== 3
    || "timeFences" in value
    || !hasValidCanvas(value)) return false;
  const canvas = value.canvas;
  if (!Array.isArray(value.cards) || !value.cards.every((card) => isStoredCard(card, 2))) return false;
  if (!Array.isArray(value.areas) || !value.areas.every((area) => isStoredArea(area, canvas.id, true))) return false;
  const cards = value.cards as Card[];
  const areas = value.areas as Area[];
  const cardIds = new Set(cards.map((card) => card.id));
  const areaIds = new Set(areas.map((area) => area.id));
  if (cardIds.size !== cards.length || areaIds.size !== areas.length) return false;
  if (!Array.isArray(value.placements)
    || value.placements.length !== cardIds.size
    || !value.placements.every((placement) => {
      if (!isRecord(placement)
        || "timeFenceId" in placement
        || typeof placement.cardId !== "string"
        || !cardIds.has(placement.cardId)
        || placement.canvasId !== canvas.id
        || !isCanvasPageKey(placement.pageKey)
        || !isFiniteNumber(placement.x)
        || !isFiniteNumber(placement.y)
        || !isFiniteNumber(placement.zIndex)
        || (placement.areaId !== null && (typeof placement.areaId !== "string" || !areaIds.has(placement.areaId)))
        || typeof placement.updatedAt !== "string") return false;
      const card = cards.find((item) => item.id === placement.cardId);
      if (!card || placement.pageKey !== (card.timeConstraint?.date ?? LOOSE_PAGE_KEY)) return false;
      if (placement.areaId === null) return true;
      return areas.find((area) => area.id === placement.areaId)?.pageKey === placement.pageKey;
    })) return false;
  return new Set(value.placements.map((placement) => (placement as CardPlacement).cardId)).size === cardIds.size;
}

function migrateWorkspaceV1(workspace: StoredWorkspaceV1): Workspace {
  const cards: Card[] = workspace.cards.map((card) => ({
    id: card.id,
    schemaVersion: 2,
    title: card.title,
    notes: card.notes,
    status: card.status,
    priority: card.priority,
    timeConstraint: card.date ? { date: card.date, period: "anytime" } : null,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    completedAt: card.completedAt,
  }));
  return {
    schemaVersion: 3,
    canvas: workspace.canvas,
    cards,
    placements: workspace.placements.map((placement) => {
      const card = cards.find((item) => item.id === placement.cardId);
      return { ...placement, areaId: null, pageKey: card?.timeConstraint?.date ?? LOOSE_PAGE_KEY };
    }),
    areas: workspace.areas.map((area) => ({ ...area, pageKey: LOOSE_PAGE_KEY })),
  };
}

function migrateWorkspaceV2(workspace: StoredWorkspaceV2): Workspace {
  const fences = new Map(workspace.timeFences.map((fence) => [fence.id, fence]));
  const cards = workspace.cards;
  return {
    schemaVersion: 3,
    canvas: workspace.canvas,
    cards,
    placements: workspace.placements.map(({ timeFenceId, ...placement }) => {
      const card = cards.find((item) => item.id === placement.cardId);
      const fence = timeFenceId ? fences.get(timeFenceId) : undefined;
      const pageKey = card?.timeConstraint?.date ?? LOOSE_PAGE_KEY;
      if (!fence) return { ...placement, areaId: pageKey === LOOSE_PAGE_KEY ? placement.areaId : null, pageKey };
      return {
        ...placement,
        pageKey,
        areaId: null,
        x: 96 + Math.max(0, Math.min(fence.width - 280, placement.x - fence.x)),
        y: 120 + Math.max(0, Math.min(fence.height - 180, placement.y - fence.y)),
      };
    }),
    areas: workspace.areas.map((area) => ({ ...area, pageKey: LOOSE_PAGE_KEY })),
  };
}

function readWorkspace(value: unknown): Workspace | null {
  if (isWorkspaceV3(value)) return value;
  if (isWorkspaceV2(value)) return migrateWorkspaceV2(value);
  if (isWorkspaceV1(value)) return migrateWorkspaceV1(value);
  return null;
}

export function parseWorkspaceDocument(value: unknown): Workspace {
  const workspace = readWorkspace(value);
  if (!workspace) throw new Error("无法读取本地画布");
  return workspace;
}

function parseStoredValue(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("无法读取本地画布");
  }
}

export function createWorkspaceRepository(): WorkspaceRepository {
  if (!isTauriRuntime()) {
    return {
      async load() {
        const storedWorkspaceValue = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (storedWorkspaceValue !== null) {
          const workspace = readWorkspace(parseStoredValue(storedWorkspaceValue));
          if (workspace) return workspace;
          throw new Error("无法读取本地画布");
        }

        const legacyTaskValue = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyTaskValue === null) return createEmptyWorkspace();
        const legacyTasks = parseStoredValue(legacyTaskValue);
        if (!Array.isArray(legacyTasks) || !legacyTasks.every(isLegacyTask)) throw new Error("无法读取旧版待办");
        return migrateTasksToWorkspace(legacyTasks);
      },
      async save(workspace) {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
      },
    };
  }

  let storePromise: ReturnType<typeof import("@tauri-apps/plugin-store")["load"]> | null = null;
  const getStore = async () => {
    if (!storePromise) {
      const { load } = await import("@tauri-apps/plugin-store");
      storePromise = load(LEGACY_STORE_PATH, { autoSave: false, defaults: {} });
    }
    return storePromise;
  };

  return {
    async load() {
      const store = await getStore();
      const storedWorkspace = await store.get<unknown>(WORKSPACE_STORAGE_KEY);
      const workspace = readWorkspace(storedWorkspace);
      if (workspace) return workspace;
      if (storedWorkspace !== null && storedWorkspace !== undefined) throw new Error("无法读取本地画布");

      const legacyTasks = await store.get<unknown>(LEGACY_STORAGE_KEY);
      if (legacyTasks === null || legacyTasks === undefined) return createEmptyWorkspace();
      if (!Array.isArray(legacyTasks) || !legacyTasks.every(isLegacyTask)) throw new Error("无法读取旧版待办");
      return migrateTasksToWorkspace(legacyTasks);
    },
    async save(workspace) {
      const store = await getStore();
      await store.set(WORKSPACE_STORAGE_KEY, workspace);
      await store.save();
    },
  };
}
