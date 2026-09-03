import type { TimeConstraint, TimePeriod } from "./canvas";

const absoluteDateFormatters = new Map<boolean, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addLocalDays(date: Date, days: number): string {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return getLocalDateKey(shifted);
}

export function isLocalDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isLocalTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isTimeConstraint(value: unknown): value is TimeConstraint {
  if (!isRecord(value)
    || !isLocalDateKey(value.date)
    || (value.period !== "anytime"
      && value.period !== "morning"
      && value.period !== "afternoon"
      && value.period !== "evening")) return false;
  if (value.startTime !== undefined && !isLocalTime(value.startTime)) return false;
  if (value.endTime !== undefined && !isLocalTime(value.endTime)) return false;
  if (value.endTime !== undefined && value.startTime === undefined) return false;
  if (typeof value.startTime === "string" && value.period !== periodForTime(value.startTime)) return false;
  return value.endTime === undefined || String(value.endTime) > String(value.startTime);
}

export function periodForTime(value: string): Exclude<TimePeriod, "anytime"> {
  const hours = Number(value.slice(0, 2));
  if (hours >= 5 && hours < 12) return "morning";
  if (hours >= 12 && hours < 18) return "afternoon";
  return "evening";
}

const periodTokens = {
  上午: "morning",
  下午: "afternoon",
  晚上: "evening",
} as const satisfies Record<string, Exclude<TimePeriod, "anytime">>;

export function parseQuickTimeToken(token: string, current = new Date()): TimeConstraint | null {
  const match = token.match(/^#(今天|明天)(上午|下午|晚上|(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const date = match[1] === "今天" ? getLocalDateKey(current) : addLocalDays(current, 1);
  const suffix = match[2];
  if (!suffix) return { date, period: "anytime" };
  if (suffix in periodTokens) {
    return { date, period: periodTokens[suffix as keyof typeof periodTokens] };
  }
  const startTime = `${String(Number(match[3])).padStart(2, "0")}:${match[4]}`;
  if (!isLocalTime(startTime)) return null;
  return { date, period: periodForTime(startTime), startTime };
}

function localDateAtNoon(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

export function formatAbsoluteDateLabel(date: string, current = new Date()): string {
  const target = localDateAtNoon(date);
  const includeYear = target.getFullYear() !== current.getFullYear();
  let formatter = absoluteDateFormatters.get(includeYear);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("zh-CN", {
      ...(includeYear ? { year: "numeric" } : {}),
      month: "long",
      day: "numeric",
    });
    absoluteDateFormatters.set(includeYear, formatter);
  }
  return formatter.format(target);
}

export function formatWeekdayLabel(date: string, locale = "zh-CN"): string {
  let formatter = weekdayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
    weekdayFormatters.set(locale, formatter);
  }
  return formatter.format(localDateAtNoon(date));
}

function relativeDateLabel(date: string, current: Date): string {
  const today = getLocalDateKey(current);
  if (date === today) return "今天";
  if (date === addLocalDays(current, 1)) return "明天";
  if (date === addLocalDays(current, -1)) return "昨天";
  return formatAbsoluteDateLabel(date, current);
}

const periodLabels = {
  anytime: "",
  morning: "上午",
  afternoon: "下午",
  evening: "晚上",
} satisfies Record<TimePeriod, string>;

export function formatTimeWithinDatePage(constraint: TimeConstraint): string {
  if (constraint.startTime) {
    return constraint.endTime
      ? `${constraint.startTime}-${constraint.endTime}`
      : constraint.startTime;
  }
  return periodLabels[constraint.period];
}

export function formatTimeConstraint(constraint: TimeConstraint, current = new Date()): string {
  const date = relativeDateLabel(constraint.date, current);
  if (constraint.startTime) {
    const clock = constraint.endTime
      ? `${constraint.startTime}-${constraint.endTime}`
      : constraint.startTime;
    return `${date} ${clock}`;
  }
  const period = periodLabels[constraint.period];
  return period ? `${date} ${period}` : date;
}

export function formatDatePageLabel(date: string, current = new Date()): string {
  const today = getLocalDateKey(current);
  const absolute = formatAbsoluteDateLabel(date, current);
  if (date === today) return `今天 ${absolute}`;
  if (date === addLocalDays(current, 1)) return `明天 ${absolute}`;
  if (date === addLocalDays(current, -1)) return `昨天 ${absolute}`;
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" })
    .format(localDateAtNoon(date));
  return `${weekday} ${absolute}`;
}
