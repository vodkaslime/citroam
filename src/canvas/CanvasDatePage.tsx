import { Coffee, MoonStars, Sparkle, SunHorizon } from "@phosphor-icons/react";
import type { TimePeriod } from "../domain/canvas";
import { DAY_PAGE_BOUNDS, DATE_PAGE_PERIOD_BOUNDS } from "./pageGeometry";

const periodMeta: Array<{
  period: TimePeriod;
  label: string;
  icon: typeof Sparkle;
}> = [
  { period: "anytime", label: "随时", icon: Sparkle },
  { period: "morning", label: "上午", icon: Coffee },
  { period: "afternoon", label: "下午", icon: SunHorizon },
  { period: "evening", label: "晚上", icon: MoonStars },
];

interface CanvasDatePageProps {
  ariaLabel: string;
  activePeriod?: TimePeriod | null;
  zoom?: number;
}

export function CanvasDatePage({ ariaLabel, activePeriod = null, zoom = 1 }: CanvasDatePageProps) {
  const labelScale = zoom > 0 ? 1 / zoom : 1;
  return (
    <section
      className="canvas-day-page"
      role="region"
      aria-label={ariaLabel}
      style={{
        left: DAY_PAGE_BOUNDS.x,
        top: DAY_PAGE_BOUNDS.y,
        width: DAY_PAGE_BOUNDS.width,
        height: DAY_PAGE_BOUNDS.height,
      }}
    >
      <div className="canvas-day-page-periods" aria-label="时间围栏">
        {periodMeta.map(({ period, label, icon: Icon }) => {
          const bounds = DATE_PAGE_PERIOD_BOUNDS[period];
          return (
            <div
              className={`canvas-day-period is-${period}${activePeriod === period ? " is-active" : ""}`}
              key={period}
              role="group"
              aria-label={label}
              style={{ top: bounds.top - DAY_PAGE_BOUNDS.y, height: bounds.bottom - bounds.top }}
            >
              <span style={{ transform: `scale(${labelScale})`, transformOrigin: "top left" }}><Icon size={15} weight="duotone" /><strong>{label}</strong></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CanvasLoosePage() {
  return (
    <section className="canvas-loose-page" role="region" aria-label="随手页画布">
      <div className="canvas-loose-orbit is-one" aria-hidden="true" />
      <div className="canvas-loose-orbit is-two" aria-hidden="true" />
    </section>
  );
}
