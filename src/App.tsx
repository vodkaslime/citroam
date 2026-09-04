import {
  type CompositionEvent as ReactCompositionEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUp,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  Circle,
  CirclesThreePlus,
  CornersOut,
  DownloadSimple,
  Flag,
  GearSix,
  HardDrive,
  MagnifyingGlass,
  Moon,
  NotePencil,
  Plus,
  Sun,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { WorkspaceRepository } from "./data/workspaceRepository";
import {
  createCard,
  fitWorkspaceView,
  LOOSE_PAGE_KEY,
  workspaceReducer,
  type Area,
  type CanvasPageKey,
  type Card,
  type CardPriority,
  type TimeConstraint,
  type TimePeriod,
  type Workspace,
} from "./domain/canvas";
import {
  addLocalDays,
  formatAbsoluteDateLabel,
  formatTimeConstraint,
  formatWeekdayLabel,
  getLocalDateKey,
  parseQuickTimeToken,
  periodForTime,
} from "./domain/dates";
import { parseWorkspaceDocument } from "./data/workspaceRepository";
import { CanvasArea } from "./canvas/CanvasArea";
import { CanvasCard, type CanvasCardMotion } from "./canvas/CanvasCard";
import { CanvasDatePage, CanvasLoosePage } from "./canvas/CanvasDatePage";
import { CanvasStage } from "./canvas/CanvasStage";
import {
  clampCardToDatePage,
  DATE_PAGE_CARD_SIZE,
  DATE_PAGE_PERIOD_BOUNDS,
  DAY_PAGE_BOUNDS,
  fitDatePageView,
  periodAtDatePagePosition,
  suggestDatePagePosition,
} from "./canvas/pageGeometry";
import { useCanvasInteractionSession } from "./canvas/useCanvasInteractionSession";
import { useWorkspaceController } from "./workspace/useWorkspaceController";
import { useFocusTrap } from "./ui/useFocusTrap";
import {
  executeAgentPlan,
  localAgentModel,
  prepareAgentPlan,
  retargetAgentIntent,
  type AgentCandidate,
  type AgentModel,
  type AgentPlan,
} from "./agent/agentCore";
import { harnessAgentModel } from "./agent/harnessAgent";
import { SettingsPanel, type SettingsSection } from "./settings/SettingsPanel";
import { createSettingsRepository, type SettingsRepository } from "./settings/settingsRepository";

const defaultSettingsRepository = createSettingsRepository();

export interface AppProps {
  repository: WorkspaceRepository;
  now?: () => Date;
  agentModel?: AgentModel;
  settingsRepository?: SettingsRepository;
}

type AppView = "canvas" | "overview";
type OverviewStatus = "open" | "completed";
type PageDirection = "forward" | "backward" | "still";
type QuickToken = string;

interface DatePresentation {
  eyebrow: string;
  title: string;
  ariaLabel: string;
  captureLabel: string;
}

interface DragState {
  cardId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
  element: HTMLElement;
}

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface TouchPoint {
  clientX: number;
  clientY: number;
}

interface TouchPinchState {
  startDistance: number;
  anchorWorldX: number;
  anchorWorldY: number;
}

interface TouchCanvasGesture {
  owner: HTMLElement;
  pointerStart: TouchPoint;
  pointers: Map<number, TouchPoint>;
  startViewport: { x: number; y: number; zoom: number };
  currentViewport: { x: number; y: number; zoom: number };
  pinch: TouchPinchState | null;
  sourceAreaId: string | null;
  moved: boolean;
  finish: (cancelled: boolean) => void;
}

interface TouchCardDragSeed {
  pointerId: number;
  point: TouchPoint;
}

interface DragPreview {
  cardId: string;
  period: TimePeriod | null;
  position: { x: number; y: number };
}

interface AgentReceipt {
  cardIds: string[];
  undoDepth: number;
  undone: boolean;
  beforeWorkspace: Workspace;
  afterWorkspace: Workspace;
}

interface AgentTurn {
  id: number;
  role: "user" | "agent";
  message: string;
  receipt?: AgentReceipt;
  candidates?: AgentCandidate[];
  action?: {
    type: "open-overview";
    status: OverviewStatus;
  };
}

interface CanvasCardActionHandlers {
  beginDrag: (
    event: ReactPointerEvent<HTMLElement>,
    cardId: string,
    placement: { x: number; y: number },
  ) => void;
  toggle: (cardId: string) => void;
  inlineTitleChange: (cardId: string, value: string) => void;
  commitInlineTitle: (cardId: string, restoreFocus?: boolean) => void;
  cancelInlineTitle: (cardId: string) => void;
  open: (cardId: string) => void;
  startInlineEdit: (cardId: string) => void;
  registerArticle: (cardId: string, element: HTMLElement | null) => void;
  registerOpen: (cardId: string, element: HTMLButtonElement | null) => void;
}

const quickOptions = [
  { token: "#今天", description: "放到今天这一页", kind: "date" },
  { token: "#明天", description: "放到明天这一页", kind: "date" },
  { token: "#今天上午", description: "放进今天上午", kind: "date" },
  { token: "#今天下午", description: "放进今天下午", kind: "date" },
  { token: "#今天晚上", description: "放进今天晚上", kind: "date" },
  { token: "#明天上午", description: "放进明天上午", kind: "date" },
  { token: "#明天下午", description: "放进明天下午", kind: "date" },
  { token: "#明天晚上", description: "放进明天晚上", kind: "date" },
  { token: "!高", description: "高优先级", kind: "priority" },
  { token: "!中", description: "中优先级", kind: "priority" },
  { token: "!低", description: "低优先级", kind: "priority" },
] as const;

const periodLabels = {
  anytime: "随时",
  morning: "上午",
  afternoon: "下午",
  evening: "晚上",
} satisfies Record<TimePeriod, string>;

const priorityLabels = {
  high: "高",
  normal: "中",
  low: "低",
} satisfies Record<CardPriority, string>;

const overviewPeriodOrder = {
  anytime: 0,
  morning: 1,
  afternoon: 2,
  evening: 3,
} satisfies Record<TimePeriod, number>;

const OVERVIEW_BATCH_SIZE = 64;
const AGENT_TURN_LIMIT = 8;

function overviewGroupLimits(datedCount: number, looseCount: number, limit: number) {
  const total = datedCount + looseCount;
  if (total === 0) return { dated: 0, loose: 0 };
  if (datedCount === 0) return { dated: 0, loose: Math.min(looseCount, limit) };
  if (looseCount === 0) return { dated: Math.min(datedCount, limit), loose: 0 };
  const dated = Math.min(
    datedCount,
    Math.max(1, Math.min(limit - 1, Math.round(limit * datedCount / total))),
  );
  return { dated, loose: Math.min(looseCount, limit - dated) };
}

function OverviewLoadMore({ remaining, onLoadMore }: { remaining: number; onLoadMore: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
    }, {
      root: trigger.closest(".canvas-overview"),
      rootMargin: "240px 0px",
    });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [remaining]);

  return (
    <button
      className="canvas-overview-more"
      ref={triggerRef}
      type="button"
      aria-label="显示更多卡片"
      onClick={onLoadMore}
    >
      再显示 {Math.min(OVERVIEW_BATCH_SIZE, remaining)} 张
    </button>
  );
}

const systemNow = () => new Date();
const DATE_CAPTURE_SAFE_INSETS = { left: 96, right: 36, top: 88, bottom: 112 } as const;

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("citroam.theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function reduceMotionRequested(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function focusLater(preferred: HTMLElement | null, fallback?: HTMLElement | null) {
  window.setTimeout(() => {
    if (preferred?.isConnected) preferred.focus();
    else if (fallback?.isConnected) fallback.focus();
  }, 0);
}

function sameWorkspaceSnapshot(first: Workspace, second: Workspace): boolean {
  if (first === second) return true;
  // Workspace is a JSON-shaped, immutable snapshot. The identity fast path
  // covers the normal reducer/undo route; serialization also handles an
  // equivalent snapshot restored through a repository boundary.
  return JSON.stringify(first) === JSON.stringify(second);
}

function hasFocusablePointerTarget(target: Element | null): boolean {
  return Boolean(target?.closest(
    'button, input, textarea, select, a[href], label, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
  ));
}

function tokenKind(token: QuickToken): "date" | "priority" {
  return token.startsWith("#") ? "date" : "priority";
}

function upsertQuickToken(tokens: QuickToken[], token: QuickToken): QuickToken[] {
  const existing = tokens.findIndex((item) => tokenKind(item) === tokenKind(token));
  return existing === -1
    ? [...tokens, token]
    : tokens.map((item, index) => index === existing ? token : item);
}

function quickSuggestions(value: string) {
  const fragment = value.match(/([#!！][^\s#!！]*)$/)?.[1]?.replace("！", "!");
  return fragment ? quickOptions.filter(({ token }) => token.startsWith(fragment)) : [];
}

function parseCaptureValue(
  value: string,
  existingTokens: QuickToken[],
  current: Date,
): { title: string; tokens: QuickToken[] } {
  let tokens = existingTokens;
  const tokenPattern = /(#(?:今天|明天)(?:上午|下午|晚上|(?:\d{1,2}):(?:\d{2}))?|[!！][高中低])(?=$|\s|[#!！])/g;
  const title = value.replace(tokenPattern, (match, rawToken: string) => {
    const token = rawToken.replace("！", "!");
    if (tokenKind(token) === "date" && !parseQuickTimeToken(token, current)) return match;
    tokens = upsertQuickToken(tokens, token);
    return " ";
  }).replace(/\s+/g, " ").trim();
  return { title, tokens };
}

function localDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

function shiftDateKey(dateKey: string, days: number): string {
  return addLocalDays(localDateFromKey(dateKey), days);
}

function presentDate(dateKey: string, current: Date): DatePresentation {
  const today = getLocalDateKey(current);
  const absolute = formatAbsoluteDateLabel(dateKey, current);
  const weekday = formatWeekdayLabel(dateKey);
  if (dateKey === today) return { eyebrow: "今天", title: `${absolute} · ${weekday}`, ariaLabel: "今天的画布", captureLabel: "今天" };
  if (dateKey === shiftDateKey(today, 1)) return { eyebrow: "明天", title: `${absolute} · ${weekday}`, ariaLabel: "明天的画布", captureLabel: "明天" };
  if (dateKey === shiftDateKey(today, -1)) return { eyebrow: "昨天", title: `${absolute} · ${weekday}`, ariaLabel: "昨天的画布", captureLabel: "昨天" };
  return { eyebrow: weekday, title: absolute, ariaLabel: `${absolute}的画布`, captureLabel: absolute };
}

function viewportTransform(viewport: { x: number; y: number; zoom: number }): string {
  const screenX = Math.round(-viewport.x * viewport.zoom * 1000) / 1000;
  const screenY = Math.round(-viewport.y * viewport.zoom * 1000) / 1000;
  return `translate(${screenX}px, ${screenY}px) scale(${viewport.zoom})`;
}

function compareDatedCards(first: Card, second: Card): number {
  const firstTime = first.timeConstraint!;
  const secondTime = second.timeConstraint!;
  const dateDifference = firstTime.date.localeCompare(secondTime.date);
  if (dateDifference !== 0) return dateDifference;
  const firstMinute = firstTime.startTime
    ? Number(firstTime.startTime.slice(0, 2)) * 60 + Number(firstTime.startTime.slice(3, 5))
    : overviewPeriodOrder[firstTime.period] * 360;
  const secondMinute = secondTime.startTime
    ? Number(secondTime.startTime.slice(0, 2)) * 60 + Number(secondTime.startTime.slice(3, 5))
    : overviewPeriodOrder[secondTime.period] * 360;
  return firstMinute - secondMinute || first.createdAt.localeCompare(second.createdAt);
}

function firstFreeCardSlot(
  candidates: Array<{ x: number; y: number }>,
  occupied: Array<{ x: number; y: number }>,
  size: { width: number; height: number },
  clearance: number,
): { x: number; y: number } | null {
  return candidates.find((candidate) => occupied.every((placement) => (
    candidate.x + size.width + clearance <= placement.x
    || placement.x + size.width + clearance <= candidate.x
    || candidate.y + size.height + clearance <= placement.y
    || placement.y + size.height + clearance <= candidate.y
  ))) ?? null;
}

function looseContentFitsViewport(
  workspace: Workspace,
  viewport: Viewport,
  surface: { width: number; height: number },
): boolean {
  const openIds = new Set(workspace.cards.filter((card) => card.status === "open").map((card) => card.id));
  const bounds = [
    ...workspace.placements
      .filter((placement) => placement.pageKey === LOOSE_PAGE_KEY && openIds.has(placement.cardId))
      .map((placement) => ({
        left: placement.x,
        top: placement.y,
        right: placement.x + DATE_PAGE_CARD_SIZE.width,
        bottom: placement.y + DATE_PAGE_CARD_SIZE.height,
      })),
    ...workspace.areas
      .filter((area) => area.pageKey === LOOSE_PAGE_KEY)
      .map((area) => ({
        left: area.x,
        top: area.y,
        right: area.x + area.width,
        bottom: area.y + area.height,
      })),
  ];
  if (bounds.length === 0) return true;
  const visible = {
    left: viewport.x,
    top: viewport.y,
    right: viewport.x + surface.width / viewport.zoom,
    bottom: viewport.y + surface.height / viewport.zoom,
  };
  return bounds.every((bound) => bound.left >= visible.left
    && bound.top >= visible.top
    && bound.right <= visible.right
    && bound.bottom <= visible.bottom);
}

function dateCaptureSafeBounds(
  viewport: Viewport,
  surface: { width: number; height: number },
) {
  return {
    left: viewport.x + DATE_CAPTURE_SAFE_INSETS.left / viewport.zoom,
    right: viewport.x + (surface.width - DATE_CAPTURE_SAFE_INSETS.right) / viewport.zoom - DATE_PAGE_CARD_SIZE.width,
    top: viewport.y + DATE_CAPTURE_SAFE_INSETS.top / viewport.zoom,
    bottom: viewport.y + (surface.height - DATE_CAPTURE_SAFE_INSETS.bottom) / viewport.zoom - DATE_PAGE_CARD_SIZE.height,
  };
}

function revealDateCardViewport(
  position: { x: number; y: number },
  viewport: Viewport,
  surface: { width: number; height: number },
): Viewport {
  const screen = {
    left: (position.x - viewport.x) * viewport.zoom,
    top: (position.y - viewport.y) * viewport.zoom,
    width: DATE_PAGE_CARD_SIZE.width * viewport.zoom,
    height: DATE_PAGE_CARD_SIZE.height * viewport.zoom,
  };
  let x = viewport.x;
  let y = viewport.y;
  if (screen.left < DATE_CAPTURE_SAFE_INSETS.left) {
    x = position.x - DATE_CAPTURE_SAFE_INSETS.left / viewport.zoom;
  } else if (screen.left + screen.width > surface.width - DATE_CAPTURE_SAFE_INSETS.right) {
    x = position.x - (surface.width - DATE_CAPTURE_SAFE_INSETS.right - screen.width) / viewport.zoom;
  }
  if (screen.top < DATE_CAPTURE_SAFE_INSETS.top) {
    y = position.y - DATE_CAPTURE_SAFE_INSETS.top / viewport.zoom;
  } else if (screen.top + screen.height > surface.height - DATE_CAPTURE_SAFE_INSETS.bottom) {
    y = position.y - (surface.height - DATE_CAPTURE_SAFE_INSETS.bottom - screen.height) / viewport.zoom;
  }
  return { x, y, zoom: viewport.zoom };
}

function datePosition(
  period: TimePeriod,
  occupied: Array<{ x: number; y: number }>,
  visible?: {
    viewport: Viewport;
    surface: { width: number; height: number };
  },
): { x: number; y: number } {
  const fixedCandidates = Array.from({ length: 4 }, (_, index) => suggestDatePagePosition(period, index));
  let candidates = fixedCandidates;
  if (visible) {
    const { viewport, surface } = visible;
    const gap = 28 / viewport.zoom;
    const safeBounds = dateCaptureSafeBounds(viewport, surface);
    const lane = DATE_PAGE_PERIOD_BOUNDS[period];
    const visibleLaneTop = Math.max(safeBounds.top, lane.top + 16);
    const visibleLaneBottom = Math.min(safeBounds.bottom, lane.bottom - DATE_PAGE_CARD_SIZE.height - 14);
    const anchoredCandidates: Array<{ x: number; y: number }> = [];
    if (safeBounds.left <= safeBounds.right && visibleLaneTop <= visibleLaneBottom) {
      for (let x = safeBounds.left; x <= safeBounds.right + 0.01; x += DATE_PAGE_CARD_SIZE.width + gap) {
        anchoredCandidates.push(clampCardToDatePage({ x, y: visibleLaneTop }, period));
      }
    }
    const isFullyVisible = (candidate: { x: number; y: number }) => candidate.x >= safeBounds.left - 0.01
      && candidate.x <= safeBounds.right + 0.01
      && candidate.y >= safeBounds.top - 0.01
      && candidate.y <= safeBounds.bottom + 0.01;
    const visibleCandidates = [...fixedCandidates, ...anchoredCandidates]
      .filter(isFullyVisible)
      .filter((candidate, index, all) => all.findIndex((other) => (
        Math.abs(other.x - candidate.x) < 0.01 && Math.abs(other.y - candidate.y) < 0.01
      )) === index);
    if (visibleCandidates.length > 0) candidates = visibleCandidates;
  }
  return firstFreeCardSlot(candidates, occupied, DATE_PAGE_CARD_SIZE, 12)
    ?? candidates[occupied.length % candidates.length];
}

function loosePosition(
  viewport: Viewport,
  occupied: Array<{ x: number; y: number }>,
  surface: { width: number; height: number },
): { x: number; y: number } {
  const horizontalInset = { start: 126, end: 36 };
  const verticalInset = { start: 118, end: 118 };
  const gap = 28;
  const cardScreenWidth = DATE_PAGE_CARD_SIZE.width * viewport.zoom;
  const cardScreenHeight = 140 * viewport.zoom;
  const columns = Math.max(1, Math.min(4, Math.floor(
    (surface.width - horizontalInset.start - horizontalInset.end + gap) / (cardScreenWidth + gap),
  )));
  const rows = Math.max(1, Math.min(3, Math.floor(
    (surface.height - verticalInset.start - verticalInset.end + gap) / (cardScreenHeight + gap),
  )));
  const candidates = Array.from({ length: columns * rows }, (_, slot) => {
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    return {
      x: viewport.x + (horizontalInset.start + column * (cardScreenWidth + gap)) / viewport.zoom,
      y: viewport.y + (verticalInset.start + row * (cardScreenHeight + gap)) / viewport.zoom,
    };
  });
  return firstFreeCardSlot(
    candidates,
    occupied,
    { width: DATE_PAGE_CARD_SIZE.width, height: 140 },
    12 / viewport.zoom,
  ) ?? candidates[occupied.length % candidates.length];
}

function areaPosition(
  viewport: Viewport,
  occupied: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    x: viewport.x + (96 + (index % 4) * 42) / viewport.zoom,
    y: viewport.y + (86 + (index % 5) * 38) / viewport.zoom,
  }));
  return candidates.find((candidate) => occupied.every((area) => (
    Math.abs(candidate.x - area.x) > 0.01 || Math.abs(candidate.y - area.y) > 0.01
  ))) ?? candidates[occupied.length % candidates.length];
}

const defaultAgentModel: AgentModel = import.meta.env.MODE === "test" ? localAgentModel : harnessAgentModel;

export function App({
  repository,
  now = systemNow,
  agentModel = defaultAgentModel,
  settingsRepository = defaultSettingsRepository,
}: AppProps) {
  const searchShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
    ? "⌘ K"
    : "Ctrl K";
  const {
    workspace,
    workspaceRef,
    saveState,
    loadFailed,
    undoCount,
    commit: commitWorkspace,
    undo: undoWorkspace,
    retryLoad,
    retrySave,
  } = useWorkspaceController(repository);

  const [view, setView] = useState<AppView>("canvas");
  const [overviewStatus, setOverviewStatus] = useState<OverviewStatus>("open");
  const [overviewRenderLimit, setOverviewRenderLimit] = useState(OVERVIEW_BATCH_SIZE);
  const [calendarNow, setCalendarNow] = useState(() => now());
  const [currentPage, setCurrentPage] = useState<CanvasPageKey>(() => getLocalDateKey(now()));
  const [lastDatePage, setLastDatePage] = useState(() => getLocalDateKey(now()));
  const [pageDirection, setPageDirection] = useState<PageDirection>("still");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [capture, setCapture] = useState("");
  const [captureTokens, setCaptureTokens] = useState<QuickToken[]>([]);
  const [captureComposing, setCaptureComposing] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [areaTitleDraft, setAreaTitleDraft] = useState("");
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineTitleDraft, setInlineTitleDraft] = useState("");
  const [exactTimeOpen, setExactTimeOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchResult, setActiveSearchResult] = useState(0);
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const [pendingImportWorkspace, setPendingImportWorkspace] = useState<Workspace | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const [agentOpen, setAgentOpen] = useState(false);
  const [visibleViewport, setVisibleViewportState] = useState<Viewport | null>(null);
  const [cardMotions, setCardMotions] = useState<Map<string, CanvasCardMotion>>(() => new Map());
  const [completingCardIds, setCompletingCardIds] = useState<Set<string>>(() => new Set());
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [enteringAreaIds, setEnteringAreaIds] = useState<Set<string>>(() => new Set());
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentTurns, setAgentTurns] = useState<AgentTurn[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [pendingAgentPlan, setPendingAgentPlan] = useState<AgentPlan | null>(null);
  const [agentSelectedId, setAgentSelectedId] = useState<string | null>(null);
  const [agentCandidateIndex, setAgentCandidateIndex] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const agentInputRef = useRef<HTMLInputElement>(null);
  const agentTurnsRef = useRef<HTMLDivElement>(null);
  const agentTurnIdRef = useRef(0);
  const agentRequestVersionRef = useRef(0);
  const agentSceneRevisionRef = useRef(0);
  const agentContextRef = useRef({
    currentPage,
    view,
    selectedId,
    overviewStatus,
    sceneRevision: 0,
  });
  // Async Agent callbacks can outlive the render that started them. Keep the
  // latest UI context in refs so a response uses the visible view and
  // inspector instead of a stale closure.
  const currentPageRef = useRef(currentPage);
  const viewRef = useRef<AppView>(view);
  const selectedIdRef = useRef<string | null>(selectedId);
  const agentSelectedIdRef = useRef<string | null>(agentSelectedId);
  const undoCountRef = useRef(undoCount);
  currentPageRef.current = currentPage;
  viewRef.current = view;
  selectedIdRef.current = selectedId;
  agentSelectedIdRef.current = agentSelectedId;
  undoCountRef.current = undoCount;
  const agentConfirmDialogRef = useRef<HTMLElement>(null);
  const inspectorTitleRef = useRef<HTMLTextAreaElement>(null);
  const inspectorDateRef = useRef<HTMLInputElement>(null);
  const exactTimeStartRef = useRef<HTMLInputElement>(null);
  const areaTitleInputRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLElement>(null);
  const datePickerRef = useRef<HTMLElement>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const importDialogRef = useRef<HTMLElement>(null);
  const cardArticleRefs = useRef(new Map<string, HTMLElement>());
  const cardOpenRefs = useRef(new Map<string, HTMLButtonElement>());
  const areaMoveRefs = useRef(new Map<string, HTMLButtonElement>());
  const overviewRowRefs = useRef(new Map<string, HTMLLIElement>());
  const searchResultRefs = useRef(new Map<string, HTMLButtonElement>());
  const agentCandidateRefs = useRef(new Map<string, HTMLButtonElement>());
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const agentReturnFocusRef = useRef<HTMLElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const datePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const backupTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const undoTriggerRef = useRef<HTMLButtonElement>(null);
  const backupMenuRef = useRef<HTMLDivElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const datePickerReturnFocusRef = useRef<HTMLElement | null>(null);
  const inspectorReturnFocusRef = useRef<HTMLElement | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const titleDraftRef = useRef("");
  const notesDraftRef = useRef("");
  const inlineEditingIdRef = useRef<string | null>(null);
  const inlineTitleDraftRef = useRef("");
  const touchCanvasGestureRef = useRef<TouchCanvasGesture | null>(null);
  const touchCardDragRef = useRef<TouchCardDragSeed | null>(null);
  const spacePressedRef = useRef(false);
  const suppressedCardOpenRef = useRef<{ cardId: string; until: number } | null>(null);
  const suppressedAreaOpenRef = useRef<string | null>(null);
  const motionTimersRef = useRef(new Map<string, number>());
  const dropOffsetTimersRef = useRef(new Map<string, number>());
  const noticeTimerRef = useRef<number | null>(null);
  const completionTimersRef = useRef(new Map<string, number>());
  const completionFocusTargetsRef = useRef(new Map<string, HTMLElement>());
  const canvasCardActionsRef = useRef<CanvasCardActionHandlers | null>(null);
  const areaTitleDraftRef = useRef("");
  const selectNewAreaTitleRef = useRef<string | null>(null);
  const captureComposingRef = useRef(false);
  const agentComposingRef = useRef(false);
  const visibleViewportRef = useRef<Viewport | null>(null);
  const pageViewportsRef = useRef(new Map<CanvasPageKey, Viewport>());
  const initialDateViewportAppliedRef = useRef(false);
  const initialPageKeyRef = useRef<CanvasPageKey>(currentPage);
  const pendingCaptureRevealRef = useRef(new Map<CanvasPageKey, string>());
  const flushDraftsRef = useRef<() => void>(() => undefined);
  const { begin: beginInteraction, cancel: cancelInteraction, isActive: interactionActive } = useCanvasInteractionSession();

  const handleCanvasCardDrag = useCallback<CanvasCardActionHandlers["beginDrag"]>(
    (event, cardId, placement) => canvasCardActionsRef.current?.beginDrag(event, cardId, placement),
    [],
  );
  const handleCanvasCardToggle = useCallback<CanvasCardActionHandlers["toggle"]>(
    (cardId) => canvasCardActionsRef.current?.toggle(cardId),
    [],
  );
  const handleCanvasCardInlineTitleChange = useCallback<CanvasCardActionHandlers["inlineTitleChange"]>(
    (cardId, value) => canvasCardActionsRef.current?.inlineTitleChange(cardId, value),
    [],
  );
  const handleCanvasCardCommitInlineTitle = useCallback<CanvasCardActionHandlers["commitInlineTitle"]>(
    (cardId, restoreFocus) => canvasCardActionsRef.current?.commitInlineTitle(cardId, restoreFocus),
    [],
  );
  const handleCanvasCardCancelInlineTitle = useCallback<CanvasCardActionHandlers["cancelInlineTitle"]>(
    (cardId) => canvasCardActionsRef.current?.cancelInlineTitle(cardId),
    [],
  );
  const handleCanvasCardOpen = useCallback<CanvasCardActionHandlers["open"]>(
    (cardId) => canvasCardActionsRef.current?.open(cardId),
    [],
  );
  const handleCanvasCardStartInlineEdit = useCallback<CanvasCardActionHandlers["startInlineEdit"]>(
    (cardId) => canvasCardActionsRef.current?.startInlineEdit(cardId),
    [],
  );
  const registerCanvasCardArticle = useCallback<CanvasCardActionHandlers["registerArticle"]>(
    (cardId, element) => {
      if (element) cardArticleRefs.current.set(cardId, element);
      else cardArticleRefs.current.delete(cardId);
    },
    [],
  );
  const registerCanvasCardOpen = useCallback<CanvasCardActionHandlers["registerOpen"]>(
    (cardId, element) => {
      if (element) cardOpenRefs.current.set(cardId, element);
      else cardOpenRefs.current.delete(cardId);
    },
    [],
  );

  const openCards = useMemo(
    () => workspace?.cards.filter((card) => card.status === "open") ?? [],
    [workspace],
  );
  const completedCards = useMemo(
    () => workspace?.cards
      .filter((card) => card.status === "completed")
      .sort((first, second) => (second.completedAt ?? "").localeCompare(first.completedAt ?? "")) ?? [],
    [workspace],
  );
  const selectedCard = workspace?.cards.find((card) => card.id === selectedId) ?? null;
  const agentSelectedCard = workspace?.cards.find((card) => card.id === agentSelectedId && card.status !== "deleted") ?? null;
  const selectedArea = workspace?.areas.find((area) => area.id === selectedAreaId) ?? null;
  const visiblePlacements = useMemo(
    () => workspace?.placements.filter((placement) => placement.pageKey === currentPage) ?? [],
    [currentPage, workspace],
  );
  const visibleCardIds = useMemo(
    () => new Set(visiblePlacements.map((placement) => placement.cardId)),
    [visiblePlacements],
  );
  const visiblePlacementByCardId = useMemo(
    () => new Map(visiblePlacements.map((placement) => [placement.cardId, placement] as const)),
    [visiblePlacements],
  );
  const visibleOpenCards = useMemo(
    () => openCards.filter((card) => visibleCardIds.has(card.id)),
    [openCards, visibleCardIds],
  );
  const visibleCanvasCards = useMemo(
    () => workspace?.cards.filter((card) => visibleCardIds.has(card.id)
      && (card.status === "open" || completingCardIds.has(card.id))) ?? [],
    [completingCardIds, visibleCardIds, workspace],
  );
  const visibleAreas = useMemo(
    () => workspace?.areas.filter((area) => area.pageKey === currentPage) ?? [],
    [currentPage, workspace],
  );
  const shownDate = currentPage === LOOSE_PAGE_KEY ? lastDatePage : currentPage;
  const datePresentation = presentDate(shownDate, calendarNow);
  const previousDate = shiftDateKey(shownDate, -1);
  const previousOpenCount = useMemo(() => {
    if (currentPage === LOOSE_PAGE_KEY || !workspace) return 0;
    const openCardIds = new Set(openCards.map((card) => card.id));
    return workspace.placements.filter((placement) => placement.pageKey === previousDate
      && openCardIds.has(placement.cardId)).length;
  }, [currentPage, openCards, previousDate, workspace]);
  const suggestions = captureComposing || suggestionsDismissed || agentOpen ? [] : quickSuggestions(capture);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return [];
    return workspace?.cards.filter((card) => card.status !== "deleted"
      && `${card.title}\n${card.notes}`.toLocaleLowerCase("zh-CN").includes(query)) ?? [];
  }, [searchQuery, workspace]);
  const activeSearchCardId = searchResults[activeSearchResult]?.id ?? null;
  const overviewOpenCards = openCards;
  const overviewDatedCards = useMemo(
    () => overviewOpenCards.filter((card) => card.timeConstraint).sort(compareDatedCards),
    [workspace],
  );
  const overviewLooseCards = useMemo(
    () => overviewOpenCards.filter((card) => !card.timeConstraint).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [workspace],
  );
  const overviewLimits = overviewGroupLimits(
    overviewDatedCards.length,
    overviewLooseCards.length,
    overviewRenderLimit,
  );
  const renderedOverviewDatedCards = overviewDatedCards.slice(0, overviewLimits.dated);
  const renderedOverviewLooseCards = overviewLooseCards.slice(0, overviewLimits.loose);
  const renderedCompletedCards = completedCards.slice(0, overviewRenderLimit);
  const overviewRenderedCount = overviewStatus === "open"
    ? renderedOverviewDatedCards.length + renderedOverviewLooseCards.length
    : renderedCompletedCards.length;
  const overviewTotalCount = overviewStatus === "open" ? overviewOpenCards.length : completedCards.length;
  const overviewRemainingCount = Math.max(0, overviewTotalCount - overviewRenderedCount);

  useEffect(() => {
    const flushOnExit = () => flushDraftsRef.current();
    window.addEventListener("beforeunload", flushOnExit);
    window.addEventListener("pagehide", flushOnExit);
    return () => {
      window.removeEventListener("beforeunload", flushOnExit);
      window.removeEventListener("pagehide", flushOnExit);
      flushOnExit();
      motionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      dropOffsetTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      completionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      completionFocusTargetsRef.current.clear();
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      cancelTouchCanvasGesture();
    };
  }, []);

  useEffect(() => {
    if (!workspace || currentPage === LOOSE_PAGE_KEY || initialDateViewportAppliedRef.current) return;
    if (currentPage !== initialPageKeyRef.current) {
      initialDateViewportAppliedRef.current = true;
      return;
    }
    const stage = stageRef.current;
    // jsdom and a just-mounted hidden stage can report zero dimensions. In
    // that case keep the persisted viewport and let normal interaction decide
    // where to look; a real measured narrow window is the only place where
    // the first date scene needs this safety fit.
    if (!stage || stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
    initialDateViewportAppliedRef.current = true;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const persistedViewport = {
      x: workspace.canvas.viewportX,
      y: workspace.canvas.viewportY,
      zoom: workspace.canvas.zoom,
    };
    if (persistedViewport.x !== 0 || persistedViewport.y !== 0 || persistedViewport.zoom !== 1) return;
    const currentPagePlacements = workspace.placements
      .filter((placement) => placement.pageKey === currentPage
        && workspace.cards.some((card) => card.id === placement.cardId && card.status === "open"));
    const safeViewport = fitDatePageView(currentPagePlacements, {
      width: stageWidth,
      // `stage` is already the area below the title bar. The capture bar and
      // controls float above it, so subtracting another fixed bottom inset
      // here double-reserves space on real windows and makes the first date
      // page unreadably small. `fitDatePageView` includes its own world
      // padding; use the measured stage height as-is for this one-time fit.
      height: Math.max(240, stageHeight),
    });
    pageViewportsRef.current.set(currentPage, safeViewport);
    applyVisibleViewport(safeViewport);
  }, [currentPage, workspace]);

  useEffect(() => {
    const previous = agentContextRef.current;
    if (previous.currentPage !== currentPage
      || previous.selectedId !== agentSelectedId
      || previous.overviewStatus !== overviewStatus) {
      agentSceneRevisionRef.current += 1;
    }
    agentContextRef.current = {
      currentPage,
      view,
      // The Agent's selected-card reference is session context, not the
      // currently mounted inspector. Switching to canvas or overview closes
      // that inspector, but must not make an in-flight request lose its
      // target. A deliberate Card selection updates agentSelectedId below.
      selectedId: agentSelectedId,
      overviewStatus,
      sceneRevision: agentSceneRevisionRef.current,
    };
  }, [agentSelectedId, currentPage, overviewStatus, view]);

  useEffect(() => {
    if (!agentOpen) return;
    const turns = agentTurnsRef.current;
    if (!turns || typeof turns.scrollTo !== "function") return;
    turns.scrollTo({
      top: turns.scrollHeight,
      behavior: reduceMotionRequested() ? "auto" : "smooth",
    });
  }, [agentBusy, agentOpen, agentTurns.length, pendingAgentPlan]);

  // The capture bar remains mounted while the Agent panel overlays the canvas.
  // Restore the ordinary capture focus explicitly when returning to the canvas;
  // `autoFocus` only runs when an input is first mounted.
  useEffect(() => {
    if (view !== "canvas" || agentOpen) return;
    focusLater(captureRef.current);
  }, [agentOpen, view]);

  useEffect(() => {
    let midnightTimer: number | null = null;

    function scheduleMidnightRefresh() {
      if (midnightTimer !== null) window.clearTimeout(midnightTimer);
      const current = now();
      const nextMidnight = new Date(current);
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimer = window.setTimeout(() => {
        setCalendarNow(now());
        scheduleMidnightRefresh();
      }, Math.max(50, nextMidnight.getTime() - current.getTime() + 50));
    }

    function refreshCalendar() {
      setCalendarNow(now());
      scheduleMidnightRefresh();
    }

    function refreshVisibleCalendar() {
      if (document.visibilityState === "visible") refreshCalendar();
    }

    scheduleMidnightRefresh();
    window.addEventListener("focus", refreshCalendar);
    document.addEventListener("visibilitychange", refreshVisibleCalendar);
    return () => {
      if (midnightTimer !== null) window.clearTimeout(midnightTimer);
      window.removeEventListener("focus", refreshCalendar);
      document.removeEventListener("visibilitychange", refreshVisibleCalendar);
    };
  }, [now]);

  useEffect(() => {
    const card = workspace?.cards.find((item) => item.id === selectedId);
    const nextTitle = card?.title ?? "";
    const nextNotes = card?.notes ?? "";
    titleDraftRef.current = nextTitle;
    notesDraftRef.current = nextNotes;
    setTitleDraft(nextTitle);
    setNotesDraft(nextNotes);
    setExactTimeOpen(Boolean(card?.timeConstraint?.startTime));
  }, [selectedId]);

  useEffect(() => {
    if (!searchOpen || !activeSearchCardId) return;
    searchResultRefs.current.get(activeSearchCardId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeSearchCardId, searchOpen]);

  useEffect(() => {
    const area = workspace?.areas.find((item) => item.id === selectedAreaId);
    const nextTitle = area?.title ?? "";
    areaTitleDraftRef.current = nextTitle;
    setAreaTitleDraft(nextTitle);
  }, [selectedAreaId]);

  useEffect(() => {
    const input = areaTitleInputRef.current;
    if (input
      && document.activeElement === input
      && selectNewAreaTitleRef.current === selectedAreaId
      && areaTitleDraft === "新区域") {
      input.select();
      selectNewAreaTitleRef.current = null;
    }
  }, [areaTitleDraft, selectedAreaId]);

  useEffect(() => {
    flushDraftsRef.current = () => {
      if (selectedId) commitCardDrafts(selectedId);
      if (selectedAreaId) commitAreaDrafts(selectedAreaId);
      if (inlineEditingIdRef.current) commitInlineTitle(inlineEditingIdRef.current, false);
    };
  });

  useFocusTrap(searchOpen, searchPanelRef);
  useFocusTrap(datePickerOpen, datePickerRef);
  useFocusTrap(deleteConfirmOpen, deleteDialogRef);
  useFocusTrap(Boolean(pendingImportWorkspace), importDialogRef);
  useFocusTrap(pendingAgentPlan?.kind === "confirm-destructive", agentConfirmDialogRef);

  useEffect(() => {
    const input = importInputRef.current;
    if (!input) return;
    const restoreBackupFocus = () => focusLater(backupTriggerRef.current, captureRef.current);
    input.addEventListener("cancel", restoreBackupFocus);
    return () => input.removeEventListener("cancel", restoreBackupFocus);
  }, []);

  useEffect(() => {
    if (!datePickerOpen && !searchOpen && !backupMenuOpen && suggestions.length === 0) return;
    function dismissOutside(event: PointerEvent) {
      const target = event.target as Element | null;
      const restoreFocus = !hasFocusablePointerTarget(target);
      if (suggestions.length > 0 && !target?.closest(".canvas-capture-wrap")) {
        setSuggestionsDismissed(true);
      }
      if (searchOpen && !target?.closest(".canvas-search-panel, .canvas-search-button")) {
        closeSearch(restoreFocus);
      }
      if (datePickerOpen && !target?.closest(".canvas-page-picker, .canvas-page-nav")) {
        closeDatePicker(restoreFocus);
      }
      if (backupMenuOpen && !target?.closest(".canvas-backup-menu, .canvas-backup-trigger")) {
        closeBackupMenu(restoreFocus);
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [backupMenuOpen, datePickerOpen, searchOpen, suggestions.length]);

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "j") {
        event.preventDefault();
        if (settingsOpen) return;
        openAgent(target);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        openSearch(target);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLocaleLowerCase() === "z"
        && !target?.matches("input, textarea, select")) {
        event.preventDefault();
        if (settingsOpen || searchOpen || agentOpen || datePickerOpen || backupMenuOpen || deleteConfirmOpen || pendingImportWorkspace) return;
        undoLastChange();
        return;
      }
      if (event.code === "Space" && !target?.matches("input, textarea, select, button")) {
        event.preventDefault();
        spacePressedRef.current = true;
        return;
      }
      if (event.key !== "Escape") return;
      if (searchOpen) {
        closeSearch();
      }
      else if (pendingAgentPlan) cancelPendingAgentPlan();
      else if (pendingImportWorkspace) closeImportConfirm();
      else if (deleteConfirmOpen) closeDeleteConfirm();
      else if (agentOpen) closeAgent();
      else if (datePickerOpen) closeDatePicker();
      else if (backupMenuOpen) closeBackupMenu();
      else if (interactionActive()) cancelInteraction();
      else if (touchCanvasGestureRef.current) cancelTouchCanvasGesture();
      else if (selectedId) closeInspector();
      else if (selectedAreaId) closeAreaInspector(false);
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code === "Space") spacePressedRef.current = false;
    }
    function releaseSpace() {
      spacePressedRef.current = false;
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseSpace);
    };
  }, [agentOpen, backupMenuOpen, cancelInteraction, currentPage, datePickerOpen, deleteConfirmOpen, interactionActive, pendingAgentPlan, pendingImportWorkspace, searchOpen, selectedAreaId, selectedId, settingsOpen, shownDate, undoWorkspace, view]);

  function setMotion(cardId: string, motion: CanvasCardMotion, duration = 220) {
    if (reduceMotionRequested()) return;
    const existing = motionTimersRef.current.get(cardId);
    if (existing !== undefined) window.clearTimeout(existing);
    setCardMotions((motions) => new Map(motions).set(cardId, motion));
    const timer = window.setTimeout(() => {
      motionTimersRef.current.delete(cardId);
      setCardMotions((motions) => {
        if (motions.get(cardId) !== motion) return motions;
        const next = new Map(motions);
        next.delete(cardId);
        return next;
      });
    }, duration);
    motionTimersRef.current.set(cardId, timer);
  }

  function setDropOffset(cardId: string, element: HTMLElement, offset: { x: number; y: number }) {
    const existing = dropOffsetTimersRef.current.get(cardId);
    if (existing !== undefined) window.clearTimeout(existing);
    if (offset.x === 0 && offset.y === 0) {
      element.style.removeProperty("--drop-offset-x");
      element.style.removeProperty("--drop-offset-y");
      dropOffsetTimersRef.current.delete(cardId);
      return;
    }
    element.style.setProperty("--drop-offset-x", `${offset.x}px`);
    element.style.setProperty("--drop-offset-y", `${offset.y}px`);
    const timer = window.setTimeout(() => {
      dropOffsetTimersRef.current.delete(cardId);
      element.style.removeProperty("--drop-offset-x");
      element.style.removeProperty("--drop-offset-y");
    }, 220);
    dropOffsetTimersRef.current.set(cardId, timer);
  }

  function showCaptureNotice(message: string) {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setCaptureNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setCaptureNotice(null), 2200);
  }

  function retryWorkspaceSave() {
    retrySave();
    focusLater(captureRef.current);
  }

  async function retryWorkspaceLoad() {
    await retryLoad();
    if (workspaceRef.current) {
      focusLater(captureRef.current);
      return;
    }
    window.setTimeout(() => {
      stageRef.current?.querySelector<HTMLButtonElement>('[aria-label="重新打开本地内容"]')?.focus();
    }, 0);
  }

  function applyVisibleViewport(viewport: Viewport) {
    visibleViewportRef.current = viewport;
    setVisibleViewportState(viewport);
  }

  function viewportForInteraction(): Viewport {
    const visible = visibleViewportRef.current;
    if (visible) return visible;
    const current = workspaceRef.current ?? workspace;
    return current
      ? { x: current.canvas.viewportX, y: current.canvas.viewportY, zoom: current.canvas.zoom }
      : { x: 0, y: 0, zoom: 1 };
  }

  function viewportForPage(pageKey: CanvasPageKey): Viewport {
    if (pageKey === currentPageRef.current) return viewportForInteraction();
    return pageViewportsRef.current.get(pageKey) ?? viewportForInteraction();
  }

  function firstDatePageViewport(): Viewport {
    const width = stageRef.current?.clientWidth || 1200;
    const height = stageRef.current?.clientHeight || 760;
    return fitDatePageView([], {
      width,
      // The capture bar and canvas controls float over the stage; they do not
      // consume layout height. Keep first-entry fitting consistent with the
      // measured initial date-page fit and manual "看全本页" action.
      height: Math.max(240, height),
    });
  }

  function firstLoosePageViewport(): Viewport {
    const current = workspaceRef.current ?? workspace;
    const width = stageRef.current?.clientWidth || 1200;
    const height = stageRef.current?.clientHeight || 760;
    if (!current) return { x: 0, y: 0, zoom: 1 };
    const currentViewport = {
      x: current.canvas.viewportX,
      y: current.canvas.viewportY,
      zoom: current.canvas.zoom,
    };
    const hasLooseContent = current.areas.some((area) => area.pageKey === LOOSE_PAGE_KEY)
      || current.placements.some((placement) => placement.pageKey === LOOSE_PAGE_KEY
        && current.cards.some((card) => card.id === placement.cardId && card.status === "open"));
    // A content-free or already-visible loose page should keep the user's
    // current scene. Only fit when entering it would otherwise leave content
    // outside the viewport (for example after panning a date page far away).
    if (!hasLooseContent || looseContentFitsViewport(current, currentViewport, { width, height })) {
      return currentViewport;
    }
    return fitWorkspaceView(current, { width, height }, LOOSE_PAGE_KEY);
  }

  function rememberCurrentPageViewport() {
    pageViewportsRef.current.set(currentPageRef.current, viewportForInteraction());
  }

  function revealPendingCapture(pageKey: CanvasPageKey, viewport: Viewport) {
    const cardId = pendingCaptureRevealRef.current.get(pageKey);
    if (!cardId) return { viewport, consumed: false };
    pendingCaptureRevealRef.current.delete(pageKey);
    const current = workspaceRef.current ?? workspace;
    const card = current?.cards.find((item) => item.id === cardId);
    const placement = current?.placements.find((item) => item.cardId === cardId && item.pageKey === pageKey);
    if (!card || card.status !== "open" || !placement || pageKey === LOOSE_PAGE_KEY) {
      return { viewport, consumed: true };
    }
    const revealed = revealDateCardViewport(placement, viewport, {
      width: stageRef.current?.clientWidth || 1200,
      height: stageRef.current?.clientHeight || 760,
    });
    pageViewportsRef.current.set(pageKey, revealed);
    return { viewport: revealed, consumed: true };
  }

  function restorePageViewport(pageKey: CanvasPageKey) {
    const cached = pageViewportsRef.current.get(pageKey);
    // The loose page can be panned independently of the fixed date scene.
    // When a date is opened for the first time from that page, carrying its
    // far-away viewport would make the whole day appear empty. Start from a
    // fitted date scene, while previously visited pages continue to restore
    // their own session viewport.
    const firstDateVisit = pageKey !== LOOSE_PAGE_KEY
      && currentPage === LOOSE_PAGE_KEY
      && !cached;
    const firstLooseVisit = pageKey === LOOSE_PAGE_KEY
      && currentPage !== LOOSE_PAGE_KEY
      && !cached;
    const fallback = firstDateVisit
      ? firstDatePageViewport()
      : firstLooseVisit
        ? firstLoosePageViewport()
        : viewportForInteraction();
    const revealed = revealPendingCapture(pageKey, cached ?? fallback);
    if (cached || revealed.consumed || firstDateVisit || firstLooseVisit) applyVisibleViewport(revealed.viewport);
  }

  function closeCardInspectorForPageBrowse(preserveCardInspector: boolean) {
    if (preserveCardInspector || !selectedId) return;
    commitCardDrafts(selectedId);
    setSelectedId(null);
    inspectorReturnFocusRef.current = null;
  }

  function closeAreaInspectorForPageBrowse() {
    if (!selectedAreaId) return;
    commitAreaDrafts(selectedAreaId);
    setSelectedAreaId(null);
  }

  function closeInlineEditorForContext(restoreFocus = false) {
    if (inlineEditingIdRef.current) commitInlineTitle(inlineEditingIdRef.current, true, restoreFocus);
  }

  function closeTransientInspectorContext() {
    closeCardInspectorForPageBrowse(false);
    closeAreaInspectorForPageBrowse();
    closeInlineEditorForContext();
  }

  function switchPrimaryView(nextView: AppView) {
    if (deleteConfirmOpen || pendingImportWorkspace || pendingAgentPlan?.kind === "confirm-destructive") return;
    if (nextView === view) {
      if (nextView === "canvas" && agentOpen) closeAgent();
      return;
    }
    closeTransientInspectorContext();
    if (datePickerOpen) closeDatePicker(false);
    if (searchOpen) closeSearch(false);
    if (backupMenuOpen) closeBackupMenu(false);
    if (agentOpen) closeAgent(false);
    setSuggestionsDismissed(false);
    if (nextView === "canvas") {
      const revealed = revealPendingCapture(currentPage, viewportForInteraction());
      if (revealed.consumed) applyVisibleViewport(revealed.viewport);
    } else {
      setOverviewRenderLimit(OVERVIEW_BATCH_SIZE);
    }
    setView(nextView);
  }

  function switchOverviewStatus(nextStatus: OverviewStatus) {
    if (nextStatus === overviewStatus) return;
    closeTransientInspectorContext();
    setOverviewRenderLimit(OVERVIEW_BATCH_SIZE);
    setOverviewStatus(nextStatus);
  }

  function openDatePage(
    dateKey: string,
    direction: PageDirection = "still",
    preserveCardInspector = false,
  ) {
    const restoreDatePickerFocus = datePickerOpen
      && datePickerRef.current?.contains(document.activeElement) === true;
    if (dateKey === currentPage) {
      if (datePickerOpen) closeDatePicker(restoreDatePickerFocus);
      return;
    }
    closeCardInspectorForPageBrowse(preserveCardInspector);
    rememberCurrentPageViewport();
    setLastDatePage(dateKey);
    setCurrentPage(dateKey);
    setPageDirection(direction);
    restorePageViewport(dateKey);
    closeDatePicker(restoreDatePickerFocus);
    closeAreaInspectorForPageBrowse();
    closeInlineEditorForContext();
  }

  function navigateDate(days: number) {
    const next = shiftDateKey(shownDate, days);
    openDatePage(next, days > 0 ? "forward" : "backward");
  }

  function openLoosePage(preserveCardInspector = false) {
    if (currentPage === LOOSE_PAGE_KEY) {
      if (datePickerOpen) closeDatePicker(false);
      return;
    }
    closeCardInspectorForPageBrowse(preserveCardInspector);
    rememberCurrentPageViewport();
    setCurrentPage(LOOSE_PAGE_KEY);
    setPageDirection("backward");
    restorePageViewport(LOOSE_PAGE_KEY);
    closeDatePicker(false);
    closeAreaInspectorForPageBrowse();
    closeInlineEditorForContext();
  }

  function undoLastChange() {
    const shouldRestoreFocus = undoCount === 1 && document.activeElement === undoTriggerRef.current;
    const restored = undoWorkspace();
    if (!restored) return;
    if (shouldRestoreFocus) {
      const selectedCardStillExists = selectedId
        ? restored.cards.some((card) => card.id === selectedId && card.status !== "deleted")
        : false;
      focusLater(selectedCardStillExists ? inspectorTitleRef.current : captureRef.current, captureRef.current);
    }
    if (!selectedId) return;

    const restoredCard = restored.cards.find((card) => card.id === selectedId);
    const restoredPlacement = restored.placements.find((placement) => placement.cardId === selectedId);
    if (!restoredCard || restoredCard.status === "deleted" || !restoredPlacement) {
      setSelectedId(null);
      inspectorReturnFocusRef.current = null;
      return;
    }
    if (restoredCard.status !== "open") return;
    if (restoredPlacement.pageKey === currentPage) return;

    if (restoredPlacement.pageKey === LOOSE_PAGE_KEY) {
      openLoosePage(true);
      return;
    }
    openDatePage(
      restoredPlacement.pageKey,
      restoredPlacement.pageKey > shownDate ? "forward" : "backward",
      true,
    );
  }

  function updateViewport(viewport: { x: number; y: number; zoom: number }, debounce = false, allowBelow = false) {
    const current = workspaceRef.current ?? workspace;
    if (!current) return;
    const nextViewport = {
      x: viewport.x,
      y: viewport.y,
      zoom: Math.min(1.8, Math.max(allowBelow ? 0.05 : 0.5, viewport.zoom)),
    };
    const visible = viewportForInteraction();
    if (nextViewport.x === visible.x
      && nextViewport.y === visible.y
      && nextViewport.zoom === visible.zoom) return;
    const next = workspaceReducer(current, {
      type: "update-viewport",
      viewport: nextViewport,
      allowBelowManualLimit: allowBelow,
      now: now(),
    });
    applyVisibleViewport({
      x: next.canvas.viewportX,
      y: next.canvas.viewportY,
      zoom: next.canvas.zoom,
    });
    commitWorkspace(next, { persistence: debounce ? "debounced" : "immediate" });
  }

  function zoomCanvas(direction: -1 | 1) {
    const viewport = viewportForInteraction();
    const zoom = Math.min(1.8, Math.max(0.5, viewport.zoom + direction * 0.1));
    if (zoom === viewport.zoom) return;
    const anchorX = (stageRef.current?.clientWidth || 1200) / 2;
    const anchorY = (stageRef.current?.clientHeight || 760) / 2;
    updateViewport({
      x: viewport.x + anchorX / viewport.zoom - anchorX / zoom,
      y: viewport.y + anchorY / viewport.zoom - anchorY / zoom,
      zoom,
    });
  }

  function fitCanvas() {
    if (!workspace) return;
    const stageWidth = stageRef.current?.clientWidth || 1200;
    const stageHeight = stageRef.current?.clientHeight || 760;
    if (currentPage !== LOOSE_PAGE_KEY) {
      const visiblePagePlacements = workspace.placements.filter((placement) => placement.pageKey === currentPage
        && workspace.cards.some((card) => card.id === placement.cardId && card.status === "open"));
      updateViewport(fitDatePageView(visiblePagePlacements, {
        width: stageWidth,
        // The capture bar floats above the stage rather than reserving a
        // second layout band. Do not shrink the page a second time.
        height: Math.max(240, stageHeight),
      }), false, true);
      return;
    }
    if (visibleOpenCards.length === 0 && visibleAreas.length === 0) return;
    updateViewport(fitWorkspaceView(workspace, { width: stageWidth, height: stageHeight }, currentPage), false, true);
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const current = workspaceRef.current ?? workspace;
    if (!current) return;
    const viewport = viewportForInteraction();
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const zoom = Math.min(1.8, Math.max(0.5, viewport.zoom + (event.deltaY < 0 ? 0.1 : -0.1)));
      if (zoom === viewport.zoom) return;
      const stageBounds = event.currentTarget.getBoundingClientRect();
      const anchorX = event.clientX - stageBounds.left;
      const anchorY = event.clientY - stageBounds.top;
      updateViewport({
        x: viewport.x + anchorX / viewport.zoom - anchorX / zoom,
        y: viewport.y + anchorY / viewport.zoom - anchorY / zoom,
        zoom,
      }, true);
      return;
    }
    updateViewport({
      x: viewport.x + event.deltaX / viewport.zoom,
      y: viewport.y + event.deltaY / viewport.zoom,
      zoom: viewport.zoom,
    }, true);
  }

  function touchDistance(first: TouchPoint, second: TouchPoint) {
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  function touchMidpoint(first: TouchPoint, second: TouchPoint) {
    return {
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2,
    };
  }

  function stagePoint(point: TouchPoint) {
    const rect = stageRef.current?.getBoundingClientRect();
    return {
      x: point.clientX - (rect?.left ?? 0),
      y: point.clientY - (rect?.top ?? 0),
    };
  }

  function updateTouchGesture(gesture: TouchCanvasGesture) {
    const current = Array.from(gesture.pointers.values());
    if (current.length >= 2 && gesture.pinch) {
      const first = current[0];
      const second = current[1];
      const distance = Math.max(1, touchDistance(first, second));
      const midpoint = touchMidpoint(first, second);
      const zoom = Math.min(1.8, Math.max(0.5, gesture.startViewport.zoom * distance / gesture.pinch.startDistance));
      const local = stagePoint(midpoint);
      gesture.currentViewport = {
        x: gesture.pinch.anchorWorldX - local.x / zoom,
        y: gesture.pinch.anchorWorldY - local.y / zoom,
        zoom,
      };
      gesture.moved = true;
    } else if (current.length === 1 && !gesture.pinch) {
      const point = current[0];
      const deltaX = point.clientX - gesture.pointerStart.clientX;
      const deltaY = point.clientY - gesture.pointerStart.clientY;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 4) gesture.moved = true;
      if (gesture.moved) {
        gesture.currentViewport = {
          x: gesture.startViewport.x - deltaX / gesture.startViewport.zoom,
          y: gesture.startViewport.y - deltaY / gesture.startViewport.zoom,
          zoom: gesture.startViewport.zoom,
        };
      }
    }
    if (worldRef.current) worldRef.current.style.transform = viewportTransform(gesture.currentViewport);
  }

  function beginTouchCanvasGesture(
    event: ReactPointerEvent<HTMLElement>,
    seed?: TouchCardDragSeed,
    ownerOverride?: HTMLElement,
  ) {
    const point = { clientX: event.clientX, clientY: event.clientY };
    const existing = touchCanvasGestureRef.current;
    if (existing) {
      existing.pointers.set(event.pointerId, point);
      if (existing.pointers.size >= 2 && !existing.pinch) {
        const points = Array.from(existing.pointers.values());
        const midpoint = touchMidpoint(points[0], points[1]);
        const local = stagePoint(midpoint);
        existing.pinch = {
          startDistance: Math.max(1, touchDistance(points[0], points[1])),
          anchorWorldX: existing.currentViewport.x + local.x / existing.currentViewport.zoom,
          anchorWorldY: existing.currentViewport.y + local.y / existing.currentViewport.zoom,
        };
      }
      updateTouchGesture(existing);
      return;
    }
    const current = workspaceRef.current ?? workspace;
    if (!current) return;
    const startViewport = viewportForInteraction();
    const gesture = {} as TouchCanvasGesture;
    gesture.owner = ownerOverride ?? event.currentTarget;
    gesture.pointerStart = seed?.point ?? point;
    gesture.pointers = new Map(seed
      ? [[seed.pointerId, seed.point], [event.pointerId, point]]
      : [[event.pointerId, point]]);
    gesture.startViewport = startViewport;
    gesture.currentViewport = startViewport;
    gesture.pinch = null;
    if (seed) {
      const points = Array.from(gesture.pointers.values());
      const midpoint = touchMidpoint(points[0], points[1]);
      const local = stagePoint(midpoint);
      gesture.pinch = {
        startDistance: Math.max(1, touchDistance(points[0], points[1])),
        anchorWorldX: startViewport.x + local.x / startViewport.zoom,
        anchorWorldY: startViewport.y + local.y / startViewport.zoom,
      };
    }
    gesture.sourceAreaId = (event.target as HTMLElement | null)
      ?.closest<HTMLElement>(".canvas-area")?.dataset.areaId ?? null;
    gesture.moved = false;
    gesture.finish = (cancelled: boolean) => {
      if (touchCanvasGestureRef.current !== gesture) return;
      touchCanvasGestureRef.current = null;
      gesture.pointers.forEach((_value, pointerId) => {
        try {
          if (gesture.owner.hasPointerCapture?.(pointerId)) gesture.owner.releasePointerCapture?.(pointerId);
        } catch {
          // Pointer capture is optional and may already be gone.
        }
      });
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleBlur);
      if (cancelled) {
        if (worldRef.current) worldRef.current.style.transform = viewportTransform(gesture.startViewport);
        return;
      }
      if (gesture.sourceAreaId) {
        const areaId = gesture.sourceAreaId;
        if (!gesture.moved) openAreaInspector(areaId);
        suppressNextAreaOpen(areaId);
      } else if (!gesture.moved) {
        if (selectedId) closeInspector();
        else if (selectedAreaId) closeAreaInspector();
        else closeInlineEditorForContext(true);
      }
      if (gesture.currentViewport.x !== gesture.startViewport.x
        || gesture.currentViewport.y !== gesture.startViewport.y
        || gesture.currentViewport.zoom !== gesture.startViewport.zoom) {
        updateViewport(gesture.currentViewport);
      }
    };
    const handleMove = (pointerEvent: PointerEvent) => {
      const active = touchCanvasGestureRef.current;
      if (active !== gesture || !gesture.pointers.has(pointerEvent.pointerId)) return;
      gesture.pointers.set(pointerEvent.pointerId, { clientX: pointerEvent.clientX, clientY: pointerEvent.clientY });
      updateTouchGesture(gesture);
    };
    const handleUp = (pointerEvent: PointerEvent) => {
      const active = touchCanvasGestureRef.current;
      if (active !== gesture || !gesture.pointers.has(pointerEvent.pointerId)) return;
      gesture.pointers.set(pointerEvent.pointerId, { clientX: pointerEvent.clientX, clientY: pointerEvent.clientY });
      updateTouchGesture(gesture);
      // A pinch ends as one atomic gesture when either finger leaves. Do not
      // downgrade to a one-finger pan, which would cause a visible jump.
      gesture.finish(false);
    };
    const handleCancel = (pointerEvent: PointerEvent) => {
      if (touchCanvasGestureRef.current === gesture && gesture.pointers.has(pointerEvent.pointerId)) gesture.finish(true);
    };
    const handleBlur = () => gesture.finish(true);
    touchCanvasGestureRef.current = gesture;
    try {
      gesture.owner.setPointerCapture?.(event.pointerId);
      if (seed) gesture.owner.setPointerCapture?.(seed.pointerId);
    } catch {
      // Window listeners provide continuity when capture is unavailable.
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleBlur);
  }

  function cancelTouchCanvasGesture() {
    const gesture = touchCanvasGestureRef.current;
    if (!gesture) return false;
    gesture.finish(true);
    return true;
  }

  function promoteTouchCardDragToPinch(event: ReactPointerEvent<HTMLElement>): boolean {
    const seed = touchCardDragRef.current;
    if (!seed || touchCanvasGestureRef.current) return false;
    touchCardDragRef.current = null;
    cancelInteraction();
    beginTouchCanvasGesture(event, seed, stageRef.current ?? undefined);
    event.preventDefault();
    return true;
  }

  function beginCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const sourceAreaId = target?.closest<HTMLElement>(".canvas-area")?.dataset.areaId ?? null;
    const sourceCardId = target?.closest<HTMLElement>(".canvas-card")?.dataset.cardId ?? null;
    // Area interiors remain open canvas. Only cards and actual controls claim
    // the touch pointer, so a user can still pan from an empty area surface.
    const touchPan = event.pointerType === "touch" && !target?.closest(".canvas-card, button, input, textarea, select");
    if (
      event.pointerType === "touch"
      && touchCardDragRef.current
      && !touchCanvasGestureRef.current
      && event.pointerId !== touchCardDragRef.current.pointerId
    ) {
      promoteTouchCardDragToPinch(event);
      return;
    }
    if (event.pointerType === "touch" && touchCanvasGestureRef.current) {
      beginTouchCanvasGesture(event);
      event.preventDefault();
      return;
    }
    if (touchPan) {
      if (interactionActive() && !touchCanvasGestureRef.current) return;
      beginTouchCanvasGesture(event);
      event.preventDefault();
      return;
    }
    const plainBlankClick = event.pointerType !== "touch"
      && event.button === 0
      && !spacePressedRef.current
      && !target?.closest(".canvas-card, .canvas-area, button, input, textarea, select, a, label");
    if (plainBlankClick) {
      if (selectedId) closeInspector();
      else if (selectedAreaId) closeAreaInspector();
      else closeInlineEditorForContext(true);
      return;
    }
    if (!workspace || (event.button !== 1 && !(event.button === 0 && (spacePressedRef.current || touchPan)))) return;
    const startViewport = viewportForInteraction();
    const pan: PanState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: startViewport.x,
      startY: startViewport.y,
      currentX: startViewport.x,
      currentY: startViewport.y,
      moved: false,
    };
    const started = beginInteraction({
      kind: "canvas-pan",
      pointerId: pan.pointerId,
      owner: event.currentTarget,
      move(pointerEvent) {
        const screenDx = pointerEvent.clientX - pan.startClientX;
        const screenDy = pointerEvent.clientY - pan.startClientY;
        if (!pan.moved && Math.abs(screenDx) + Math.abs(screenDy) <= 4) return;
        pan.moved = true;
        pan.currentX = pan.startX - screenDx / startViewport.zoom;
        pan.currentY = pan.startY - screenDy / startViewport.zoom;
        if (worldRef.current) worldRef.current.style.transform = viewportTransform({
          x: pan.currentX,
          y: pan.currentY,
          zoom: startViewport.zoom,
        });
      },
      commit() {
        if (!pan.moved) return;
        if (sourceAreaId) suppressNextAreaOpen(sourceAreaId);
        if (sourceCardId) {
          const suppression = { cardId: sourceCardId, until: Number.POSITIVE_INFINITY };
          suppressedCardOpenRef.current = suppression;
          window.setTimeout(() => {
            if (suppressedCardOpenRef.current === suppression) suppressedCardOpenRef.current = null;
          }, 0);
        }
        if (pan.currentX === pan.startX && pan.currentY === pan.startY) return;
        updateViewport({ x: pan.currentX, y: pan.currentY, zoom: startViewport.zoom });
      },
      cancel() {
        if (worldRef.current) worldRef.current.style.transform = viewportTransform({
          x: pan.startX,
          y: pan.startY,
          zoom: startViewport.zoom,
        });
      },
    });
    if (started) event.preventDefault();
  }

  function beginCardDrag(
    event: ReactPointerEvent<HTMLElement>,
    cardId: string,
    placement: { x: number; y: number },
  ) {
    if (spacePressedRef.current) return;
    if (
      event.pointerType === "touch"
      && touchCardDragRef.current
      && !touchCanvasGestureRef.current
      && event.pointerId !== touchCardDragRef.current.pointerId
    ) {
      promoteTouchCardDragToPinch(event);
      return;
    }
    // A second touch belongs to an already active canvas pinch, even if it
    // lands on a Card. Never let it start a competing Card pointer session.
    if (event.pointerType === "touch" && touchCanvasGestureRef.current) return;
    if (!workspace || event.button !== 0 || (event.target as HTMLElement).closest(".canvas-card-complete, input")) return;
    if (selectedId === cardId) commitCardDrafts(cardId);
    const dragWorkspace = workspaceRef.current ?? workspace;
    const element = cardArticleRefs.current.get(cardId);
    const card = dragWorkspace.cards.find((item) => item.id === cardId);
    if (!element || !card) return;
    const interactionZoom = viewportForInteraction().zoom;
    const drag: DragState = {
      cardId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: placement.x,
      startY: placement.y,
      currentX: placement.x,
      currentY: placement.y,
      moved: false,
      element,
    };
    const started = beginInteraction({
      kind: "card-drag",
      pointerId: drag.pointerId,
      owner: element,
      captureOnBegin: event.pointerType !== "mouse",
      move(pointerEvent) {
        const screenDx = pointerEvent.clientX - drag.startClientX;
        const screenDy = pointerEvent.clientY - drag.startClientY;
        if (!drag.moved && Math.abs(screenDx) + Math.abs(screenDy) <= 4) return;
        drag.moved = true;
        // Keep a click-like pointerdown cancelable so the browser can emit the
        // Card button's click. Once the pointer has crossed the drag threshold,
        // prevent native selection/scrolling for the actual drag instead.
        pointerEvent.preventDefault();
        try {
          drag.element.setPointerCapture?.(drag.pointerId);
        } catch {
          // Window listeners remain the fallback when capture is unavailable.
        }
        const raw = {
          x: drag.startX + screenDx / interactionZoom,
          y: drag.startY + screenDy / interactionZoom,
        };
        drag.currentX = raw.x;
        drag.currentY = raw.y;
        const touchCardDrag = touchCardDragRef.current;
        if (touchCardDrag && touchCardDrag.pointerId === drag.pointerId) {
          touchCardDragRef.current = {
            pointerId: touchCardDrag.pointerId,
            point: {
              clientX: pointerEvent.clientX,
              clientY: pointerEvent.clientY,
            },
          };
        }
        element.classList.add("is-dragging");
        element.style.transform = `translate(${drag.currentX - drag.startX}px, ${drag.currentY - drag.startY}px) rotate(0.6deg)`;
        if (currentPage !== LOOSE_PAGE_KEY) {
          const period = periodAtDatePagePosition(raw);
          setDragPreview({
            cardId,
            period,
            position: period ? clampCardToDatePage(raw, period) : raw,
          });
        }
      },
      commit(pointerEvent) {
        if (touchCardDragRef.current?.pointerId === drag.pointerId) touchCardDragRef.current = null;
        element.classList.remove("is-dragging");
        element.style.removeProperty("transform");
        setDragPreview(null);
        if (!drag.moved) {
          // Preventing the touch pointerdown keeps a browser-generated click
          // from racing the drag session. Open the card explicitly on a tap,
          // then suppress that optional synthetic click if a platform emits it.
          if (pointerEvent.pointerType === "touch") {
            const suppression = { cardId, until: Date.now() + 260 };
            suppressedCardOpenRef.current = suppression;
            window.setTimeout(() => {
              if (suppressedCardOpenRef.current === suppression) suppressedCardOpenRef.current = null;
            }, 260);
            openInspector(cardId, cardOpenRefs.current.get(cardId));
          }
          return;
        }
        suppressedCardOpenRef.current = { cardId, until: Date.now() + 260 };
        if (drag.currentX === drag.startX && drag.currentY === drag.startY) return;
        const latestWorkspace = workspaceRef.current ?? workspace;
        const latestCard = latestWorkspace?.cards.find((item) => item.id === cardId);
        if (!latestWorkspace || !latestCard) return;
        let next: Workspace;
        if (currentPage === LOOSE_PAGE_KEY) {
          next = workspaceReducer(latestWorkspace, {
            type: "move-card",
            cardId,
            position: { x: drag.currentX, y: drag.currentY },
            now: now(),
          });
        } else {
          const period = periodAtDatePagePosition({ x: drag.currentX, y: drag.currentY });
          const keepExact = period && latestCard.timeConstraint?.startTime && periodForTime(latestCard.timeConstraint.startTime) === period;
          const droppedPosition = period
            ? clampCardToDatePage({ x: drag.currentX, y: drag.currentY }, period)
            : { x: drag.currentX, y: drag.currentY };
          setDropOffset(cardId, element, {
            x: drag.currentX - droppedPosition.x,
            y: drag.currentY - droppedPosition.y,
          });
          next = workspaceReducer(latestWorkspace, {
            type: "schedule-card",
            cardId,
            timeConstraint: {
              date: currentPage,
              period: period ?? "anytime",
              ...(keepExact ? { startTime: card.timeConstraint?.startTime, endTime: card.timeConstraint?.endTime } : {}),
            },
            position: droppedPosition,
            now: now(),
          });
        }
        commitWorkspace(next, { undo: true });
        setMotion(cardId, "dropping", 200);
      },
      cancel() {
        if (touchCardDragRef.current?.pointerId === drag.pointerId) touchCardDragRef.current = null;
        element.classList.remove("is-dragging");
        element.style.removeProperty("transform");
        setDragPreview(null);
      },
    });
    if (started && event.pointerType === "touch") {
      touchCardDragRef.current = {
        pointerId: drag.pointerId,
        point: { clientX: event.clientX, clientY: event.clientY },
      };
    }
    // Touch needs the native pointerdown cancelled while we arbitrate tap,
    // drag, and pinch. Mouse clicks stay cancelable until movement proves a
    // drag, so opening a Card remains a normal browser click.
    if (started && event.pointerType === "touch") event.preventDefault();
  }

  function addArea() {
    if (!workspace || currentPage !== LOOSE_PAGE_KEY) return;
    closeTransientInspectorContext();
    const current = workspaceRef.current ?? workspace;
    const viewport = viewportForInteraction();
    const position = areaPosition(viewport, current.areas.filter((area) => area.pageKey === LOOSE_PAGE_KEY));
    const timestamp = now().toISOString();
    const area: Area = {
      id: crypto.randomUUID(),
      canvasId: current.canvas.id,
      pageKey: LOOSE_PAGE_KEY,
      title: "新区域",
      x: position.x,
      y: position.y,
      width: 520,
      height: 320,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    commitWorkspace(workspaceReducer(current, { type: "add-area", area }), { undo: true });
    selectNewAreaTitleRef.current = area.id;
    setSelectedAreaId(area.id);
    if (!reduceMotionRequested()) {
      setEnteringAreaIds((ids) => new Set(ids).add(area.id));
      window.setTimeout(() => setEnteringAreaIds((ids) => {
        const next = new Set(ids);
        next.delete(area.id);
        return next;
      }), 220);
    }
  }

  function openAreaInspector(areaId: string) {
    if (suppressedAreaOpenRef.current === areaId) {
      suppressedAreaOpenRef.current = null;
      return;
    }
    closeCardInspectorForPageBrowse(false);
    closeInlineEditorForContext();
    if (selectedAreaId && selectedAreaId !== areaId) closeAreaInspectorForPageBrowse();
    setSelectedAreaId(areaId);
  }

  function suppressNextAreaOpen(areaId: string) {
    suppressedAreaOpenRef.current = areaId;
    window.setTimeout(() => {
      if (suppressedAreaOpenRef.current === areaId) suppressedAreaOpenRef.current = null;
    }, 0);
  }

  function beginAreaGesture(
    event: ReactPointerEvent<HTMLButtonElement>,
    area: Area,
    mode: "move" | "resize",
  ) {
    if (spacePressedRef.current) return;
    // A second touch belongs to an already active canvas pinch, even when it
    // lands on an Area handle. Returning lets the pointer bubble to the stage,
    // where it joins the existing touch canvas gesture instead of starting a
    // competing Area transform session.
    if (event.pointerType === "touch" && touchCanvasGestureRef.current) return;
    if (!workspace || event.button !== 0) return;
    if (selectedAreaId === area.id) commitAreaDrafts(area.id);
    const gestureWorkspace = workspaceRef.current ?? workspace;
    const currentArea = gestureWorkspace.areas.find((item) => item.id === area.id);
    const element = event.currentTarget.closest<HTMLElement>(".canvas-area");
    const gestureOwner = event.currentTarget;
    if (!element || !currentArea) return;
    const interactionZoom = viewportForInteraction().zoom;
    const gesture = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      x: currentArea.x,
      y: currentArea.y,
      width: currentArea.width,
      height: currentArea.height,
      currentX: currentArea.x,
      currentY: currentArea.y,
      currentWidth: currentArea.width,
      currentHeight: currentArea.height,
      moved: false,
    };
    const started = beginInteraction({
      kind: mode === "move" ? "area-move" : "area-resize",
      pointerId: gesture.pointerId,
      owner: gestureOwner,
      // Keep a mouse click targetable until the user has really started
      // moving. Touch still captures immediately so a tap/drag cannot be
      // stolen by browser scrolling or a synthesized click.
      captureOnBegin: event.pointerType !== "mouse",
      move(pointerEvent) {
        const screenDx = pointerEvent.clientX - gesture.startClientX;
        const screenDy = pointerEvent.clientY - gesture.startClientY;
        if (!gesture.moved && Math.abs(screenDx) + Math.abs(screenDy) <= 4) return;
        gesture.moved = true;
        pointerEvent.preventDefault();
        try {
          gestureOwner.setPointerCapture?.(gesture.pointerId);
        } catch {
          // Window listeners remain the fallback when capture is unavailable.
        }
        const dx = screenDx / interactionZoom;
        const dy = screenDy / interactionZoom;
        if (mode === "move") {
          gesture.currentX = gesture.x + dx;
          gesture.currentY = gesture.y + dy;
          element.style.transform = `translate(${dx}px, ${dy}px)`;
        } else {
          gesture.currentWidth = Math.max(220, gesture.width + dx);
          gesture.currentHeight = Math.max(120, gesture.height + dy);
          element.style.width = `${gesture.currentWidth}px`;
          element.style.height = `${gesture.currentHeight}px`;
        }
        element.classList.add("is-transforming");
      },
      commit() {
        element.classList.remove("is-transforming");
        element.style.removeProperty("transform");
        element.style.removeProperty("width");
        element.style.removeProperty("height");
        if (!gesture.moved) return;
        const changed = mode === "move"
          ? gesture.currentX !== gesture.x || gesture.currentY !== gesture.y
          : gesture.currentWidth !== gesture.width || gesture.currentHeight !== gesture.height;
        suppressNextAreaOpen(area.id);
        if (!changed) return;
        const latestWorkspace = workspaceRef.current ?? workspace;
        if (!latestWorkspace || !latestWorkspace.areas.some((item) => item.id === area.id)) return;
        commitWorkspace(workspaceReducer(latestWorkspace, {
          type: "update-area",
          areaId: area.id,
          patch: mode === "move"
            ? { x: gesture.currentX, y: gesture.currentY }
            : { width: gesture.currentWidth, height: gesture.currentHeight },
          now: now(),
        }), { undo: true });
      },
      cancel() {
        element.classList.remove("is-transforming");
        element.style.removeProperty("transform");
        element.style.removeProperty("width");
        element.style.removeProperty("height");
      },
    });
    if (started && event.pointerType === "touch") event.preventDefault();
  }

  function submitCapture(event: FormEvent) {
    event.preventDefault();
    if (captureComposingRef.current) return;
    const currentWorkspace = workspaceRef.current ?? workspace;
    if (!currentWorkspace || !capture.trim()) return;
    const current = now();
    const parsed = parseCaptureValue(capture, captureTokens, current);
    const dateToken = parsed.tokens.find((token) => tokenKind(token) === "date");
    const priorityToken = parsed.tokens.find((token) => tokenKind(token) === "priority");
    const tokenTime = dateToken ? parseQuickTimeToken(dateToken, current) : null;
    const timeConstraint: TimeConstraint | null = tokenTime
      ?? (currentPage === LOOSE_PAGE_KEY ? null : { date: currentPage, period: "anytime" });
    const priority = priorityToken
      ? ({ "!高": "high", "!中": "normal", "!低": "low" } as const)[priorityToken as "!高" | "!中" | "!低"]
      : null;
    if (!parsed.title) return;
    const card = createCard({ title: parsed.title, priority, timeConstraint }, { now: current });
    const pageKey = timeConstraint?.date ?? LOOSE_PAGE_KEY;
    const samePageCards = currentWorkspace.placements.filter((placement) => placement.pageKey === pageKey
      && currentWorkspace.cards.some((candidate) => candidate.id === placement.cardId && candidate.status === "open"));
    const samePeriodPlacements = timeConstraint
      ? samePageCards.filter((placement) => currentWorkspace.cards.find((candidate) => candidate.id === placement.cardId)?.timeConstraint?.period === timeConstraint.period)
      : samePageCards;
    const position = timeConstraint
      ? datePosition(timeConstraint.period, samePeriodPlacements, {
          viewport: viewportForPage(pageKey),
          surface: {
            width: stageRef.current?.clientWidth || 1200,
            height: stageRef.current?.clientHeight || 760,
          },
        })
      : loosePosition(viewportForInteraction(), samePeriodPlacements, {
        width: stageRef.current?.clientWidth || 1200,
        height: stageRef.current?.clientHeight || 760,
      });
    let next = workspaceReducer(currentWorkspace, { type: "add-card", card, pageKey, position });
    if (timeConstraint && pageKey === currentPage && view === "canvas") {
      const viewport = viewportForInteraction();
      const surface = {
        width: stageRef.current?.clientWidth || 1200,
        height: stageRef.current?.clientHeight || 760,
      };
      const revealedViewport = revealDateCardViewport(position, viewport, surface);
      if (revealedViewport.x !== viewport.x || revealedViewport.y !== viewport.y) {
        next = workspaceReducer(next, {
          type: "update-viewport",
          viewport: revealedViewport,
          now: current,
        });
        applyVisibleViewport(revealedViewport);
      }
    } else if (timeConstraint) {
      pendingCaptureRevealRef.current.set(pageKey, card.id);
    }
    commitWorkspace(next, { undo: true });
    setMotion(card.id, "entering");
    if (pageKey !== currentPage) {
      const label = presentDate(pageKey, current).eyebrow;
      showCaptureNotice(`已放到${label}`);
    }
    setCapture("");
    setCaptureTokens([]);
    setSuggestionsDismissed(false);
    if (view === "overview") setOverviewStatus("open");
    captureRef.current?.focus();
  }

  function handleCaptureChange(value: string, extractSpacedTokens = false) {
    if (captureComposingRef.current) {
      setCapture(value);
      setActiveSuggestion(0);
      return;
    }
    let tokens = captureTokens;
    let extracted = false;
    const text = value.replace(/(#(?:今天|明天)(?:上午|下午|晚上|(?:\d{1,2}):(?:\d{2}))?|[!！][高中低])(?=$|\s|[#!！])/g, (match: string, _rawToken: string, offset: number, fullValue: string) => {
      // Keep a spaced complete token in the candidate menu so the user can
      // still choose an explicit suggestion; an attached token becomes a
      // chip immediately, which keeps natural `买牛奶#今天` input readable.
      if (!extractSpacedTokens && /\s/.test(fullValue[offset - 1] ?? "")) return match;
      const token = match.replace("！", "!");
      if (tokenKind(token) === "date" && !parseQuickTimeToken(token, now())) return match;
      tokens = upsertQuickToken(tokens, token);
      extracted = true;
      return " ";
    });
    if (extracted) setCaptureTokens(tokens);
    setCapture(extracted ? text.replace(/\s+/g, " ").trim() : value);
    setActiveSuggestion(0);
    setSuggestionsDismissed(false);
  }

  function handleCaptureCompositionStart() {
    captureComposingRef.current = true;
    setCaptureComposing(true);
    setSuggestionsDismissed(true);
  }

  function handleCaptureCompositionEnd(event: ReactCompositionEvent<HTMLInputElement>) {
    captureComposingRef.current = false;
    setCaptureComposing(false);
    // Once the IME commits, parse the complete value in one pass. This also
    // handles a trailing space emitted by the IME after a finished token.
    handleCaptureChange(event.currentTarget.value, true);
  }

  function selectQuickToken(token: QuickToken) {
    setCaptureTokens((tokens) => upsertQuickToken(tokens, token));
    setCapture((value) => value.replace(/[#!！][^\s#!！]*$/, "").trimEnd());
    setActiveSuggestion(0);
    setSuggestionsDismissed(false);
    window.setTimeout(() => captureRef.current?.focus(), 0);
  }

  function removeQuickToken(token: QuickToken) {
    setCaptureTokens((tokens) => tokens.filter((item) => item !== token));
    window.setTimeout(() => captureRef.current?.focus(), 0);
  }

  function openExactTimeEditor() {
    setExactTimeOpen(true);
    window.setTimeout(() => exactTimeStartRef.current?.focus(), 0);
  }

  function updateSelectedStartTime(startTime: string) {
    const current = selectedCard?.timeConstraint;
    if (!current) return;
    if (!startTime) {
      scheduleSelectedCard({ date: current.date, period: current.period });
      return;
    }
    const endTime = current.endTime && current.endTime > startTime ? current.endTime : undefined;
    scheduleSelectedCard({
      date: current.date,
      period: periodForTime(startTime),
      startTime,
      ...(endTime ? { endTime } : {}),
    });
  }

  function moveSelectedCardToLoose() {
    scheduleSelectedCard(null);
    focusLater(inspectorDateRef.current, inspectorTitleRef.current);
  }

  function handleCaptureKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (captureComposingRef.current || event.nativeEvent.isComposing) {
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      const fragment = capture.match(/([#!！][^\s#!！]*)$/)?.[1]?.replace("！", "!");
      const selectedToken = suggestions[activeSuggestion]?.token;
      const hasTitle = Boolean(parseCaptureValue(capture, captureTokens, now()).title);
      if (fragment === selectedToken && hasTitle) return;
      event.preventDefault();
      selectQuickToken(selectedToken);
    } else if (event.key === "Tab") {
      event.preventDefault();
      selectQuickToken(suggestions[activeSuggestion].token);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setSuggestionsDismissed(true);
    }
  }

  function updateCard(patch: Partial<Pick<Card, "title" | "notes" | "priority">>) {
    const current = workspaceRef.current ?? workspace;
    if (!current || !selectedId) return;
    commitWorkspace(workspaceReducer(current, {
      type: "update-card",
      cardId: selectedId,
      patch,
      now: now(),
    }));
  }

  function commitCardDrafts(cardId = selectedId) {
    const current = workspaceRef.current ?? workspace;
    if (!current || !cardId) return;
    const card = current.cards.find((item) => item.id === cardId);
    if (!card) return;
    const patch: Partial<Pick<Card, "title" | "notes">> = {};
    const title = titleDraftRef.current.trim();
    if (title && title !== card.title) patch.title = title;
    if (notesDraftRef.current !== card.notes) patch.notes = notesDraftRef.current;
    if (Object.keys(patch).length === 0) return;
    commitWorkspace(workspaceReducer(current, {
      type: "update-card",
      cardId,
      patch,
      now: now(),
    }));
  }

  function workspaceWithSelectedCardDrafts(source: Workspace, cardId = selectedIdRef.current): Workspace {
    if (!cardId) return source;
    const card = source.cards.find((item) => item.id === cardId);
    if (!card) return source;
    const patch: Partial<Pick<Card, "title" | "notes">> = {};
    const title = titleDraftRef.current.trim();
    if (title && title !== card.title) patch.title = title;
    if (notesDraftRef.current !== card.notes) patch.notes = notesDraftRef.current;
    if (Object.keys(patch).length === 0) return source;
    return workspaceReducer(source, {
      type: "update-card",
      cardId,
      patch,
      now: now(),
    });
  }

  function commitAreaDrafts(areaId = selectedAreaId) {
    const current = workspaceRef.current ?? workspace;
    if (!current || !areaId) return;
    const area = current.areas.find((item) => item.id === areaId);
    if (!area) return;
    const title = areaTitleDraftRef.current.trim();
    if (!title || title === area.title) return;
    commitWorkspace(workspaceReducer(current, {
      type: "update-area",
      areaId,
      patch: { title },
      now: now(),
    }), { undo: true });
  }

  function closeAreaInspector(commitDraft = true) {
    const areaId = selectedAreaId;
    if (commitDraft) commitAreaDrafts();
    else {
      const area = workspaceRef.current?.areas.find((item) => item.id === selectedAreaId);
      const title = area?.title ?? "";
      areaTitleDraftRef.current = title;
      setAreaTitleDraft(title);
    }
    setSelectedAreaId(null);
    focusLater(areaId ? areaMoveRefs.current.get(areaId) ?? null : null, captureRef.current);
  }

  function startInlineCardEdit(cardId: string) {
    if (selectedId === cardId) {
      commitCardDrafts(cardId);
      setSelectedId(null);
      inspectorReturnFocusRef.current = null;
    }
    const card = workspaceRef.current?.cards.find((item) => item.id === cardId) ?? workspace?.cards.find((item) => item.id === cardId);
    if (!card) return;
    inlineEditingIdRef.current = cardId;
    inlineTitleDraftRef.current = card.title;
    setInlineEditingId(cardId);
    setInlineTitleDraft(card.title);
  }

  function appendAgentTurn(
    role: AgentTurn["role"],
    message: string,
    receipt?: AgentReceipt,
    candidates?: AgentCandidate[],
    action?: AgentTurn["action"],
  ) {
    const turn: AgentTurn = {
      id: agentTurnIdRef.current + 1,
      role,
      message,
      receipt,
      candidates,
      action,
    };
    agentTurnIdRef.current = turn.id;
    setAgentTurns((turns) => [...turns, turn].slice(-AGENT_TURN_LIMIT));
  }

  function cancelPendingAgentPlan() {
    setPendingAgentPlan(null);
    focusLater(agentInputRef.current);
  }

  function positionForAgent(
    source: Workspace,
    pageKey: CanvasPageKey,
    period: TimePeriod | null,
    cardId?: string,
  ) {
    if (cardId) {
      const currentCard = source.cards.find((card) => card.id === cardId);
      const currentPlacement = source.placements.find((placement) => placement.cardId === cardId);
      const currentPeriod = currentCard?.timeConstraint?.period ?? null;
      const samePage = currentPlacement?.pageKey === pageKey;
      const sameLoosePage = pageKey === LOOSE_PAGE_KEY && period === null && samePage;
      const sameDatePeriod = pageKey !== LOOSE_PAGE_KEY
        && period !== null
        && samePage
        && currentPeriod === period;
      if (currentPlacement && (sameLoosePage || sameDatePeriod)) {
        return pageKey === LOOSE_PAGE_KEY
          ? { x: currentPlacement.x, y: currentPlacement.y }
          : clampCardToDatePage(currentPlacement, period);
      }
    }
    const placements = source.placements.filter((placement) => {
      if (placement.pageKey !== pageKey || placement.cardId === cardId) return false;
      const card = source.cards.find((candidate) => candidate.id === placement.cardId);
      if (!card || card.status !== "open") return false;
      if (pageKey === LOOSE_PAGE_KEY) return true;
      return card.timeConstraint?.period === (period ?? "anytime");
    });
    const surface = {
      width: stageRef.current?.clientWidth || 1200,
      height: stageRef.current?.clientHeight || 760,
    };
    return pageKey === LOOSE_PAGE_KEY
      ? loosePosition(viewportForPage(pageKey), placements, surface)
      : datePosition(period ?? "anytime", placements, {
          viewport: viewportForPage(pageKey),
          surface,
        });
  }

  function runAgentPlan(plan: AgentPlan, confirmed = false) {
    const visibleCurrent = workspaceRef.current ?? workspace;
    if (!visibleCurrent) return;
    const activeView = viewRef.current;
    const activePage = currentPageRef.current;
    const activeSelectedId = selectedIdRef.current;
    const activeAgentSelectedId = agentSelectedIdRef.current;
    if (plan.kind !== "execute" && !confirmed) {
      appendAgentTurn(
        "agent",
        plan.message,
        undefined,
        plan.kind === "show" ? plan.candidates : undefined,
        plan.kind === "show" && plan.sourceIntent.type === "list"
          ? { type: "open-overview", status: plan.sourceIntent.status }
          : undefined,
      );
      if (plan.kind === "clarify" || plan.kind === "confirm" || plan.kind === "confirm-destructive") {
        if (plan.kind === "clarify") setAgentCandidateIndex(0);
        setPendingAgentPlan(plan);
      } else if (plan.kind === "show" && plan.sourceIntent.type === "open") {
        const card = visibleCurrent.cards.find((item) => item.id === plan.cardIds[0]);
        if (card) openSearchResult(card);
      }
      return;
    }
    const current = workspaceWithSelectedCardDrafts(visibleCurrent, activeSelectedId);
    // commitWorkspace records the workspace currently held by the controller
    // as the undo predecessor. Keep that exact snapshot for the receipt; the
    // draft-enriched `current` can be a derived object when an Inspector is
    // still being edited.
    const beforeWorkspace = workspaceRef.current ?? visibleCurrent;
    setPendingAgentPlan(null);
    const result = executeAgentPlan(current, plan, {
      now: now(),
      confirmed,
      createId: () => crypto.randomUUID(),
      positionFor: positionForAgent,
    });
    if (!result.changed) {
      appendAgentTurn("agent", "现在没有处理成功，画布没有变化。");
      return;
    }
    const nextWorkspace = result.workspace;
    const completedIds = plan.operations.flatMap((operation) => operation.type === "set-status"
      && operation.status === "completed"
      ? [operation.cardId]
      : []);
    if (completedIds.includes(activeSelectedId ?? "")) {
      setSelectedId(null);
      selectedIdRef.current = null;
      inspectorReturnFocusRef.current = null;
    }
    const deletedIds = plan.operations.flatMap((operation) => operation.type === "delete" ? [operation.cardId] : []);
    if (deletedIds.includes(activeSelectedId ?? "") || deletedIds.includes(activeAgentSelectedId ?? "")) {
      setSelectedId(null);
      selectedIdRef.current = null;
      setAgentSelectedId(null);
      agentSelectedIdRef.current = null;
      inspectorReturnFocusRef.current = null;
    }
    // A successful single-card action establishes that card as the next
    // conversational referent. This keeps a follow-up such as “这个做完了”
    // attached to the card the Agent just created or changed, even when the
    // canvas/inspector is not mounted in the current view. Batch actions do
    // not choose an arbitrary referent, and deleted cards are cleared above.
    if (plan.kind === "execute"
      && result.affectedCardIds.length === 1
      && !deletedIds.includes(result.affectedCardIds[0])) {
      const affectedCardId = result.affectedCardIds[0];
      const affectedCard = nextWorkspace.cards.find((card) => card.id === affectedCardId && card.status !== "deleted");
      if (affectedCard) {
        agentSelectedIdRef.current = affectedCardId;
        setAgentSelectedId(affectedCardId);
      }
    }
    const nextSelectedCard = activeSelectedId
      ? nextWorkspace.cards.find((card) => card.id === activeSelectedId && card.status === "open")
      : null;
    if (nextSelectedCard) {
      titleDraftRef.current = nextSelectedCard.title;
      notesDraftRef.current = nextSelectedCard.notes;
      setTitleDraft(nextSelectedCard.title);
      setNotesDraft(nextSelectedCard.notes);
    }
    completedIds.forEach((cardId) => {
      const placement = current.placements.find((item) => item.cardId === cardId);
      if (!placement || placement.pageKey !== activePage || activeView !== "canvas" || reduceMotionRequested()) return;
      setCompletingCardIds((ids) => new Set(ids).add(cardId));
      const timer = window.setTimeout(() => finishCardCompletion(cardId), 260);
      completionTimersRef.current.set(cardId, timer);
    });
    commitWorkspace(nextWorkspace, { undo: true });
    // Only spatial actions create a new visual location. Metadata edits and
    // status changes must not look like a card was dropped or cause a later
    // page visit to reveal an already-known card.
    const spatialCardIds = new Set([
      ...result.createdCardIds,
      ...plan.operations
        .filter((operation): operation is Extract<typeof operation, { type: "schedule" }> => operation.type === "schedule")
        .map((operation) => operation.cardId),
    ]);
    result.affectedCardIds.filter((cardId) => spatialCardIds.has(cardId)).forEach((cardId) => {
      const placement = nextWorkspace.placements.find((item) => item.cardId === cardId);
      const card = nextWorkspace.cards.find((item) => item.id === cardId);
      if (!placement || card?.status !== "open") return;
      if (placement.pageKey !== activePage || activeView !== "canvas") {
        pendingCaptureRevealRef.current.set(placement.pageKey, cardId);
      } else {
        setMotion(cardId, result.createdCardIds.includes(cardId) ? "entering" : "dropping");
      }
    });
    const resultMessage = confirmed
      ? plan.kind === "confirm-destructive" ? "已经删除。" : "好，已经处理好了。"
      : plan.message;
    appendAgentTurn("agent", resultMessage, {
      cardIds: result.affectedCardIds,
      undoDepth: undoCountRef.current + 1,
      undone: false,
      beforeWorkspace,
      afterWorkspace: nextWorkspace,
    });
  }

  async function submitAgent(event: FormEvent) {
    event.preventDefault();
    if (agentComposingRef.current) return;
    const request = agentDraft.trim();
    const current = workspaceRef.current ?? workspace;
    if (!request || !current || agentBusy || pendingAgentPlan) return;
    appendAgentTurn("user", request);
    setAgentDraft("");
    const context = {
      now: now(),
      currentPage,
      selectedCardId: agentSelectedIdRef.current,
      view,
      overviewStatus,
      workspace: current,
      sceneRevision: agentSceneRevisionRef.current,
    } as const;
    const requestVersion = agentRequestVersionRef.current + 1;
    agentRequestVersionRef.current = requestVersion;
    setAgentBusy(true);
    try {
      const intent = await agentModel.interpret(request, context);
      if (agentRequestVersionRef.current !== requestVersion) return;
      const latestContext = agentContextRef.current;
      if (latestContext.sceneRevision !== context.sceneRevision
        || latestContext.currentPage !== context.currentPage
        || latestContext.selectedId !== context.selectedCardId
        || latestContext.overviewStatus !== context.overviewStatus) {
        appendAgentTurn("agent", "当前现场已经变化，这次没有执行。画布没有变化。");
        return;
      }
      const latest = workspaceRef.current ?? current;
      runAgentPlan(prepareAgentPlan(intent, latest, context));
    } catch {
      if (agentRequestVersionRef.current === requestVersion) {
        appendAgentTurn("agent", "现在没有处理成功，画布没有变化。");
      }
    } finally {
      if (agentRequestVersionRef.current === requestVersion) setAgentBusy(false);
    }
  }

  function handleAgentCompositionStart() {
    agentComposingRef.current = true;
  }

  function handleAgentCompositionEnd() {
    agentComposingRef.current = false;
  }

  function handleAgentKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // Let the IME own Enter while composition is active. The form submit
    // guard still prevents a premature Agent request, while preserving the
    // platform's composition-confirmation behavior.
    if (agentComposingRef.current || event.nativeEvent.isComposing) return;
  }

  function handleAgentCandidateKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    candidates: AgentCandidate[],
  ) {
    if (candidates.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? candidates.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length;
      setAgentCandidateIndex(next);
      agentCandidateRefs.current.get(candidates[next].id)?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseAgentCandidate(candidates[index].id);
    }
  }

  function chooseAgentCandidate(cardId: string) {
    const current = workspaceRef.current ?? workspace;
    if (!current || pendingAgentPlan?.kind !== "clarify") return;
    const context = {
      now: now(),
      currentPage,
      selectedCardId: agentSelectedIdRef.current,
      view,
      overviewStatus,
      workspace: current,
      sceneRevision: agentSceneRevisionRef.current,
    } as const;
    const intent = retargetAgentIntent(pendingAgentPlan.sourceIntent, cardId);
    // Choosing a candidate is an explicit user selection. Keep that stable
    // card as the next conversational referent so a following “这个” uses
    // the card the user just picked, not an older inspector target.
    agentSelectedIdRef.current = cardId;
    setAgentSelectedId(cardId);
    setPendingAgentPlan(null);
    runAgentPlan(prepareAgentPlan(intent, current, context));
  }

  function confirmPendingAgentPlan() {
    if (!pendingAgentPlan || (pendingAgentPlan.kind !== "confirm" && pendingAgentPlan.kind !== "confirm-destructive")) return;
    runAgentPlan(pendingAgentPlan, true);
    focusLater(agentInputRef.current);
  }

  function undoAgentAction(turnId: number, receipt: AgentReceipt) {
    if (receipt.undone) return;
    const current = workspaceRef.current ?? workspace;
    if (current && sameWorkspaceSnapshot(current, receipt.beforeWorkspace)) {
      const undoTurnId = agentTurnIdRef.current + 1;
      agentTurnIdRef.current = undoTurnId;
      setAgentTurns((turns) => [
        ...turns.map((turn) => turn.id === turnId && turn.receipt
          ? { ...turn, receipt: { ...turn.receipt, undone: true } }
          : turn),
        {
          id: undoTurnId,
          role: "agent" as const,
          message: "这次操作已经撤销。",
        },
      ].slice(-AGENT_TURN_LIMIT));
      return;
    }
    if (!current
      || !sameWorkspaceSnapshot(current, receipt.afterWorkspace)
      || undoCount !== receipt.undoDepth) {
      appendAgentTurn("agent", "这次操作之后已有新的更改，请使用画布上的撤销。");
      return;
    }
    const restored = undoWorkspace();
    if (!restored) {
      appendAgentTurn("agent", "现在无法撤销这次操作，画布没有变化。");
      return;
    }
    // Undo restores the exact workspace snapshot. If that snapshot still
    // contains the single card represented by this receipt, keep it as the
    // next conversational referent (for example: delete → undo → “这个完成
    // 了”). If undo removed a newly-created card, clear the now-stale target.
    if (receipt.cardIds.length === 1) {
      const restoredCardId = receipt.cardIds[0];
      const restoredCard = restored.cards.find((card) => card.id === restoredCardId && card.status !== "deleted");
      if (restoredCard) {
        agentSelectedIdRef.current = restoredCardId;
        setAgentSelectedId(restoredCardId);
      } else if (agentSelectedIdRef.current === restoredCardId) {
        agentSelectedIdRef.current = null;
        setAgentSelectedId(null);
      }
    }
    // Allocate the turn id before scheduling the state updater. The updater
    // may run after a follow-up submit; reading the mutable ref inside it
    // would then reuse the follow-up's id and make React reconcile duplicate
    // message keys.
    const undoTurnId = agentTurnIdRef.current + 1;
    agentTurnIdRef.current = undoTurnId;
    setAgentTurns((turns) => [
      ...turns.map((turn) => turn.id === turnId && turn.receipt
        ? { ...turn, receipt: { ...turn.receipt, undone: true } }
        : turn),
      {
        id: undoTurnId,
        role: "agent" as const,
        message: "刚才的更改已经撤销。",
      },
    ].slice(-AGENT_TURN_LIMIT));
  }

  function changeTheme(next: "light" | "dark") {
    setTheme(next);
    localStorage.setItem("citroam.theme", next);
  }

  /**
   * Agent is a tool layer over the canvas, not a primary view. If opened from
   * the overview, return to the current canvas page first so every action has
   * a visible spatial result behind the panel.
   */
  function openAgent(returnTarget?: HTMLElement | null) {
    if (deleteConfirmOpen || pendingImportWorkspace || pendingAgentPlan?.kind === "confirm-destructive") return;
    if (searchOpen) closeSearch(false);
    if (datePickerOpen) closeDatePicker(false);
    if (backupMenuOpen) closeBackupMenu(false);
    if (view !== "canvas") {
      closeTransientInspectorContext();
      setView("canvas");
      const revealed = revealPendingCapture(currentPage, viewportForInteraction());
      if (revealed.consumed) applyVisibleViewport(revealed.viewport);
    }
    const active = returnTarget && returnTarget !== document.body && returnTarget !== document.documentElement
      ? returnTarget
      : document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : agentTriggerRef.current;
    agentReturnFocusRef.current = active;
    setSuggestionsDismissed(true);
    setAgentOpen(true);
    window.setTimeout(() => agentInputRef.current?.focus(), 0);
  }

  function closeAgent(restoreFocus = true) {
    setAgentOpen(false);
    setSuggestionsDismissed(false);
    const returnTarget = agentReturnFocusRef.current;
    agentReturnFocusRef.current = null;
    if (restoreFocus) focusLater(returnTarget, agentTriggerRef.current ?? captureRef.current);
  }

  function toggleAgent(trigger?: HTMLElement | null) {
    if (agentOpen) closeAgent();
    else openAgent(trigger);
  }

  function openSettings(section: SettingsSection, returnTarget?: HTMLElement | null) {
    if (deleteConfirmOpen || pendingImportWorkspace || pendingAgentPlan?.kind === "confirm-destructive") return;
    if (searchOpen) closeSearch(false);
    if (datePickerOpen) closeDatePicker(false);
    if (backupMenuOpen) closeBackupMenu(false);
    settingsReturnFocusRef.current = returnTarget
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      ?? settingsTriggerRef.current;
    setSuggestionsDismissed(true);
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  function closeSettings(restoreFocus = true) {
    setSettingsOpen(false);
    setSuggestionsDismissed(false);
    const returnTarget = settingsReturnFocusRef.current;
    settingsReturnFocusRef.current = null;
    if (restoreFocus) focusLater(returnTarget, settingsTriggerRef.current ?? captureRef.current);
  }

  function openSearch(returnTarget?: HTMLElement | null) {
    if (settingsOpen || deleteConfirmOpen || pendingImportWorkspace || pendingAgentPlan?.kind === "confirm-destructive" || searchOpen) return;
    if (datePickerOpen) closeDatePicker(false);
    if (backupMenuOpen) closeBackupMenu(false);
    const candidate = returnTarget && returnTarget !== document.body && returnTarget !== document.documentElement
      ? returnTarget
      : null;
    const active = candidate ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null);
    searchReturnFocusRef.current = active;
    setSuggestionsDismissed(true);
    setSearchOpen(true);
    setSearchQuery("");
    setActiveSearchResult(0);
  }

  function closeSearch(restoreFocus = true) {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchResult(0);
    const returnTarget = searchReturnFocusRef.current;
    searchReturnFocusRef.current = null;
    if (restoreFocus) {
      window.setTimeout(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
        else if (agentOpen) agentInputRef.current?.focus();
        else (searchTriggerRef.current ?? captureRef.current)?.focus();
      }, 0);
    }
  }

  function toggleDatePicker(trigger: HTMLElement) {
    if (datePickerOpen) {
      closeDatePicker();
      return;
    }
    if (searchOpen) closeSearch(false);
    if (backupMenuOpen) closeBackupMenu(false);
    datePickerReturnFocusRef.current = trigger;
    setDatePickerOpen(true);
  }

  function closeDatePicker(restoreFocus = true) {
    setDatePickerOpen(false);
    const returnTarget = datePickerReturnFocusRef.current;
    datePickerReturnFocusRef.current = null;
    if (restoreFocus) focusLater(returnTarget, datePickerTriggerRef.current ?? captureRef.current);
  }

  function openBackupMenu() {
    if (backupMenuOpen) {
      closeBackupMenu();
      return;
    }
    if (searchOpen) closeSearch(false);
    if (datePickerOpen) closeDatePicker(false);
    setBackupMenuOpen(true);
    window.setTimeout(() => {
      backupMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, 0);
  }

  function closeBackupMenu(restoreFocus = true) {
    setBackupMenuOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => {
        if (agentOpen) agentInputRef.current?.focus();
        else (backupTriggerRef.current ?? captureRef.current)?.focus();
      }, 0);
    }
  }

  function handleBackupMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(index + direction + items.length) % items.length].focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1].focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeBackupMenu();
    }
  }

  function openInspector(cardId: string, returnTarget?: HTMLElement | null) {
    if (selectedId && selectedId !== cardId) commitCardDrafts(selectedId);
    if (selectedAreaId) commitAreaDrafts(selectedAreaId);
    const card = workspaceRef.current?.cards.find((item) => item.id === cardId) ?? workspace?.cards.find((item) => item.id === cardId);
    if (!card) return;
    inspectorReturnFocusRef.current = returnTarget ?? cardOpenRefs.current.get(cardId) ?? null;
    setSelectedAreaId(null);
    setSelectedId(cardId);
    // Keep the Agent's explicit target aligned with the user's latest Card
    // selection even when the Agent workspace is currently unmounted.
    agentSelectedIdRef.current = cardId;
    setAgentSelectedId(cardId);
  }

  function closeInspector() {
    const cardId = selectedId;
    if (!cardId) return;
    commitCardDrafts(cardId);
    setSelectedId(null);
    const requestedTarget = inspectorReturnFocusRef.current;
    const returnTarget = requestedTarget?.isConnected && !requestedTarget.closest("[hidden]")
      ? requestedTarget
      : cardOpenRefs.current.get(cardId) ?? null;
    inspectorReturnFocusRef.current = null;
    focusLater(returnTarget, captureRef.current);
  }

  function openDeleteConfirm() {
    if (!selectedId) return;
    if (searchOpen) closeSearch(false);
    if (datePickerOpen) closeDatePicker(false);
    if (backupMenuOpen) closeBackupMenu(false);
    deleteReturnFocusRef.current = deleteTriggerRef.current;
    setDeleteConfirmOpen(true);
  }

  function closeDeleteConfirm(restoreFocus = true) {
    setDeleteConfirmOpen(false);
    const returnTarget = deleteReturnFocusRef.current;
    deleteReturnFocusRef.current = null;
    if (restoreFocus) focusLater(returnTarget, captureRef.current);
  }

  function exportWorkspaceBackup(restoreMenuFocus = true) {
    if (!workspace || typeof URL.createObjectURL !== "function") return;
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `citroam-backup-${getLocalDateKey(now())}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    closeBackupMenu(restoreMenuFocus);
    showCaptureNotice("备份已经导出");
  }

  function beginImportWorkspaceBackup() {
    closeBackupMenu(false);
    importInputRef.current?.click();
  }

  async function importWorkspaceBackup(file: File) {
    closeBackupMenu(false);
    try {
      const imported = parseWorkspaceDocument(JSON.parse(await file.text()) as unknown);
      setPendingImportWorkspace(imported);
    } catch {
      showCaptureNotice("备份无法读取，当前内容没有改变");
      focusLater(backupTriggerRef.current, captureRef.current);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function closeImportConfirm(restoreFocus = true) {
    setPendingImportWorkspace(null);
    if (restoreFocus) focusLater(backupTriggerRef.current, captureRef.current);
  }

  function confirmImportWorkspace() {
    if (!pendingImportWorkspace) return;
    closeTransientInspectorContext();
    commitWorkspace(pendingImportWorkspace, { undo: true });
    pageViewportsRef.current.clear();
    applyVisibleViewport({
      x: pendingImportWorkspace.canvas.viewportX,
      y: pendingImportWorkspace.canvas.viewportY,
      zoom: pendingImportWorkspace.canvas.zoom,
    });
    setPendingImportWorkspace(null);
    showCaptureNotice("备份已经导入");
    focusLater(backupTriggerRef.current, captureRef.current);
  }

  function scheduleCard(cardId: string, constraint: TimeConstraint | null, follow = true) {
    const current = workspaceRef.current ?? workspace;
    if (!current) return;
    const placement = current.placements.find((item) => item.cardId === cardId);
    const card = current.cards.find((item) => item.id === cardId);
    if (!placement || !card) return;
    const existingConstraint = card.timeConstraint;
    const constraintUnchanged = existingConstraint === null
      ? constraint === null
      : constraint !== null
        && existingConstraint.date === constraint.date
        && existingConstraint.period === constraint.period
        && existingConstraint.startTime === constraint.startTime
        && existingConstraint.endTime === constraint.endTime;
    if (constraintUnchanged) return;
    const targetPage = constraint?.date ?? LOOSE_PAGE_KEY;
    const sameLanePlacements = current.placements.filter((item) => item.cardId !== cardId && item.pageKey === targetPage
      && current.cards.find((candidate) => candidate.id === item.cardId)?.status === "open"
      && current.cards.find((candidate) => candidate.id === item.cardId)?.timeConstraint?.period === constraint?.period);
    const pageChanged = placement.pageKey !== targetPage;
    const periodChanged = card.timeConstraint?.period !== constraint?.period;
    const targetViewport = viewportForPage(targetPage);
    const targetSurface = {
      width: stageRef.current?.clientWidth || 1200,
      height: stageRef.current?.clientHeight || 760,
    };
    const position = constraint
      ? pageChanged || periodChanged
        ? datePosition(constraint.period, sameLanePlacements, {
            viewport: targetViewport,
            surface: targetSurface,
          })
        : clampCardToDatePage(placement)
      : pageChanged
        ? loosePosition(viewportForPage(LOOSE_PAGE_KEY), sameLanePlacements, {
            width: stageRef.current?.clientWidth || 1200,
            height: stageRef.current?.clientHeight || 760,
          })
        : { x: placement.x, y: placement.y };
    let next = workspaceReducer(current, {
      type: "schedule-card",
      cardId,
      timeConstraint: constraint,
      position,
      now: now(),
    });
    const followsOpenCard = follow && card.status === "open";
    if (constraint && followsOpenCard) {
      const revealedViewport = revealDateCardViewport(position, targetViewport, targetSurface);
      if (revealedViewport.x !== targetViewport.x || revealedViewport.y !== targetViewport.y) {
        next = workspaceReducer(next, {
          type: "update-viewport",
          viewport: revealedViewport,
          now: now(),
        });
        pageViewportsRef.current.set(targetPage, revealedViewport);
        if (targetPage === currentPage) applyVisibleViewport(revealedViewport);
      }
    }
    commitWorkspace(next, { undo: true });
    setMotion(cardId, "dropping", 200);
    if (followsOpenCard) {
      setView("canvas");
      if (targetPage === LOOSE_PAGE_KEY) openLoosePage(true);
      else openDatePage(targetPage, targetPage > shownDate ? "forward" : "backward", true);
    }
  }

  function scheduleSelectedCard(constraint: TimeConstraint | null) {
    if (selectedId) scheduleCard(selectedId, constraint);
  }

  function updateInlineTitleDraft(value: string) {
    inlineTitleDraftRef.current = value;
    setInlineTitleDraft(value);
  }

  function cancelInlineTitleEdit(returnFocusCardId?: string) {
    inlineEditingIdRef.current = null;
    inlineTitleDraftRef.current = "";
    setInlineEditingId(null);
    if (returnFocusCardId) {
      window.setTimeout(() => {
        const returnTarget = cardOpenRefs.current.get(returnFocusCardId) ?? captureRef.current;
        returnTarget?.focus();
      }, 0);
    }
  }

  function commitInlineTitle(cardId: string, finishEditing = true, restoreFocus = false) {
    const title = inlineTitleDraftRef.current.trim();
    if (finishEditing) cancelInlineTitleEdit(restoreFocus ? cardId : undefined);
    const current = workspaceRef.current ?? workspace;
    if (!current || !title) return;
    const card = current.cards.find((item) => item.id === cardId);
    if (!card || card.title === title) return;
    commitWorkspace(workspaceReducer(current, {
      type: "update-card",
      cardId,
      patch: { title },
      now: now(),
    }));
  }

  function finishCardCompletion(cardId: string) {
    const timer = completionTimersRef.current.get(cardId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      completionTimersRef.current.delete(cardId);
    }
    const focusTarget = completionFocusTargetsRef.current.get(cardId);
    completionFocusTargetsRef.current.delete(cardId);
    const activeElement = document.activeElement;
    const shouldRestoreFocus = Boolean(focusTarget) && (
      activeElement === focusTarget
      || (!focusTarget?.isConnected && (activeElement === document.body || activeElement === document.documentElement))
    );
    setCompletingCardIds((ids) => {
      if (!ids.has(cardId)) return ids;
      const next = new Set(ids);
      next.delete(cardId);
      return next;
    });
    if (shouldRestoreFocus) focusLater(captureRef.current);
  }

  function toggleCard(cardId: string) {
    let current = workspaceRef.current ?? workspace;
    let card = current?.cards.find((item) => item.id === cardId);
    if (!current || !card) return;
    if (selectedId === cardId) {
      commitCardDrafts(cardId);
      current = workspaceRef.current ?? current;
      card = current.cards.find((item) => item.id === cardId);
      if (!card) return;
    }
    if (card.status === "open") {
      const activeElement = document.activeElement;
      const completingInOverview = activeElement instanceof HTMLElement
        && activeElement.matches(".canvas-overview-complete");
      if (activeElement instanceof HTMLElement
        && activeElement.matches(".canvas-card-complete, .canvas-overview-complete")) {
        completionFocusTargetsRef.current.set(cardId, activeElement);
      } else {
        completionFocusTargetsRef.current.delete(cardId);
      }
      if (selectedId === cardId) setSelectedId(null);
      setCompletingCardIds((ids) => new Set(ids).add(cardId));
      commitWorkspace(workspaceReducer(current, { type: "toggle-card", cardId, now: now() }), { undo: true });
      const delay = completingInOverview || reduceMotionRequested() ? 0 : 260;
      if (delay === 0) {
        finishCardCompletion(cardId);
      } else {
        const timer = window.setTimeout(() => finishCardCompletion(cardId), delay);
        completionTimersRef.current.set(cardId, timer);
      }
      return;
    }
    const activeElement = document.activeElement;
    const shouldRestoreFocus = activeElement instanceof HTMLElement
      && activeElement.matches(".canvas-overview-restore");
    commitWorkspace(workspaceReducer(current, { type: "toggle-card", cardId, now: now() }), { undo: true });
    if (shouldRestoreFocus) focusLater(captureRef.current);
  }

  function deleteSelectedCard() {
    if (!workspace || !selectedId) return;
    commitCardDrafts(selectedId);
    const current = workspaceRef.current ?? workspace;
    commitWorkspace(workspaceReducer(current, { type: "delete-card", cardId: selectedId, now: now() }), { undo: true });
    setSelectedId(null);
    if (agentSelectedIdRef.current === selectedId) {
      agentSelectedIdRef.current = null;
      setAgentSelectedId(null);
    }
    closeDeleteConfirm(false);
    focusLater(captureRef.current);
  }

  function deleteSelectedArea() {
    const current = workspaceRef.current ?? workspace;
    if (!current || !selectedAreaId) return;
    commitWorkspace(workspaceReducer(current, {
      type: "remove-area",
      areaId: selectedAreaId,
    }), { undo: true });
    setSelectedAreaId(null);
    focusLater(captureRef.current);
  }

  function locateCard(cardId: string, openInspector = false) {
    closeTransientInspectorContext();
    const current = workspaceRef.current ?? workspace;
    if (!current) return;
    const card = current.cards.find((item) => item.id === cardId);
    if (!card) return;
    // A result can be opened from the Agent view even when the card is
    // completed and therefore has no canvas Inspector. Keep the explicit
    // result target as the next conversational referent so “这个恢复” (or
    // another direct follow-up) still addresses the card the user just chose.
    agentSelectedIdRef.current = cardId;
    setAgentSelectedId(cardId);
    // Completed Cards do not have a visible canvas surface. Keep result
    // actions truthful by opening the completed overview instead of sending
    // the user to an empty/hidden canvas detail.
    if (card.status !== "open") {
      closeAgent(false);
      setView("overview");
      setOverviewStatus("completed");
      window.setTimeout(() => overviewRowRefs.current.get(cardId)?.focus(), 0);
      return;
    }
    const placement = current.placements.find((item) => item.cardId === cardId);
    if (!placement) return;
    if (placement.pageKey === LOOSE_PAGE_KEY) openLoosePage();
    else openDatePage(placement.pageKey, placement.pageKey > shownDate ? "forward" : "backward");
    const zoom = viewportForInteraction().zoom;
    const stageWidth = stageRef.current?.clientWidth || 1000;
    const stageHeight = stageRef.current?.clientHeight || 620;
    const next = workspaceReducer(current, {
      type: "update-viewport",
      viewport: {
        x: placement.x + DATE_PAGE_CARD_SIZE.width / 2 - stageWidth / (2 * zoom),
        y: placement.y + DATE_PAGE_CARD_SIZE.height / 2 - stageHeight / (2 * zoom),
        zoom,
      },
      now: now(),
    });
    applyVisibleViewport({
      x: next.canvas.viewportX,
      y: next.canvas.viewportY,
      zoom: next.canvas.zoom,
    });
    commitWorkspace(next);
    setView("canvas");
    setSelectedAreaId(null);
    setSelectedId(openInspector ? cardId : null);
    setMotion(cardId, "locating", 300);
    if (!openInspector) window.setTimeout(() => cardOpenRefs.current.get(cardId)?.focus(), 0);
  }

  function openSearchResult(card: Card) {
    closeSearch(false);
    locateCard(card.id, true);
  }

  function renderOverviewRows(cards: Card[], completed = false) {
    return (
      <ul>
        {cards.map((card) => (
          <li
            className="canvas-overview-row"
            aria-label={`${completed ? "已完成" : "未完成"}卡片：${card.title}`}
            key={card.id}
            tabIndex={-1}
            ref={(element) => {
              if (element) overviewRowRefs.current.set(card.id, element);
              else overviewRowRefs.current.delete(card.id);
            }}
          >
            {completed ? (
              <span className="canvas-overview-complete is-done" aria-hidden="true">✓</span>
            ) : (
              <button className="canvas-overview-complete" type="button" aria-label={`完成总览卡片：${card.title}`} title="完成" onClick={() => toggleCard(card.id)} />
            )}
            <button className="canvas-overview-open" type="button" aria-label={`打开总览卡片：${card.title}`} onClick={(event) => openInspector(card.id, event.currentTarget)}><strong>{card.title}</strong></button>
            <span className="canvas-overview-meta">
              {card.timeConstraint && <span>◷ {formatTimeConstraint(card.timeConstraint, calendarNow)}</span>}
              {card.priority && <span>⚑ {priorityLabels[card.priority]}</span>}
              {card.notes && <span>✎ 备注</span>}
            </span>
            {completed ? (
              <button className="canvas-overview-restore" type="button" aria-label={`恢复总览卡片：${card.title}`} onClick={() => toggleCard(card.id)}>恢复</button>
            ) : (
              <button className="canvas-overview-locate" type="button" aria-label={`定位卡片：${card.title}`} onClick={() => locateCard(card.id)}><span aria-hidden="true">⌗</span><span>定位</span></button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  function openCanvasCard(cardId: string) {
    const suppressed = suppressedCardOpenRef.current;
    if (suppressed?.cardId === cardId && suppressed.until > Date.now()) return;
    openInspector(cardId, cardOpenRefs.current.get(cardId));
  }

  // Keep the per-card props referentially stable. The action implementations
  // are refreshed on every App render, while CanvasCard instances can skip a
  // render when only unrelated UI state changes.
  canvasCardActionsRef.current = {
    beginDrag: beginCardDrag,
    toggle: toggleCard,
    inlineTitleChange: (_cardId, value) => updateInlineTitleDraft(value),
    commitInlineTitle: (cardId, restoreFocus) => commitInlineTitle(cardId, true, restoreFocus),
    cancelInlineTitle: (cardId) => cancelInlineTitleEdit(cardId),
    open: openCanvasCard,
    startInlineEdit: startInlineCardEdit,
    registerArticle: registerCanvasCardArticle,
    registerOpen: registerCanvasCardOpen,
  };

  return (
    <div className="canvas-app" data-theme={theme}>
      <header className="canvas-titlebar" data-tauri-drag-region="true">
        <div className="canvas-brand" data-tauri-drag-region="true">
          <span className="canvas-brand-mark"><CirclesThreePlus size={17} weight="fill" /></span>
          <span>citroam</span>
        </div>
        <nav className="canvas-view-switch" aria-label="主要视图">
          <button type="button" aria-label="画布" aria-pressed={view === "canvas"} onClick={() => switchPrimaryView("canvas")}>画布</button>
          <button type="button" aria-label="总览" aria-pressed={view === "overview"} onClick={() => switchPrimaryView("overview")}>总览</button>
        </nav>
        <button className="canvas-search-button" ref={searchTriggerRef} type="button" aria-label="搜索卡片" title="搜索卡片" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={(event) => openSearch(event.currentTarget)}>
          <MagnifyingGlass size={15} /><span>找一张卡片...</span><kbd>{searchShortcut}</kbd>
        </button>
        <div className={`canvas-save-state is-${saveState}`} aria-live="polite" aria-atomic="true">
          <span key={saveState}>{saveState === "loading" ? "正在打开" : saveState === "saving" ? "正在保存" : saveState === "error" ? "尚未保存" : "已存到本机"}</span>
        </div>
        <div className="canvas-titlebar-actions">
          <button
            className="canvas-icon-button canvas-agent-trigger"
            ref={agentTriggerRef}
            type="button"
            aria-label="对话"
            title={agentOpen ? "关闭对话" : "对话"}
            aria-haspopup="dialog"
            aria-expanded={agentOpen}
            aria-pressed={agentOpen}
            onClick={(event) => toggleAgent(event.currentTarget)}
          ><ChatCircleDots size={17} /></button>
          <div className="canvas-backup-menu-wrap">
            <button className="canvas-icon-button canvas-backup-trigger" ref={backupTriggerRef} type="button" aria-label={backupMenuOpen ? "关闭本地备份菜单" : "打开本地备份菜单"} aria-haspopup="menu" aria-expanded={backupMenuOpen} title="本地备份" onClick={openBackupMenu}><HardDrive size={17} /></button>
            {backupMenuOpen && (
              <div className="canvas-backup-menu" ref={backupMenuRef} role="menu" aria-label="本地备份" onKeyDown={handleBackupMenuKeyDown}>
                <button type="button" role="menuitem" onClick={() => exportWorkspaceBackup()}><DownloadSimple size={15} />导出本地备份</button>
                <button type="button" role="menuitem" onClick={beginImportWorkspaceBackup}><UploadSimple size={15} />导入本地备份</button>
              </div>
            )}
            <input ref={importInputRef} className="canvas-hidden-file-input" type="file" accept="application/json,.json" aria-label="选择本地备份文件" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkspaceBackup(file); }} />
          </div>
          <button
            className="canvas-icon-button"
            type="button"
            aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
            title={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
            onClick={() => changeTheme(theme === "light" ? "dark" : "light")}
          >{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button
            className="canvas-icon-button"
            ref={settingsTriggerRef}
            type="button"
            aria-label="打开设置"
            title="设置"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={(event) => openSettings("appearance", event.currentTarget)}
          ><GearSix size={17} /></button>
        </div>
      </header>

      <main className="canvas-main">
        <nav className="canvas-page-nav" hidden={view === "overview"} aria-label="日期页面导航">
          <button className="canvas-loose-tab" type="button" aria-label="打开随手页" aria-pressed={currentPage === LOOSE_PAGE_KEY} onClick={() => openLoosePage()}>随手页</button>
          <span className="canvas-page-nav-divider" />
          <button type="button" aria-label="前一天" title="前一天" onClick={() => navigateDate(-1)}><CaretLeft size={16} weight="bold" /></button>
          <button ref={datePickerTriggerRef} className="canvas-page-date" type="button" aria-label="选择日期页面" aria-describedby="canvas-current-page-date" aria-haspopup="dialog" aria-expanded={datePickerOpen} onClick={(event) => toggleDatePicker(event.currentTarget)}>
            <span className="canvas-page-date-copy" id="canvas-current-page-date"><span>{datePresentation.eyebrow}</span><strong>{datePresentation.title}</strong></span>
            <CalendarBlank className="canvas-page-date-icon" size={16} />
          </button>
          <button type="button" aria-label="后一天" title="后一天" onClick={() => navigateDate(1)}><CaretRight size={16} weight="bold" /></button>
          {(shownDate !== getLocalDateKey(calendarNow) || currentPage === LOOSE_PAGE_KEY) && (
            <button className="canvas-page-today" type="button" aria-label="回到今天" onClick={() => openDatePage(getLocalDateKey(calendarNow), "still")}>今天</button>
          )}
        </nav>

        {datePickerOpen && view !== "overview" && (
          <section className="canvas-page-picker" ref={datePickerRef} role="dialog" aria-label="选择日期页面" aria-modal="true">
            <header><span>翻到哪一天？</span><button type="button" aria-label="关闭日期选择器" onClick={() => closeDatePicker()}><X size={14} /></button></header>
            <div>
              {[-2, -1, 0, 1, 2].map((offset) => {
                const date = shiftDateKey(shownDate, offset);
                const label = presentDate(date, calendarNow);
                return <button type="button" key={date} autoFocus={offset === 0} aria-current={currentPage !== LOOSE_PAGE_KEY && offset === 0 ? "date" : undefined} onClick={() => openDatePage(date, date > shownDate ? "forward" : "backward")}><span>{label.eyebrow}</span><strong>{label.title.split(" · ")[0]}</strong></button>;
              })}
            </div>
            <label><span>其他日期</span><input type="date" aria-label="选择其他日期" value={shownDate} onChange={(event) => event.target.value && openDatePage(event.target.value, event.target.value > shownDate ? "forward" : "backward")} /></label>
          </section>
        )}

        {previousOpenCount > 0 && view !== "overview" && (
          <button className="canvas-previous-bookmark" type="button" aria-label={`查看前一天留下的 ${previousOpenCount} 张卡片`} onClick={() => openDatePage(previousDate, "backward")}>
            <CaretLeft size={13} /><span>前一天还留着 {previousOpenCount} 张</span>
          </button>
        )}

        {view !== "overview" && (
        <CanvasStage
          workspace={workspace}
          loadFailed={loadFailed}
          locating={Array.from(cardMotions.values()).includes("locating")}
          worldTransform={workspace ? viewportTransform(visibleViewport ?? {
            x: workspace.canvas.viewportX,
            y: workspace.canvas.viewportY,
            zoom: workspace.canvas.zoom,
          }) : null}
          visibleZoom={visibleViewport?.zoom ?? workspace?.canvas.zoom ?? 1}
          canFit={currentPage !== LOOSE_PAGE_KEY || visibleOpenCards.length > 0 || visibleAreas.length > 0}
          allowArea={currentPage === LOOSE_PAGE_KEY}
          stageRef={stageRef}
          worldRef={worldRef}
          onWheel={handleCanvasWheel}
          onPointerDown={beginCanvasPan}
          onZoom={zoomCanvas}
          onFit={fitCanvas}
          onAddArea={addArea}
          onRetryLoad={() => { void retryWorkspaceLoad(); }}
        >
          {workspace && (
            <div className={`canvas-page-scene is-${pageDirection}`} key={currentPage}>
              {currentPage === LOOSE_PAGE_KEY ? (
                <CanvasLoosePage />
              ) : (
                <CanvasDatePage
                  ariaLabel={datePresentation.ariaLabel}
                  activePeriod={dragPreview?.cardId && visibleCardIds.has(dragPreview.cardId) ? dragPreview.period : null}
                  zoom={visibleViewport?.zoom ?? workspace.canvas.zoom}
                />
              )}
              {currentPage !== LOOSE_PAGE_KEY && dragPreview && visibleCardIds.has(dragPreview.cardId) && (
                <div
                  className="canvas-card-drop-preview"
                  aria-hidden="true"
                  style={{ left: dragPreview.position.x, top: dragPreview.position.y }}
                >
                  <span>放进{dragPreview.period ? periodLabels[dragPreview.period] : "随时"}</span>
                </div>
              )}
              {pendingAgentPlan?.kind === "confirm" && visibleCanvasCards.map((card) => {
                if (!pendingAgentPlan.cardIds.includes(card.id)) return null;
                const placement = visiblePlacementByCardId.get(card.id);
                if (!placement) return null;
                return (
                  <div
                    className="canvas-agent-preview"
                    aria-hidden="true"
                    key={`agent-preview-${card.id}`}
                    style={{ left: placement.x, top: placement.y }}
                  />
                );
              })}
              {visibleAreas.map((area) => (
                <CanvasArea
                  key={area.id}
                  area={area}
                  selected={selectedAreaId === area.id}
                  entering={enteringAreaIds.has(area.id)}
                  onMoveRef={(element) => {
                    if (element) areaMoveRefs.current.set(area.id, element);
                    else areaMoveRefs.current.delete(area.id);
                  }}
                  onSelect={() => openAreaInspector(area.id)}
                  onBeginGesture={beginAreaGesture}
                />
              ))}
              {visibleCanvasCards.map((card) => {
                const placement = visiblePlacementByCardId.get(card.id);
                if (!placement) return null;
                return (
                  <CanvasCard
                    key={card.id}
                    card={card}
                    placement={placement}
                    selected={selectedId === card.id}
                    completing={completingCardIds.has(card.id)}
                    motion={cardMotions.get(card.id) ?? null}
                    inlineEditing={inlineEditingId === card.id}
                    inlineTitleDraft={inlineTitleDraft}
                    onArticleRef={registerCanvasCardArticle}
                    onOpenRef={registerCanvasCardOpen}
                    onBeginDrag={handleCanvasCardDrag}
                    onToggle={handleCanvasCardToggle}
                    onInlineTitleChange={handleCanvasCardInlineTitleChange}
                    onCommitInlineTitle={handleCanvasCardCommitInlineTitle}
                    onCancelInlineTitle={handleCanvasCardCancelInlineTitle}
                    onOpen={handleCanvasCardOpen}
                    onStartInlineEdit={handleCanvasCardStartInlineEdit}
                  />
                );
              })}
            </div>
          )}
        </CanvasStage>
        )}

        {view === "overview" && (
        <section className="canvas-overview" aria-label="卡片总览">
          <header className="canvas-overview-header">
            <h1>总览</h1>
            <div className="canvas-overview-status" role="group" aria-label="总览状态">
              <button type="button" aria-pressed={overviewStatus === "open"} onClick={() => switchOverviewStatus("open")}><span>未完成</span><strong>{overviewOpenCards.length}</strong></button>
              <button type="button" aria-pressed={overviewStatus === "completed"} onClick={() => switchOverviewStatus("completed")}><span>已完成</span><strong>{completedCards.length}</strong></button>
            </div>
          </header>
          {!workspace ? (
            loadFailed ? (
              <div className="canvas-overview-load-error" role="alert">
                <WarningCircle size={22} />
                <p>没能打开本地内容</p>
                <button type="button" onClick={() => { void retryWorkspaceLoad(); }}>重新打开</button>
              </div>
            ) : (
              <div className="canvas-overview-loading" role="status">正在打开本地内容</div>
            )
          ) : overviewStatus === "open" ? (
            overviewOpenCards.length === 0 ? (
              <div className="canvas-overview-empty"><p>没有未完成的卡片</p></div>
            ) : (
              <>
                <div className="canvas-overview-sections">
                  {renderedOverviewDatedCards.length > 0 && <section className="canvas-overview-section" aria-label="有日期"><header><span className="canvas-overview-section-symbol" aria-hidden="true">◷</span><h2>日期页</h2></header>{renderOverviewRows(renderedOverviewDatedCards)}</section>}
                  {renderedOverviewLooseCards.length > 0 && <section className="canvas-overview-section" aria-label="随手页"><header><span className="canvas-overview-section-symbol" aria-hidden="true">•</span><h2>随手页</h2></header>{renderOverviewRows(renderedOverviewLooseCards)}</section>}
                </div>
                {overviewRemainingCount > 0 && <OverviewLoadMore remaining={overviewRemainingCount} onLoadMore={() => setOverviewRenderLimit((limit) => limit + OVERVIEW_BATCH_SIZE)} />}
              </>
            )
          ) : completedCards.length === 0 ? (
            <div className="canvas-overview-empty"><p>还没有完成的卡片</p></div>
          ) : (
            <>
              <section className="canvas-overview-section is-completed" aria-label="已完成列表">{renderOverviewRows(renderedCompletedCards, true)}</section>
              {overviewRemainingCount > 0 && <OverviewLoadMore remaining={overviewRemainingCount} onLoadMore={() => setOverviewRenderLimit((limit) => limit + OVERVIEW_BATCH_SIZE)} />}
            </>
          )}
        </section>
        )}

        {(undoCount > 0 || captureNotice || (saveState === "error" && workspace)) && (
          <div className={`canvas-feedback-rail${agentOpen ? " is-agent-view" : ""}`}>
            {saveState === "error" && workspace && (
              <div className="canvas-save-error" role="alert"><WarningCircle size={16} /><span>这次更改还没保存</span><button type="button" onClick={retryWorkspaceSave}><ArrowClockwise size={14} />重试</button></div>
            )}
            {captureNotice && <div className="canvas-capture-notice" role="status">{captureNotice}</div>}
            {undoCount > 0 && <button className="canvas-undo" ref={undoTriggerRef} type="button" aria-label="撤销上一步" onClick={undoLastChange}><ArrowCounterClockwise size={15} />撤销</button>}
          </div>
        )}

        {agentOpen && !searchOpen && !backupMenuOpen && (
            <section className="canvas-agent-workspace" role="region" aria-label="对话工作区" aria-busy={agentBusy}>
              <header className="canvas-agent-header">
                <span><ChatCircleDots size={18} />对话</span>
                <div className="canvas-agent-header-actions">
                  <button className="canvas-agent-settings-button" type="button" aria-label="打开模型设置" title="模型设置" onClick={(event) => openSettings("agent", event.currentTarget)}><GearSix size={16} /></button>
                  <button className="canvas-agent-close-button" type="button" aria-label="收起对话面板" title="关闭对话" onClick={() => closeAgent()}><X size={16} /></button>
                </div>
              </header>
              {agentSelectedCard && <p className="canvas-agent-context">正在处理：{agentSelectedCard.title}</p>}
              {agentTurns.length > 0 && (
                <div className="canvas-agent-turns" ref={agentTurnsRef} aria-live="polite" aria-atomic="false">
                  {agentTurns.map((turn) => {
                    const receiptCard = turn.receipt?.cardIds.length === 1
                      ? workspace?.cards.find((card) => card.id === turn.receipt?.cardIds[0])
                      : null;
                    return (
                      <div className={`canvas-agent-turn is-${turn.role}`} key={turn.id}>
                        <p>{turn.message}</p>
                        {turn.receipt && !turn.receipt.undone && (
                          <div className="canvas-agent-receipt-actions">
                            {receiptCard && receiptCard.status !== "deleted" && (
                              <button type="button" aria-label={`查看${receiptCard.title}`} onClick={() => locateCard(receiptCard.id, true)}>查看</button>
                            )}
                            <button type="button" aria-label="撤销这次操作" onClick={() => undoAgentAction(turn.id, turn.receipt!)}>撤销</button>
                          </div>
                        )}
                        {turn.candidates && turn.candidates.length > 0 && (
                          <ul className="canvas-agent-results" aria-label="相关卡片">
                            {turn.candidates.map((candidate) => (
                              <li key={candidate.id}><button type="button" aria-label={`查看${candidate.title}，${candidate.description}`} onClick={() => locateCard(candidate.id, true)}><strong>{candidate.title}</strong><small>{candidate.description}</small></button></li>
                            ))}
                          </ul>
                        )}
                        {turn.action?.type === "open-overview" && (
                          <div className="canvas-agent-turn-actions">
                            <button
                              type="button"
                              aria-label="在总览中查看"
                              onClick={() => {
                                setOverviewStatus(turn.action!.status);
                                switchPrimaryView("overview");
                              }}
                            >在总览中查看</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {pendingAgentPlan?.kind === "clarify" && (
                <div className="canvas-agent-candidates" role="listbox" aria-label="请选择卡片">
                  {pendingAgentPlan.candidates.map((candidate, index) => (
                    <button
                      id={`agent-candidate-${candidate.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === agentCandidateIndex}
                      tabIndex={index === agentCandidateIndex ? 0 : -1}
                      autoFocus={index === 0}
                      aria-label={`${candidate.title}，${candidate.description}`}
                      key={candidate.id}
                      ref={(element) => {
                        if (element) agentCandidateRefs.current.set(candidate.id, element);
                        else agentCandidateRefs.current.delete(candidate.id);
                      }}
                      onFocus={() => setAgentCandidateIndex(index)}
                      onKeyDown={(event) => handleAgentCandidateKeyDown(event, index, pendingAgentPlan.candidates)}
                      onClick={() => chooseAgentCandidate(candidate.id)}
                    ><strong>{candidate.title}</strong><small>{candidate.description}</small></button>
                  ))}
                </div>
              )}
              {pendingAgentPlan?.kind === "confirm" && (
                <div className="canvas-agent-confirm-actions">
                  <button type="button" onClick={cancelPendingAgentPlan}>取消</button>
                  <button type="button" className="is-primary" autoFocus onClick={confirmPendingAgentPlan}>确认这次操作</button>
                </div>
              )}
              {agentBusy && <p className="canvas-agent-progress" role="status">正在处理</p>}
              <form className="canvas-agent-compose" onSubmit={submitAgent}>
                <input
                  ref={agentInputRef}
                  aria-label="对话输入"
                  value={agentDraft}
                  onChange={(event) => setAgentDraft(event.target.value)}
                  onCompositionStart={handleAgentCompositionStart}
                  onCompositionEnd={handleAgentCompositionEnd}
                  onKeyDown={handleAgentKeyDown}
                  placeholder="说一句要怎么处理..."
                  disabled={Boolean(pendingAgentPlan)}
                  autoFocus
                />
                <button type="submit" aria-label="发送" disabled={!agentDraft.trim() || !workspace || agentBusy || Boolean(pendingAgentPlan)}><ArrowUp size={16} weight="bold" /></button>
              </form>
            </section>
        )}

        <div className="canvas-capture-wrap">
          <form className="canvas-capture" onSubmit={submitCapture}>
            <Plus size={19} className="canvas-capture-plus" />
            <div className="canvas-capture-editor">
              {captureTokens.map((token) => {
                const kind = tokenKind(token);
                const time = kind === "date" ? parseQuickTimeToken(token, now()) : null;
                const removeLabel = kind === "priority"
                  ? `移除优先级：${token.slice(1)}`
                  : time?.period === "anytime" && !time.startTime ? `移除日期：${token.slice(1)}` : `移除时间：${token.slice(1)}`;
                return <button className={`canvas-capture-token is-${kind}`} type="button" aria-label={removeLabel} key={token} onClick={() => removeQuickToken(token)}><span>{token}</span><X size={11} weight="bold" /></button>;
              })}
              <input
                ref={captureRef}
                value={capture}
                onChange={(event) => handleCaptureChange(event.target.value)}
                onCompositionStart={handleCaptureCompositionStart}
                onCompositionEnd={handleCaptureCompositionEnd}
                onKeyDown={handleCaptureKeyDown}
                onFocus={() => setSuggestionsDismissed(false)}
                aria-label="快速记录卡片"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                aria-controls={suggestions.length ? "canvas-quick-menu" : undefined}
                aria-activedescendant={suggestions.length ? `canvas-quick-${activeSuggestion}` : undefined}
                placeholder={currentPage === LOOSE_PAGE_KEY ? "放进随手页..." : `放进${datePresentation.captureLabel}...`}
                autoFocus={view === "canvas"}
              />
            </div>
            <span className="canvas-capture-hint">#日期&nbsp;&nbsp;!优先级</span>
            <button type="submit" aria-label="添加卡片" disabled={!capture.trim() || !workspace}><ArrowUp size={17} weight="bold" /></button>
          </form>
          {suggestions.length > 0 && (
            <div className="canvas-quick-menu" id="canvas-quick-menu" role="listbox" aria-label="快速语法候选">
              {suggestions.map((option, index) => (
                <button id={`canvas-quick-${index}`} type="button" role="option" aria-selected={index === activeSuggestion} className={index === activeSuggestion ? "is-active" : ""} key={option.token} onClick={() => selectQuickToken(option.token)}>
                  <span className={`canvas-quick-icon is-${option.kind}`}>{option.kind === "date" ? <CalendarBlank size={17} /> : <Flag size={17} />}</span>
                  <span><strong>{option.token}</strong><small>{option.description}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {selectedCard && (
        <aside className="canvas-inspector" aria-label="卡片详情">
          <header><span>卡片详情</span><button className="canvas-icon-button" type="button" aria-label="关闭卡片详情" onClick={closeInspector}><X size={18} /></button></header>
          <div className="canvas-inspector-content">
            <label className="canvas-field"><span>卡片标题</span><textarea ref={inspectorTitleRef} rows={2} autoFocus value={titleDraft} onChange={(event) => { titleDraftRef.current = event.target.value; setTitleDraft(event.target.value); }} onBlur={() => commitCardDrafts()} /></label>
            <div className="canvas-property-list">
              <label><span><CalendarBlank size={16} />日期</span><input ref={inspectorDateRef} aria-label="日期" type="date" value={selectedCard.timeConstraint?.date ?? ""} onChange={(event) => scheduleSelectedCard(event.target.value ? { ...(selectedCard.timeConstraint ?? { period: "anytime" }), date: event.target.value } : null)} /></label>
              <label><span><Flag size={16} />优先级</span><select aria-label="优先级" value={selectedCard.priority ?? ""} onChange={(event) => updateCard({ priority: (event.target.value || null) as CardPriority | null })}><option value="">无</option><option value="high">高</option><option value="normal">中</option><option value="low">低</option></select></label>
            </div>
            {selectedCard.timeConstraint && (
              <div className="canvas-time-editor">
                <div className="canvas-period-control" role="group" aria-label="时段">
                  {(Object.keys(periodLabels) as TimePeriod[]).map((period) => <button type="button" key={period} aria-pressed={selectedCard.timeConstraint?.period === period && !selectedCard.timeConstraint.startTime} onClick={() => { setExactTimeOpen(false); scheduleSelectedCard({ date: selectedCard.timeConstraint!.date, period }); }}>{periodLabels[period]}</button>)}
                </div>
                {!exactTimeOpen ? <button className="canvas-add-exact-time" type="button" onClick={openExactTimeEditor}><Plus size={14} />添加具体时间</button> : (
                  <div className="canvas-exact-time-fields">
                    <label><span>开始时间</span><input ref={exactTimeStartRef} type="time" value={selectedCard.timeConstraint.startTime ?? ""} onChange={(event) => updateSelectedStartTime(event.target.value)} /></label>
                    <label><span>结束时间</span><input type="time" value={selectedCard.timeConstraint.endTime ?? ""} min={selectedCard.timeConstraint.startTime} disabled={!selectedCard.timeConstraint.startTime} onChange={(event) => { const current = selectedCard.timeConstraint!; if (!current.startTime || (event.target.value && event.target.value <= current.startTime)) return; scheduleSelectedCard({ ...current, endTime: event.target.value || undefined }); }} /></label>
                  </div>
                )}
                <button className="canvas-clear-time" type="button" onClick={moveSelectedCardToLoose}>移到随手页</button>
              </div>
            )}
            <label className="canvas-field"><span>备注</span><textarea rows={6} value={notesDraft} placeholder="补充备注..." onChange={(event) => { notesDraftRef.current = event.target.value; setNotesDraft(event.target.value); }} onBlur={() => commitCardDrafts()} /></label>
            <button className="canvas-delete-button" ref={deleteTriggerRef} type="button" aria-label="删除卡片" onClick={openDeleteConfirm}><Trash size={15} />删除卡片</button>
          </div>
        </aside>
      )}

      {selectedArea && (
        <aside className="canvas-inspector" aria-label="区域详情" key={selectedArea.id}>
          <header><span>区域详情</span><button className="canvas-icon-button" type="button" aria-label="关闭区域详情" onClick={() => closeAreaInspector()}><X size={18} /></button></header>
          <div className="canvas-inspector-content">
            <label className="canvas-field"><span>区域名称</span><input ref={areaTitleInputRef} autoFocus value={areaTitleDraft} onChange={(event) => { areaTitleDraftRef.current = event.target.value; setAreaTitleDraft(event.target.value); }} onBlur={() => commitAreaDrafts(selectedArea.id)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitAreaDrafts(selectedArea.id); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAreaInspector(false); } }} /></label>
            <p className="canvas-area-help">区域只表示空间范围。移动区域不会带走卡片。</p>
            <button className="canvas-delete-button" type="button" aria-label="删除区域" onClick={deleteSelectedArea}><Trash size={15} />删除区域</button>
          </div>
        </aside>
      )}

      {deleteConfirmOpen && selectedCard && (
        <div className="canvas-dialog-backdrop" role="presentation"><section className="canvas-confirm-dialog" ref={deleteDialogRef} role="dialog" aria-labelledby="delete-card-title" aria-describedby="delete-card-description" aria-modal="true"><span className="canvas-confirm-icon"><Trash size={18} /></span><h2 id="delete-card-title">删除这张卡片？</h2><p id="delete-card-description">“{selectedCard.title}”会从画布移除。完成事项请使用卡片上的圆圈。</p><div><button type="button" autoFocus onClick={() => closeDeleteConfirm()}>取消</button><button type="button" className="is-danger" onClick={deleteSelectedCard}>确认删除</button></div></section></div>
      )}

      {pendingAgentPlan?.kind === "confirm-destructive" && (
        <div className="canvas-dialog-backdrop" role="presentation"><section className="canvas-confirm-dialog" ref={agentConfirmDialogRef} role="dialog" aria-labelledby="agent-delete-title" aria-describedby="agent-delete-description" aria-modal="true"><span className="canvas-confirm-icon"><Trash size={18} /></span><h2 id="agent-delete-title">删除这张卡片？</h2><p id="agent-delete-description">{pendingAgentPlan.message}</p><div><button type="button" autoFocus onClick={cancelPendingAgentPlan}>取消</button><button type="button" className="is-danger" onClick={confirmPendingAgentPlan}>确认删除</button></div></section></div>
      )}

      {pendingImportWorkspace && (
        <div className="canvas-dialog-backdrop" role="presentation"><section className="canvas-confirm-dialog" ref={importDialogRef} role="dialog" aria-labelledby="import-backup-title" aria-describedby="import-backup-description" aria-modal="true"><span className="canvas-confirm-icon is-import"><UploadSimple size={18} /></span><h2 id="import-backup-title">导入这份备份？</h2><p id="import-backup-description">当前画布会被替换。导入后仍可以撤销。</p><div><button type="button" autoFocus onClick={() => closeImportConfirm()}>取消</button><button type="button" onClick={confirmImportWorkspace}>确认导入</button></div></section></div>
      )}

      {settingsOpen && (
        <SettingsPanel
          repository={settingsRepository}
          initialSection={settingsSection}
          theme={theme}
          onThemeChange={changeTheme}
          onExport={() => exportWorkspaceBackup(false)}
          onImport={() => {
            closeSettings(false);
            beginImportWorkspaceBackup();
          }}
          onClose={closeSettings}
        />
      )}

      {searchOpen && (
        <div className="canvas-search-backdrop" role="presentation"><section className="canvas-search-panel" ref={searchPanelRef} role="dialog" aria-label="搜索卡片" aria-modal="true"><header><MagnifyingGlass size={18} /><input type="search" role="searchbox" aria-label="搜索卡片" aria-controls={searchQuery.trim() ? "canvas-search-results" : undefined} aria-activedescendant={activeSearchCardId ? `canvas-search-result-${activeSearchResult}` : undefined} value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveSearchResult(0); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(); } else if (event.key === "ArrowDown" && searchResults.length) { event.preventDefault(); setActiveSearchResult((index) => (index + 1) % searchResults.length); } else if (event.key === "ArrowUp" && searchResults.length) { event.preventDefault(); setActiveSearchResult((index) => (index - 1 + searchResults.length) % searchResults.length); } else if (event.key === "Enter" && searchResults[activeSearchResult]) { event.preventDefault(); openSearchResult(searchResults[activeSearchResult]); } }} placeholder="搜索标题或备注..." autoFocus /><button type="button" aria-label="关闭搜索" onClick={() => closeSearch()}><X size={17} /></button></header>{searchQuery.trim() && <div className="canvas-search-results" id="canvas-search-results" role="listbox" aria-label="搜索结果">{searchResults.length ? searchResults.map((card, index) => <button id={`canvas-search-result-${index}`} ref={(element) => { if (element) searchResultRefs.current.set(card.id, element); else searchResultRefs.current.delete(card.id); }} type="button" role="option" aria-selected={index === activeSearchResult} className={index === activeSearchResult ? "is-active" : ""} key={card.id} onClick={() => openSearchResult(card)}><span>{card.title}</span><small>{card.status === "completed" ? `已完成 · ${card.timeConstraint ? formatTimeConstraint(card.timeConstraint, calendarNow) : "随手页"}` : card.timeConstraint ? formatTimeConstraint(card.timeConstraint, calendarNow) : "随手页"}</small>{card.notes && <small>{card.notes}</small>}</button>) : <p>没有找到相关卡片。</p>}</div>}</section></div>
      )}
    </div>
  );
}
