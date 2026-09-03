import * as dates from "./dates";

const NOW = new Date("2026-08-24T09:00:00+08:00");

function exportedFunction(name: string): (...args: unknown[]) => unknown {
  const candidate = (dates as Record<string, unknown>)[name];
  expect(candidate, `${name} should be exported`).toBeTypeOf("function");
  return typeof candidate === "function" ? candidate as (...args: unknown[]) => unknown : () => undefined;
}

describe("local time primitives", () => {
  it("validates 24 hour local clock values", () => {
    const isLocalTime = exportedFunction("isLocalTime");

    expect(isLocalTime("00:00")).toBe(true);
    expect(isLocalTime("23:59")).toBe(true);
    expect(isLocalTime("24:00")).toBe(false);
    expect(isLocalTime("9:30")).toBe(false);
  });

  it("maps exact times into the three soft periods", () => {
    const periodForTime = exportedFunction("periodForTime");

    expect(periodForTime("08:30")).toBe("morning");
    expect(periodForTime("14:00")).toBe("afternoon");
    expect(periodForTime("21:15")).toBe("evening");
    expect(periodForTime("01:00")).toBe("evening");
  });

  it("accepts only internally consistent time constraints", () => {
    const isTimeConstraint = exportedFunction("isTimeConstraint");

    expect(isTimeConstraint({
      date: "2026-08-24",
      period: "afternoon",
      startTime: "14:00",
      endTime: "15:00",
    })).toBe(true);
    expect(isTimeConstraint({ date: "2026-02-30", period: "anytime" })).toBe(false);
    expect(isTimeConstraint({ date: "2026-08-24", period: "morning", startTime: "14:00" })).toBe(false);
    expect(isTimeConstraint({ date: "2026-08-24", period: "afternoon", endTime: "15:00" })).toBe(false);
    expect(isTimeConstraint({
      date: "2026-08-24",
      period: "afternoon",
      startTime: "14:00",
      endTime: "13:00",
    })).toBe(false);
  });
});

describe("quick time syntax", () => {
  it("parses a date, soft period and exact time without natural language guessing", () => {
    const parseQuickTimeToken = exportedFunction("parseQuickTimeToken");

    expect(parseQuickTimeToken("#今天", NOW)).toEqual({
      date: "2026-08-24",
      period: "anytime",
    });
    expect(parseQuickTimeToken("#明天下午", NOW)).toEqual({
      date: "2026-08-25",
      period: "afternoon",
    });
    expect(parseQuickTimeToken("#今天14:00", NOW)).toEqual({
      date: "2026-08-24",
      period: "afternoon",
      startTime: "14:00",
    });
    expect(parseQuickTimeToken("#今天24:00", NOW)).toBeNull();
    expect(parseQuickTimeToken("#下个月有空", NOW)).toBeNull();
  });
});

describe("friendly time labels", () => {
  it("formats only the time precision needed inside a date page", () => {
    const formatTimeWithinDatePage = exportedFunction("formatTimeWithinDatePage");

    expect(formatTimeWithinDatePage({ date: "2026-08-24", period: "anytime" })).toBe("");
    expect(formatTimeWithinDatePage({ date: "2026-08-24", period: "morning" })).toBe("上午");
    expect(formatTimeWithinDatePage({
      date: "2026-08-24",
      period: "afternoon",
      startTime: "14:00",
      endTime: "15:00",
    })).toBe("14:00-15:00");
  });

  it("formats card times without red overdue language", () => {
    const formatTimeConstraint = exportedFunction("formatTimeConstraint");

    expect(formatTimeConstraint({ date: "2026-08-24", period: "afternoon" }, NOW)).toBe("今天 下午");
    expect(formatTimeConstraint({
      date: "2026-08-25",
      period: "afternoon",
      startTime: "14:00",
      endTime: "15:00",
    }, NOW)).toBe("明天 14:00-15:00");
    expect(formatTimeConstraint({ date: "2026-08-23", period: "anytime" }, NOW)).toBe("昨天");
    expect(formatTimeConstraint({ date: "2026-08-20", period: "anytime" }, NOW)).toBe("8月20日");
  });

  it("keeps an absolute date visible on every date page", () => {
    const formatDatePageLabel = exportedFunction("formatDatePageLabel");

    expect(formatDatePageLabel("2026-08-24", NOW)).toBe("今天 8月24日");
    expect(formatDatePageLabel("2026-08-23", NOW)).toBe("昨天 8月23日");
    expect(formatDatePageLabel("2026-08-26", NOW)).toBe("周三 8月26日");
  });

  it("adds the year only when a date leaves the current year", () => {
    const formatTimeConstraint = exportedFunction("formatTimeConstraint");
    const formatDatePageLabel = exportedFunction("formatDatePageLabel");

    expect(formatTimeConstraint({ date: "2026-12-30", period: "anytime" }, NOW)).toBe("12月30日");
    expect(formatTimeConstraint({ date: "2027-01-02", period: "morning" }, NOW)).toBe("2027年1月2日 上午");
    expect(formatDatePageLabel("2027-01-02", NOW)).toContain("2027年1月2日");
  });
});
