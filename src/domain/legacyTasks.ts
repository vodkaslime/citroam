import { isLocalDateKey } from "./dates";

export type LegacyTaskPriority = "low" | "normal" | "high";

export interface LegacyTask {
  id: string;
  title: string;
  notes: string;
  status: "inbox" | "completed";
  priority: LegacyTaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNullableDateKey(value: unknown): value is string | null {
  return value === null || isLocalDateKey(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isLegacyTask(value: unknown): value is LegacyTask {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.notes === "string"
    && (value.status === "inbox" || value.status === "completed")
    && (value.priority === "low" || value.priority === "normal" || value.priority === "high")
    && isNullableDateKey(value.dueDate)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && isNullableString(value.completedAt);
}
