import { DATE_PAGE_PERIOD_BOUNDS, DAY_PAGE_BOUNDS, clampCardToDatePage, fitDatePageView, periodAtDatePagePosition, suggestDatePagePosition } from "./pageGeometry";

describe("date page geometry", () => {
  it("keeps a card inside the page and its soft time region", () => {
    const position = clampCardToDatePage({ x: 9999, y: -200 }, "afternoon");

    expect(position.x).toBeLessThanOrEqual(DAY_PAGE_BOUNDS.x + DAY_PAGE_BOUNDS.width - 248 - 28);
    expect(periodAtDatePagePosition(position)).toBe("afternoon");
  });

  it("leaves a card free to rest outside the soft time regions", () => {
    const position = clampCardToDatePage({ x: 300, y: -200 });

    expect(position.y).toBe(DAY_PAGE_BOUNDS.y + 24);
    expect(periodAtDatePagePosition(position)).toBeNull();
    expect(periodAtDatePagePosition({ x: 300, y: 246 })).toBeNull();
  });

  it("maps a freely dropped card to the region under its center", () => {
    expect(periodAtDatePagePosition({ x: 300, y: 190 })).toBe("anytime");
    expect(periodAtDatePagePosition({ x: 300, y: 370 })).toBe("morning");
    expect(periodAtDatePagePosition({ x: 300, y: 535 })).toBe("afternoon");
    expect(periodAtDatePagePosition({ x: 300, y: 700 })).toBe("evening");
  });

  it("treats a card beyond a region's horizontal edge as outside the fence", () => {
    expect(periodAtDatePagePosition({ x: -200, y: 370 })).toBeNull();
    expect(periodAtDatePagePosition({ x: 1400, y: 370 })).toBeNull();
  });

  it("keeps breathing room between adjacent time regions", () => {
    const regions = ["anytime", "morning", "afternoon", "evening"] as const;

    regions.slice(0, -1).forEach((period, index) => {
      const next = regions[index + 1];
      expect(DATE_PAGE_PERIOD_BOUNDS[next].top - DATE_PAGE_PERIOD_BOUNDS[period].bottom).toBeGreaterThanOrEqual(20);
    });
  });

  it("suggests lightly staggered positions without creating a strict list", () => {
    const first = suggestDatePagePosition("morning", 0);
    const second = suggestDatePagePosition("morning", 1);

    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).not.toBe(first.y);
    expect(periodAtDatePagePosition(first)).toBe("morning");
    expect(periodAtDatePagePosition(second)).toBe("morning");
  });

  it("fits a date page around cards that escaped the scene boundary", () => {
    const fitted = fitDatePageView([
      { x: 3000, y: 1020 },
    ], { width: 1200, height: 700 });

    expect(fitted.zoom).toBeLessThan(0.4);
    expect(fitted.x).toBeLessThan(DAY_PAGE_BOUNDS.x);
    expect(fitted.y).toBeLessThan(DAY_PAGE_BOUNDS.y);
  });
});
