import {
  createCard,
  LOOSE_PAGE_KEY,
  workspaceReducer,
  type CanvasPageKey,
  type Card,
  type CardPriority,
  type TimeConstraint,
  type TimePeriod,
  type Workspace,
} from "../domain/canvas";
import { addLocalDays, getLocalDateKey, periodForTime } from "../domain/dates";

export interface AgentContext {
  now: Date;
  currentPage: CanvasPageKey;
  selectedCardId: string | null;
  /** The only primary views; Agent itself is a canvas tool layer. */
  view: "canvas" | "overview";
  overviewStatus: "open" | "completed";
  /** Minimal serialized scene supplied to a real model provider. */
  workspace?: Workspace;
}

export interface AgentModel {
  interpret(request: string, context: AgentContext): Promise<AgentIntent>;
}

export type AgentTarget =
  | { kind: "id"; cardId: string }
  | { kind: "query"; query: string };

export type AgentIntent =
  | { type: "create"; title: string; timeConstraint: TimeConstraint | null; notes?: string; priority?: CardPriority | null }
  | { type: "open"; target: AgentTarget }
  | { type: "schedule"; target: AgentTarget; timeConstraint: TimeConstraint | null }
  | { type: "set-status"; target: AgentTarget; status: "open" | "completed" }
  | { type: "update"; target: AgentTarget; patch: { title?: string; notes?: string; priority?: CardPriority | null } }
  | { type: "delete"; target: AgentTarget }
  | { type: "batch-schedule"; sourceDate: string; timeConstraint: TimeConstraint | null }
  | { type: "batch-status"; sourceDate: string; status: "open" | "completed" }
  | { type: "list"; date: string; status: "open" | "completed" }
  | { type: "search"; query: string }
  | { type: "unsupported"; message: string };

export type AgentOperation =
  | { type: "create"; title: string; timeConstraint: TimeConstraint | null; notes?: string; priority?: CardPriority | null }
  | { type: "schedule"; cardId: string; timeConstraint: TimeConstraint | null }
  | { type: "set-status"; cardId: string; status: "open" | "completed" }
  | { type: "update"; cardId: string; patch: { title?: string; notes?: string; priority?: CardPriority | null } }
  | { type: "delete"; cardId: string };

export interface AgentCandidate {
  id: string;
  title: string;
  description: string;
}

export interface AgentPlan {
  kind: "execute" | "confirm" | "confirm-destructive" | "clarify" | "show" | "reject";
  message: string;
  operations: AgentOperation[];
  cardIds: string[];
  candidates: AgentCandidate[];
  sourceIntent: AgentIntent;
  /**
   * The small amount of state that must still be true when a plan is
   * confirmed. A preview must never partially apply to cards that the user
   * changed while it was open.
   */
  preconditions: AgentPrecondition[];
}

export interface AgentPrecondition {
  cardId: string;
  status: "open" | "completed";
}

interface AgentExecutionOptions {
  now: Date;
  confirmed: boolean;
  createId: () => string;
  positionFor: (
    workspace: Workspace,
    pageKey: CanvasPageKey,
    period: TimePeriod | null,
    cardId?: string,
  ) => { x: number; y: number };
}

export interface AgentExecutionResult {
  workspace: Workspace;
  changed: boolean;
  affectedCardIds: string[];
  createdCardIds: string[];
}

const weekdayIndex: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

const chineseHour: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};

const INVALID_TIME = "__invalid_time__" as const;
type ParsedTime = string | null | typeof INVALID_TIME;
type ParsedConstraint = TimeConstraint | null | undefined | typeof INVALID_TIME;

const spokenPeriod = {
  凌晨: "evening",
  早上: "morning",
  上午: "morning",
  中午: "afternoon",
  下午: "afternoon",
  晚上: "evening",
} as const satisfies Record<string, Exclude<TimePeriod, "anytime">>;

function localDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

function nextWeekday(now: Date, weekday: number, forceNextWeek: boolean): string {
  const current = now.getDay();
  let offset = (weekday - current + 7) % 7;
  if (forceNextWeek) {
    // “下周” refers to the next Monday–Sunday block. A weekday earlier
    // than today already crosses into that block, so adding seven days to
    // the naive offset would skip an extra week.
    const daysUntilNextMonday = current === 0 ? 1 : 8 - current;
    const weekdayOffset = weekday === 0 ? 6 : weekday - 1;
    offset = daysUntilNextMonday + weekdayOffset;
  }
  return addLocalDays(now, offset);
}

function dateFromText(text: string, context: AgentContext): string | null {
  const today = getLocalDateKey(context.now);
  if (text.includes("后天")) return addLocalDays(context.now, 2);
  if (text.includes("明天")) return addLocalDays(context.now, 1);
  if (text.includes("昨天")) return addLocalDays(context.now, -1);
  if (text.includes("今天")) return today;

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;

  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日?/);
  if (monthDay) {
    const year = context.now.getFullYear();
    const candidate = `${year}-${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
    if (candidate >= today) return candidate;
    return `${year + 1}-${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
  }

  const weekday = text.match(/(下周|周|星期)([一二三四五六日天])/);
  if (weekday) return nextWeekday(context.now, weekdayIndex[weekday[2]], weekday[1] === "下周");

  return null;
}

function timeFromText(text: string): ParsedTime {
  const malformedColon = text.match(/(?:^|\D)(\d{1,2}):(\d{2})(?:\D|$)/);
  if (malformedColon) {
    const hour = Number(malformedColon[1]);
    const minute = Number(malformedColon[2]);
    if (hour > 23 || minute > 59) return INVALID_TIME;
  }
  const colon = text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
  if (colon) return `${colon[1].padStart(2, "0")}:${colon[2]}`;

  const point = text.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*([一二两三四五六七八九十]{1,2}|\d{1,2})\s*点\s*(半|[0-5]?\d分?)?/);
  if (!point) return null;
  let hour = /^\d+$/.test(point[2]) ? Number(point[2]) : chineseHour[point[2]];
  if (!Number.isFinite(hour) || hour > 23) return INVALID_TIME;
  const meridiem = point[1];
  if (meridiem && hour > 12) return INVALID_TIME;
  if ((meridiem === "下午" || meridiem === "晚上") && hour < 12) hour += 12;
  if (meridiem === "中午" && hour < 11) hour += 12;
  if (meridiem === "凌晨" && hour === 12) hour = 0;
  const minute = point[3] === "半" ? 30 : Number(point[3]?.replace("分", "") || 0);
  if (minute > 59) return INVALID_TIME;
  const startTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const declaredPeriod = meridiem ? spokenPeriod[meridiem as keyof typeof spokenPeriod] : undefined;
  if (declaredPeriod && periodForTime(startTime) !== declaredPeriod) return INVALID_TIME;
  return startTime;
}

function periodFromText(text: string, startTime: string): TimePeriod {
  if (startTime) return periodForTime(startTime);
  if (text.includes("上午") || text.includes("早上")) return "morning";
  if (text.includes("下午") || text.includes("中午")) return "afternoon";
  if (text.includes("晚上") || text.includes("凌晨")) return "evening";
  return "anytime";
}

function timeConstraintFromText(text: string, context: AgentContext): ParsedConstraint {
  if (/随手页|没日期|不要日期/.test(text)) return null;
  const startTime = timeFromText(text);
  if (startTime === INVALID_TIME) return INVALID_TIME;
  const explicitDate = dateFromText(text, context);
  const hasPeriod = /上午|早上|下午|中午|晚上|凌晨|随时/.test(text);
  if (!explicitDate && !startTime && !hasPeriod) return undefined;
  const fallbackDate = context.currentPage === LOOSE_PAGE_KEY ? getLocalDateKey(context.now) : context.currentPage;
  const date = explicitDate ?? fallbackDate;
  const period = periodFromText(text, startTime ?? "");
  return startTime ? { date, period, startTime } : { date, period };
}

function stripTimeLanguage(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\d{1,2}月\d{1,2}日?/g, " ")
    .replace(/(?:下周|周|星期)[一二三四五六日天]/g, " ")
    .replace(/今天|明天|后天|昨天/g, " ")
    .replace(/(?:凌晨|早上|上午|中午|下午|晚上)?\s*(?:[一二两三四五六七八九十]{1,2}|\d{1,2})\s*点\s*(?:半|[0-5]?\d分?)?/g, " ")
    .replace(/(?:^|\D)(?:[01]?\d|2[0-3]):[0-5]\d(?=\D|$)/g, " ")
    .replace(/上午|早上|下午|中午|晚上|凌晨|随时/g, " ")
    .replace(/提醒我|提醒一下我|帮我记(?:一下)?|记得/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function targetFromText(text: string, context: AgentContext): AgentTarget | null {
  const value = text.replace(/^把/, "").trim();
  if (/^(这个|它|这张|这张卡|这张卡片|刚才那个)$/.test(value)) {
    return context.selectedCardId ? { kind: "id", cardId: context.selectedCardId } : null;
  }
  return value ? { kind: "query", query: value } : null;
}

function missingTargetIntent(): AgentIntent {
  return { type: "unsupported", message: "先打开或说出要处理的 Card，画布没有变化。" };
}

function fallbackConstraint(context: AgentContext): TimeConstraint | null {
  return context.currentPage === LOOSE_PAGE_KEY
    ? null
    : { date: context.currentPage, period: "anytime" };
}

export function interpretLocalAgent(request: string, context: AgentContext): AgentIntent {
  const text = request.trim().replace(/[。！!？?]+$/, "");
  if (!text) return { type: "unsupported", message: "说一句你想怎么处理。" };

  const openList = text.match(/^(.+?)(?:(?:还有|有|剩下|没做完)(?:什么|哪些)(?:待办|任务|事情|卡片)?|没做完的(?:待办|任务|事情|卡片)?|未完成(?:的)?(?:待办|任务|事情|卡片)?|有哪些(?:待办|任务|事情|卡片)?)$/);
  if (openList) {
    const date = dateFromText(openList[1].replace(/的$/, ""), context);
    if (date) return { type: "list", date, status: "open" };
  }

  const completedList = text.match(/^(.+?)(?:已经?|已)?(?:完成|做完)(?:了)?(?:的)?(?:(?:什么|哪些)(?:待办|任务|事情|卡片)?|待办|任务|事情|卡片)$/);
  if (completedList) {
    const date = dateFromText(completedList[1].replace(/的$/, ""), context);
    if (date) return { type: "list", date, status: "completed" };
  }

  const batchMove = text.match(/把?(今天|明天|后天|昨天)(?:还)?没做完的(?:都)?(?:放到|放进|移到|挪到|改到)(.+)$/);
  if (batchMove) {
    const sourceDate = dateFromText(batchMove[1], context)!;
    const timeConstraint = timeConstraintFromText(batchMove[2], context);
    if (timeConstraint === INVALID_TIME) return { type: "unsupported", message: "这个时间不合法，画布没有变化。" };
    if (timeConstraint !== undefined) return { type: "batch-schedule", sourceDate, timeConstraint };
  }

  const batchComplete = text.match(/把?(今天|明天|后天|昨天)(?:的)?(?:任务|卡片|事项)?(?:都)?(?:完成|做完)$/);
  if (batchComplete) {
    return { type: "batch-status", sourceDate: dateFromText(batchComplete[1], context)!, status: "completed" };
  }

  const rename = text.match(/^把?(.+?)(?:改名为|标题改成)(.+)$/);
  if (rename) {
    const target = targetFromText(rename[1], context);
    if (target && rename[2].trim()) return { type: "update", target, patch: { title: rename[2].trim() } };
    if (!target) return missingTargetIntent();
  }

  const note = text.match(/^(?:给|把)(.+?)(?:加上?备注|备注为)(.+)$/);
  if (note) {
    const target = targetFromText(note[1], context);
    if (target && note[2].trim()) return { type: "update", target, patch: { notes: note[2].trim() } };
    if (!target) return missingTargetIntent();
  }

  const priority = text.match(/^(?:把|给)?(.+?)(?:的)?(?:优先级)?(?:设为|设置为|标记为|标为|改为|改成)(高|中|低)(?:优先级)?$/);
  if (priority) {
    const target = targetFromText(priority[1], context);
    if (target) {
      const values = { 高: "high", 中: "normal", 低: "low" } as const;
      return { type: "update", target, patch: { priority: values[priority[2] as keyof typeof values] } };
    }
    return missingTargetIntent();
  }

  const schedule = text.match(/^把?(.+?)(?:放到|放进|移到|挪到|改到|改成)(.+)$/);
  if (schedule) {
    const target = targetFromText(schedule[1], context);
    const destination = schedule[2].trim();
    const timeConstraint = timeConstraintFromText(destination, context);
    if (!target) return missingTargetIntent();
    if (timeConstraint === INVALID_TIME) return { type: "unsupported", message: "这个时间不合法，画布没有变化。" };
    if (timeConstraint !== undefined) return { type: "schedule", target, timeConstraint };
    return { type: "unsupported", message: "请说清要放到哪一天或时段，画布没有变化。" };
  }

  const completeSuffix = text.match(/^把?(.+?)(?:做完了?|完成了?|标记为完成)$/);
  const completePrefix = text.match(/^(?:完成|做完)(.+)$/);
  const completeTarget = targetFromText(completeSuffix?.[1] ?? completePrefix?.[1] ?? "", context);
  if (completeTarget) return { type: "set-status", target: completeTarget, status: "completed" };
  if (completeSuffix || completePrefix) {
    return missingTargetIntent();
  }

  const restore = text.match(/^(?:恢复|重新打开|取消完成)把?(.+)$|^把?(.+?)(?:恢复|改回未完成)$/);
  const restoreTarget = targetFromText(restore?.[1] ?? restore?.[2] ?? "", context);
  if (restoreTarget) return { type: "set-status", target: restoreTarget, status: "open" };
  if (restore) {
    return missingTargetIntent();
  }

  const remove = text.match(/^(?:删除|删掉|移除)把?(.+)$|^把?(.+?)(?:删除|删掉|移除)$/);
  const removeTarget = targetFromText(remove?.[1] ?? remove?.[2] ?? "", context);
  if (removeTarget) return { type: "delete", target: removeTarget };
  if (remove) {
    return missingTargetIntent();
  }

  const open = text.match(/^打开(?:一下)?(.+)$/);
  const openTarget = targetFromText(open?.[1] ?? "", context);
  if (openTarget) return { type: "open", target: openTarget };
  if (open) return missingTargetIntent();

  const search = text.match(/^(?:找找?|搜索|看看)(?:一下)?(.+)$/);
  if (search?.[1]?.trim()) return { type: "search", query: search[1].trim() };

  if (/规划|建议|怎么安排|效率|复盘/.test(text)) {
    return { type: "unsupported", message: "我只帮你记录和处理 Card，不替你安排生活。" };
  }

  const parsedConstraint = timeConstraintFromText(text, context);
  if (parsedConstraint === INVALID_TIME) return { type: "unsupported", message: "这个时间不合法，画布没有变化。" };
  const title = stripTimeLanguage(text);
  if (!title) return { type: "unsupported", message: "我还不知道要记录什么。" };
  return {
    type: "create",
    title,
    timeConstraint: parsedConstraint === undefined ? fallbackConstraint(context) : parsedConstraint,
  };
}

export const localAgentModel: AgentModel = {
  interpret: async (request, context) => interpretLocalAgent(request, context),
};

function activeCards(workspace: Workspace): Card[] {
  return workspace.cards.filter((card) => card.status !== "deleted");
}

function matchesForTarget(workspace: Workspace, target: AgentTarget, status?: "open" | "completed"): Card[] {
  const cards = activeCards(workspace).filter((card) => !status || card.status === status);
  if (target.kind === "id") return cards.filter((card) => card.id === target.cardId);
  const normalized = target.query.toLocaleLowerCase("zh-CN");
  const exact = cards.filter((card) => card.title.toLocaleLowerCase("zh-CN") === normalized);
  if (exact.length === 1) return exact;
  return cards.filter((card) => `${card.title}\n${card.notes}`.toLocaleLowerCase("zh-CN").includes(normalized));
}

function describeDate(date: string, now: Date): string {
  const today = getLocalDateKey(now);
  if (date === today) return "今天";
  if (date === addLocalDays(now, 1)) return "明天";
  if (date === addLocalDays(now, 2)) return "后天";
  const days = Math.round((localDate(date).getTime() - localDate(today).getTime()) / 86_400_000);
  if (days > 0 && days < 7) {
    return `周${"日一二三四五六"[localDate(date).getDay()]}`;
  }
  const parsed = localDate(date);
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function describeTime(timeConstraint: TimeConstraint | null, now: Date): string {
  if (!timeConstraint) return "随手页";
  const period = timeConstraint.startTime
    ? timeConstraint.startTime
    : ({ anytime: "", morning: "上午", afternoon: "下午", evening: "晚上" } as const)[timeConstraint.period];
  return `${describeDate(timeConstraint.date, now)}${period}`;
}

function sameTimeConstraint(first: TimeConstraint | null, second: TimeConstraint | null): boolean {
  if (first === second) return true;
  if (!first || !second) return false;
  return first.date === second.date
    && first.period === second.period
    && first.startTime === second.startTime
    && first.endTime === second.endTime;
}

function candidateFromCard(card: Card, context: AgentContext): AgentCandidate {
  const location = card.timeConstraint ? describeTime(card.timeConstraint, context.now) : "随手页";
  return {
    id: card.id,
    title: card.title,
    description: `${card.status === "completed" ? "已完成" : "未完成"}，${location}`,
  };
}

function emptyPlan(kind: AgentPlan["kind"], message: string, sourceIntent: AgentIntent): AgentPlan {
  return { kind, message, operations: [], cardIds: [], candidates: [], sourceIntent, preconditions: [] };
}

function requireCardState(plan: AgentPlan, card: Card) {
  plan.preconditions.push({ cardId: card.id, status: card.status === "completed" ? "completed" : "open" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isTimeConstraint(value: unknown): value is TimeConstraint {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["date", "period", "startTime", "endTime"])
    || !isDateKey(value.date)
    || !["anytime", "morning", "afternoon", "evening"].includes(String(value.period))) return false;
  if (value.startTime !== undefined && !isClockTime(value.startTime)) return false;
  if (value.endTime !== undefined && !isClockTime(value.endTime)) return false;
  if (value.endTime !== undefined && value.startTime === undefined) return false;
  if (typeof value.startTime === "string" && value.period !== periodForTime(value.startTime)) return false;
  if (typeof value.startTime === "string"
    && typeof value.endTime === "string"
    && value.endTime <= value.startTime) return false;
  return true;
}

function isNullableTimeConstraint(value: unknown): value is TimeConstraint | null {
  return value === null || isTimeConstraint(value);
}

function isAgentTarget(value: unknown): value is AgentTarget {
  if (!isRecord(value) || !hasOnlyKeys(value, ["kind", "cardId", "query"])) return false;
  if (value.kind === "id") return typeof value.cardId === "string" && Boolean(value.cardId.trim()) && value.query === undefined;
  if (value.kind === "query") return typeof value.query === "string" && Boolean(value.query.trim()) && value.cardId === undefined;
  return false;
}

function isPriority(value: unknown): value is CardPriority | null | undefined {
  return value === undefined || value === null || value === "high" || value === "normal" || value === "low";
}

function parseAgentIntent(value: unknown): AgentIntent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "create":
      return hasOnlyKeys(value, ["type", "title", "timeConstraint", "notes", "priority"])
        && typeof value.title === "string" && Boolean(value.title.trim())
        && isNullableTimeConstraint(value.timeConstraint)
        && (value.notes === undefined || typeof value.notes === "string")
        && isPriority(value.priority)
        ? value as unknown as AgentIntent
        : null;
    case "schedule":
      return hasOnlyKeys(value, ["type", "target", "timeConstraint"])
        && isAgentTarget(value.target) && isNullableTimeConstraint(value.timeConstraint)
        ? value as unknown as AgentIntent
        : null;
    case "open":
      return hasOnlyKeys(value, ["type", "target"]) && isAgentTarget(value.target)
        ? value as unknown as AgentIntent
        : null;
    case "set-status":
      return hasOnlyKeys(value, ["type", "target", "status"])
        && isAgentTarget(value.target) && (value.status === "open" || value.status === "completed")
        ? value as unknown as AgentIntent
        : null;
    case "update": {
      if (!hasOnlyKeys(value, ["type", "target", "patch"]) || !isAgentTarget(value.target) || !isRecord(value.patch)) return null;
      const patch = value.patch;
      const valid = hasOnlyKeys(patch, ["title", "notes", "priority"])
        && Object.keys(patch).length > 0
        && (patch.title === undefined || (typeof patch.title === "string" && Boolean(patch.title.trim())))
        && (patch.notes === undefined || typeof patch.notes === "string")
        && isPriority(patch.priority);
      return valid ? value as unknown as AgentIntent : null;
    }
    case "delete":
      return hasOnlyKeys(value, ["type", "target"]) && isAgentTarget(value.target)
        ? value as unknown as AgentIntent
        : null;
    case "batch-schedule":
      return hasOnlyKeys(value, ["type", "sourceDate", "timeConstraint"])
        && isDateKey(value.sourceDate) && isNullableTimeConstraint(value.timeConstraint)
        ? value as unknown as AgentIntent
        : null;
    case "batch-status":
      return hasOnlyKeys(value, ["type", "sourceDate", "status"])
        && isDateKey(value.sourceDate) && (value.status === "open" || value.status === "completed")
        ? value as unknown as AgentIntent
        : null;
    case "list":
      return hasOnlyKeys(value, ["type", "date", "status"])
        && isDateKey(value.date) && (value.status === "open" || value.status === "completed")
        ? value as unknown as AgentIntent
        : null;
    case "search":
      return hasOnlyKeys(value, ["type", "query"])
        && typeof value.query === "string" && Boolean(value.query.trim())
        ? value as unknown as AgentIntent
        : null;
    case "unsupported":
      return hasOnlyKeys(value, ["type", "message"])
        && typeof value.message === "string" && Boolean(value.message.trim())
        ? value as unknown as AgentIntent
        : null;
    default:
      return null;
  }
}

function targetPlan(
  intent: AgentIntent,
  workspace: Workspace,
  context: AgentContext,
  target: AgentTarget,
  status?: "open" | "completed",
): { card: Card } | { plan: AgentPlan } {
  const matches = matchesForTarget(workspace, target, status);
  const query = target.kind === "query" ? target.query : "这张 Card";
  if (matches.length === 0) return { plan: emptyPlan("reject", `没有找到“${query}”。`, intent) };
  if (matches.length > 1) {
    const plan = emptyPlan("clarify", `找到${matches.length === 2 ? "两" : matches.length}张“${query}”，你指哪一张？`, intent);
    plan.candidates = matches.slice(0, 5).map((card) => candidateFromCard(card, context));
    return { plan };
  }
  return { card: matches[0] };
}

export function prepareAgentPlan(modelOutput: unknown, workspace: Workspace, context: AgentContext): AgentPlan {
  const intent = parseAgentIntent(modelOutput);
  if (!intent) {
    const rejected: AgentIntent = { type: "unsupported", message: "现在没有处理成功，画布没有变化。" };
    return emptyPlan("reject", rejected.message, rejected);
  }
  switch (intent.type) {
    case "unsupported":
      return emptyPlan("reject", intent.message, intent);
    case "create": {
      const plan = emptyPlan("execute", `好，放到${describeTime(intent.timeConstraint, context.now)}了。`, intent);
      plan.operations = [{ ...intent, type: "create" }];
      return plan;
    }
    case "open": {
      const resolved = targetPlan(intent, workspace, context, intent.target);
      if ("plan" in resolved) return resolved.plan;
      const plan = emptyPlan("show", "找到了。", intent);
      plan.cardIds = [resolved.card.id];
      return plan;
    }
    case "schedule": {
      // Scheduling is metadata maintenance and remains valid for completed
      // cards too. Only deleted cards are excluded by targetPlan's active
      // card filter; completion state is preserved by the operation.
      const resolved = targetPlan(intent, workspace, context, intent.target);
      if ("plan" in resolved) return resolved.plan;
      const plan = emptyPlan("execute", `好，放到${describeTime(intent.timeConstraint, context.now)}了。`, intent);
      plan.operations = [{ type: "schedule", cardId: resolved.card.id, timeConstraint: intent.timeConstraint }];
      plan.cardIds = [resolved.card.id];
      requireCardState(plan, resolved.card);
      return plan;
    }
    case "set-status": {
      const sourceStatus = intent.status === "completed" ? "open" : "completed";
      const resolved = targetPlan(intent, workspace, context, intent.target, sourceStatus);
      if ("plan" in resolved) return resolved.plan;
      const plan = emptyPlan("execute", intent.status === "completed" ? "完成了。" : "恢复了。", intent);
      plan.operations = [{ type: "set-status", cardId: resolved.card.id, status: intent.status }];
      plan.cardIds = [resolved.card.id];
      requireCardState(plan, resolved.card);
      return plan;
    }
    case "update": {
      const resolved = targetPlan(intent, workspace, context, intent.target);
      if ("plan" in resolved) return resolved.plan;
      const plan = emptyPlan("execute", "好，已经改好了。", intent);
      plan.operations = [{ type: "update", cardId: resolved.card.id, patch: intent.patch }];
      plan.cardIds = [resolved.card.id];
      requireCardState(plan, resolved.card);
      return plan;
    }
    case "delete": {
      const resolved = targetPlan(intent, workspace, context, intent.target);
      if ("plan" in resolved) return resolved.plan;
      const plan = emptyPlan("confirm-destructive", `会删除“${resolved.card.title}”。`, intent);
      plan.operations = [{ type: "delete", cardId: resolved.card.id }];
      plan.cardIds = [resolved.card.id];
      requireCardState(plan, resolved.card);
      return plan;
    }
    case "batch-schedule": {
      const cards = activeCards(workspace).filter((card) => card.status === "open" && card.timeConstraint?.date === intent.sourceDate);
      if (cards.length === 0) return emptyPlan("reject", "这一天没有未完成的 Card。", intent);
      const target = describeTime(intent.timeConstraint, context.now);
      const plan = emptyPlan("confirm", `会移动 ${cards.length} 张 Card 到${target}。`, intent);
      plan.operations = cards.map((card) => ({ type: "schedule", cardId: card.id, timeConstraint: intent.timeConstraint }));
      plan.cardIds = cards.map((card) => card.id);
      cards.forEach((card) => requireCardState(plan, card));
      return plan;
    }
    case "batch-status": {
      const cards = activeCards(workspace).filter((card) => card.status !== intent.status && card.timeConstraint?.date === intent.sourceDate);
      if (cards.length === 0) return emptyPlan("reject", "这一天没有可以处理的 Card。", intent);
      const plan = emptyPlan("confirm", `会${intent.status === "completed" ? "完成" : "恢复"} ${cards.length} 张 Card。`, intent);
      plan.operations = cards.map((card) => ({ type: "set-status", cardId: card.id, status: intent.status }));
      plan.cardIds = cards.map((card) => card.id);
      cards.forEach((card) => requireCardState(plan, card));
      return plan;
    }
    case "list": {
      const cards = activeCards(workspace).filter((card) => card.status === intent.status && card.timeConstraint?.date === intent.date);
      const dateLabel = describeDate(intent.date, context.now);
      const statusLabel = intent.status === "completed" ? "已完成" : "未完成";
      const plan = emptyPlan("show", cards.length
        ? `${dateLabel}${intent.status === "completed" ? "有" : "还有"} ${cards.length} 张${statusLabel}。`
        : `${dateLabel}没有${statusLabel}的 Card。`, intent);
      plan.cardIds = cards.map((card) => card.id);
      plan.candidates = cards.slice(0, 5).map((card) => candidateFromCard(card, context));
      return plan;
    }
    case "search": {
      const matches = activeCards(workspace).filter((card) => `${card.title}\n${card.notes}`
        .toLocaleLowerCase("zh-CN").includes(intent.query.toLocaleLowerCase("zh-CN")));
      const plan = emptyPlan("show", matches.length ? `找到 ${matches.length} 张相关 Card。` : `没有找到“${intent.query}”。`, intent);
      plan.cardIds = matches.map((card) => card.id);
      plan.candidates = matches.slice(0, 5).map((card) => candidateFromCard(card, context));
      return plan;
    }
  }
}

export function retargetAgentIntent(intent: AgentIntent, cardId: string): AgentIntent {
  if (intent.type === "open" || intent.type === "schedule" || intent.type === "set-status" || intent.type === "update" || intent.type === "delete") {
    return { ...intent, target: { kind: "id", cardId } };
  }
  return intent;
}

function canExecute(plan: AgentPlan, confirmed: boolean): boolean {
  if (plan.kind === "execute") return true;
  return confirmed && (plan.kind === "confirm" || plan.kind === "confirm-destructive");
}

export function executeAgentPlan(
  workspace: Workspace,
  plan: AgentPlan,
  options: AgentExecutionOptions,
): AgentExecutionResult {
  if (!canExecute(plan, options.confirmed)) {
    return { workspace, changed: false, affectedCardIds: [], createdCardIds: [] };
  }

  const referencedIds = plan.operations.flatMap((operation) => operation.type === "create" ? [] : [operation.cardId]);
  if (referencedIds.some((id) => !workspace.cards.some((card) => card.id === id && card.status !== "deleted"))) {
    return { workspace, changed: false, affectedCardIds: [], createdCardIds: [] };
  }
  if (plan.preconditions.some((precondition) => {
    const card = workspace.cards.find((item) => item.id === precondition.cardId);
    return !card || card.status !== precondition.status;
  })) {
    return { workspace, changed: false, affectedCardIds: [], createdCardIds: [] };
  }

  let next = workspace;
  const affectedCardIds: string[] = [];
  const createdCardIds: string[] = [];

  for (const operation of plan.operations) {
    switch (operation.type) {
      case "create": {
        const id = options.createId();
        const card = createCard(operation, { id, now: options.now });
        const pageKey = operation.timeConstraint?.date ?? LOOSE_PAGE_KEY;
        const position = options.positionFor(next, pageKey, operation.timeConstraint?.period ?? null);
        next = workspaceReducer(next, { type: "add-card", card, pageKey, position });
        affectedCardIds.push(id);
        createdCardIds.push(id);
        break;
      }
      case "schedule": {
        const card = next.cards.find((item) => item.id === operation.cardId);
        if (!card || sameTimeConstraint(card.timeConstraint, operation.timeConstraint)) break;
        const pageKey = operation.timeConstraint?.date ?? LOOSE_PAGE_KEY;
        const position = options.positionFor(next, pageKey, operation.timeConstraint?.period ?? null, operation.cardId);
        next = workspaceReducer(next, {
          type: "schedule-card",
          cardId: operation.cardId,
          timeConstraint: operation.timeConstraint,
          position,
          now: options.now,
        });
        affectedCardIds.push(operation.cardId);
        break;
      }
      case "set-status": {
        const card = next.cards.find((item) => item.id === operation.cardId)!;
        if (card.status !== operation.status) {
          next = workspaceReducer(next, { type: "toggle-card", cardId: operation.cardId, now: options.now });
          affectedCardIds.push(operation.cardId);
        }
        break;
      }
      case "update":
        next = workspaceReducer(next, { type: "update-card", cardId: operation.cardId, patch: operation.patch, now: options.now });
        affectedCardIds.push(operation.cardId);
        break;
      case "delete":
        next = workspaceReducer(next, { type: "delete-card", cardId: operation.cardId, now: options.now });
        affectedCardIds.push(operation.cardId);
        break;
    }
  }

  return {
    workspace: next,
    changed: next !== workspace,
    affectedCardIds,
    createdCardIds,
  };
}
