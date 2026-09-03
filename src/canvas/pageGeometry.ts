import type { TimePeriod } from "../domain/canvas";

export const DAY_PAGE_BOUNDS = {
  x: 72,
  y: 48,
  width: 1240,
  height: 820,
} as const;

export const DATE_PAGE_CARD_SIZE = { width: 248, height: 112 } as const;

export const DATE_PAGE_PERIOD_BOUNDS: Record<TimePeriod, { top: number; bottom: number }> = {
  anytime: { top: 150, bottom: 296 },
  morning: { top: 320, bottom: 472 },
  afternoon: { top: 496, bottom: 648 },
  evening: { top: 672, bottom: 820 },
};

export function fitDatePageView(
  placements: Array<{ x: number; y: number }>,
  viewport: { width: number; height: number },
): { x: number; y: number; zoom: number } {
  const padding = 72;
  const bounds = [
    {
      left: DAY_PAGE_BOUNDS.x,
      top: DAY_PAGE_BOUNDS.y,
      right: DAY_PAGE_BOUNDS.x + DAY_PAGE_BOUNDS.width,
      bottom: DAY_PAGE_BOUNDS.y + DAY_PAGE_BOUNDS.height,
    },
    ...placements.map((placement) => ({
      left: placement.x,
      top: placement.y,
      right: placement.x + DATE_PAGE_CARD_SIZE.width,
      bottom: placement.y + DATE_PAGE_CARD_SIZE.height,
    })),
  ];
  const left = Math.min(...bounds.map((bound) => bound.left)) - padding;
  const top = Math.min(...bounds.map((bound) => bound.top)) - padding;
  const right = Math.max(...bounds.map((bound) => bound.right)) + padding;
  const bottom = Math.max(...bounds.map((bound) => bound.bottom)) + padding;
  const width = Math.max(320, viewport.width);
  const height = Math.max(240, viewport.height);
  return {
    x: left,
    y: top,
    zoom: Math.min(1, width / Math.max(1, right - left), height / Math.max(1, bottom - top)),
  };
}

const DATE_PAGE_PERIOD_HORIZONTAL_INSETS: Record<TimePeriod, { left: number; right: number }> = {
  anytime: { left: 18, right: DAY_PAGE_BOUNDS.width * 0.1 },
  morning: { left: DAY_PAGE_BOUNDS.width * 0.06, right: 18 },
  afternoon: { left: DAY_PAGE_BOUNDS.width * 0.03, right: DAY_PAGE_BOUNDS.width * 0.06 },
  evening: { left: DAY_PAGE_BOUNDS.width * 0.05, right: DAY_PAGE_BOUNDS.width * 0.12 },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function periodAtDatePagePosition(position: { x: number; y: number }): TimePeriod | null {
  const centerY = position.y + DATE_PAGE_CARD_SIZE.height / 2;
  const centerX = position.x + DATE_PAGE_CARD_SIZE.width / 2;
  let period: TimePeriod | null = null;
  if (centerY < DATE_PAGE_PERIOD_BOUNDS.anytime.top) return null;
  if (centerY < DATE_PAGE_PERIOD_BOUNDS.anytime.bottom) period = "anytime";
  else if (centerY < DATE_PAGE_PERIOD_BOUNDS.morning.top) return null;
  else if (centerY < DATE_PAGE_PERIOD_BOUNDS.morning.bottom) period = "morning";
  else if (centerY < DATE_PAGE_PERIOD_BOUNDS.afternoon.top) return null;
  else if (centerY < DATE_PAGE_PERIOD_BOUNDS.afternoon.bottom) period = "afternoon";
  else if (centerY < DATE_PAGE_PERIOD_BOUNDS.evening.top) return null;
  else if (centerY > DATE_PAGE_PERIOD_BOUNDS.evening.bottom) return null;
  else period = "evening";
  const horizontal = DATE_PAGE_PERIOD_HORIZONTAL_INSETS[period];
  if (centerX < DAY_PAGE_BOUNDS.x + horizontal.left
    || centerX > DAY_PAGE_BOUNDS.x + DAY_PAGE_BOUNDS.width - horizontal.right) return null;
  return period;
}

export function clampCardToDatePage(
  position: { x: number; y: number },
  period?: TimePeriod | null,
): { x: number; y: number } {
  const lane = period ? DATE_PAGE_PERIOD_BOUNDS[period] : null;
  return {
    x: clamp(
      position.x,
      DAY_PAGE_BOUNDS.x + 28,
      DAY_PAGE_BOUNDS.x + DAY_PAGE_BOUNDS.width - DATE_PAGE_CARD_SIZE.width - 28,
    ),
    y: clamp(
      position.y,
      lane ? lane.top + 16 : DAY_PAGE_BOUNDS.y + 24,
      lane ? lane.bottom - DATE_PAGE_CARD_SIZE.height - 14 : DAY_PAGE_BOUNDS.y + DAY_PAGE_BOUNDS.height - DATE_PAGE_CARD_SIZE.height - 24,
    ),
  };
}

export function suggestDatePagePosition(period: TimePeriod, index: number): { x: number; y: number } {
  const column = index % 4;
  const cycle = Math.floor(index / 4);
  const lane = DATE_PAGE_PERIOD_BOUNDS[period];
  return clampCardToDatePage({
    x: DAY_PAGE_BOUNDS.x + 48 + column * 286 + (cycle % 2) * 18,
    y: lane.top + 22 + ((index * 13) % 28),
  }, period);
}
