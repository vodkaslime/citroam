import { createCard, createEmptyWorkspace, workspaceReducer } from "../domain/canvas";
import type { LegacyTask } from "../domain/legacyTasks";
import { createWorkspaceRepository, parseWorkspaceDocument } from "./workspaceRepository";

const tauriStore = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const save = vi.fn(async () => undefined);
  const load = vi.fn(async () => ({
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    save,
  }));
  return { values, save, load };
});

vi.mock("@tauri-apps/plugin-store", () => ({ load: tauriStore.load }));

describe("browser workspace repository", () => {
  it("accepts a valid workspace backup and rejects malformed data", () => {
    const workspace = createEmptyWorkspace(new Date("2026-08-24T09:00:00+08:00"));

    expect(parseWorkspaceDocument(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
    expect(() => parseWorkspaceDocument({ schemaVersion: 3 })).toThrow("无法读取本地画布");
  });

  it("rejects a v3 backup that places an area on a date page", () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const workspace = createEmptyWorkspace(now);
    const malformed = {
      ...workspace,
      areas: [{
        id: "date-area",
        canvasId: workspace.canvas.id,
        pageKey: "2026-08-24",
        title: "日期页区域",
        x: 100,
        y: 120,
        width: 520,
        height: 320,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }],
    };

    expect(() => parseWorkspaceDocument(malformed)).toThrow("无法读取本地画布");
  });

  it("migrates tasks stored under the legacy key", async () => {
    const timestamp = new Date("2026-08-18T09:00:00+08:00").toISOString();
    const task: LegacyTask = {
      id: "legacy-task",
      title: "保留改造前的待办",
      notes: "不能丢",
      status: "inbox",
      priority: "normal",
      dueDate: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    localStorage.setItem("notes.tasks", JSON.stringify([task]));

    const workspace = await createWorkspaceRepository().load();

    expect(workspace.cards[0]).toMatchObject({
      id: "legacy-task",
      title: "保留改造前的待办",
      notes: "不能丢",
      status: "open",
    });
    expect(workspace.placements[0].cardId).toBe("legacy-task");
  });

  it("rejects malformed legacy task arrays without overwriting them", async () => {
    const malformed = JSON.stringify([{ id: "broken-task", title: "缺少其余字段" }]);
    localStorage.setItem("notes.tasks", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取旧版待办");
    expect(localStorage.getItem("notes.tasks")).toBe(malformed);
    expect(localStorage.getItem("citroam.workspace")).toBeNull();
  });

  it("persists and reloads the versioned workspace", async () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const card = createCard({ title: "周末去游泳" }, { id: "card-1", now });
    const workspace = workspaceReducer(createEmptyWorkspace(now), {
      type: "add-card",
      card,
      position: { x: 320, y: 240 },
    });
    const repository = createWorkspaceRepository();

    await repository.save(workspace);

    await expect(repository.load()).resolves.toEqual(workspace);
  });

  it("migrates a stored schema v1 canvas without losing its dates or positions", async () => {
    const timestamp = new Date("2026-08-20T09:00:00+08:00").toISOString();
    const storedV1 = {
      schemaVersion: 1,
      canvas: {
        id: "main-canvas",
        title: "我的画布",
        viewportX: 40,
        viewportY: 70,
        zoom: 0.9,
        updatedAt: timestamp,
      },
      cards: [{
        id: "v1-card",
        schemaVersion: 1,
        title: "旧画布里的事项",
        notes: "位置和日期都要保留",
        status: "open",
        priority: "normal",
        date: "2026-08-27",
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      }],
      placements: [{
        cardId: "v1-card",
        canvasId: "main-canvas",
        x: 480,
        y: 320,
        zIndex: 3,
        areaId: null,
        updatedAt: timestamp,
      }],
      areas: [],
    };
    localStorage.setItem("citroam.workspace", JSON.stringify(storedV1));

    const migrated = await createWorkspaceRepository().load();

    expect(migrated).toMatchObject({ schemaVersion: 3 });
    expect(migrated).not.toHaveProperty("timeFences");
    expect(migrated.cards[0]).toMatchObject({
      id: "v1-card",
      schemaVersion: 2,
      timeConstraint: { date: "2026-08-27", period: "anytime" },
    });
    expect(migrated.cards[0]).not.toHaveProperty("date");
    expect(migrated.placements[0]).toMatchObject({
      x: 480,
      y: 320,
      pageKey: "2026-08-27",
    });
    expect(migrated.placements[0]).not.toHaveProperty("timeFenceId");
  });

  it("migrates schema v2 time fences into virtual date pages", async () => {
    const timestamp = new Date("2026-08-24T09:00:00+08:00").toISOString();
    const storedV2 = {
      schemaVersion: 2,
      canvas: {
        id: "main-canvas",
        title: "我的画布",
        viewportX: 0,
        viewportY: 0,
        zoom: 1,
        updatedAt: timestamp,
      },
      cards: [
        {
          id: "scheduled",
          schemaVersion: 2,
          title: "下午去取咖啡豆",
          notes: "",
          status: "open",
          priority: null,
          timeConstraint: { date: "2026-08-25", period: "afternoon" },
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        },
        {
          id: "loose",
          schemaVersion: 2,
          title: "还没想好放哪",
          notes: "",
          status: "open",
          priority: null,
          timeConstraint: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        },
      ],
      placements: [
        {
          cardId: "scheduled",
          canvasId: "main-canvas",
          x: 420,
          y: 460,
          zIndex: 1,
          areaId: null,
          timeFenceId: "fence-today",
          updatedAt: timestamp,
        },
        {
          cardId: "loose",
          canvasId: "main-canvas",
          x: 180,
          y: 160,
          zIndex: 2,
          areaId: null,
          timeFenceId: null,
          updatedAt: timestamp,
        },
      ],
      areas: [{
        id: "area-1",
        canvasId: "main-canvas",
        title: "随手的一组",
        x: 100,
        y: 80,
        width: 520,
        height: 340,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      timeFences: [{
        id: "fence-today",
        canvasId: "main-canvas",
        date: "2026-08-25",
        x: 100,
        y: 80,
        width: 900,
        height: 680,
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
    };
    localStorage.setItem("citroam.workspace", JSON.stringify(storedV2));

    const migrated = await createWorkspaceRepository().load();

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated).not.toHaveProperty("timeFences");
    expect(migrated.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "scheduled", pageKey: "2026-08-25" }),
      expect.objectContaining({ cardId: "loose", pageKey: "loose", x: 180, y: 160 }),
    ]));
    expect(migrated.placements[0]).not.toHaveProperty("timeFenceId");
    expect(migrated.areas[0]).toMatchObject({ pageKey: "loose" });
  });

  it("reports corrupt stored content instead of presenting a fake empty canvas", async () => {
    const corrupt = "{this is not valid json";
    localStorage.setItem("citroam.workspace", corrupt);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(corrupt);
  });

  it("rejects a workspace whose canvas data is incomplete", async () => {
    const malformed = JSON.stringify({
      schemaVersion: 2,
      canvas: {},
      cards: [],
      placements: [],
      areas: [],
      timeFences: [],
    });
    localStorage.setItem("citroam.workspace", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(malformed);
  });

  it("rejects duplicate card identities instead of rendering an ambiguous canvas", async () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const card = createCard({ title: "不会重复" }, { id: "card-1", now });
    const workspace = workspaceReducer(createEmptyWorkspace(now), {
      type: "add-card",
      card,
      position: { x: 120, y: 160 },
    });
    const malformed = JSON.stringify({
      ...workspace,
      cards: [...workspace.cards, { ...card, title: "重复身份" }],
    });
    localStorage.setItem("citroam.workspace", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(malformed);
  });

  it("rejects an invalid stored card time before it can crash rendering", async () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const card = createCard({ title: "日期坏掉了" }, { id: "card-1", now });
    const valid = workspaceReducer(createEmptyWorkspace(now), {
      type: "add-card",
      card,
      position: { x: 120, y: 160 },
    });
    const malformed = JSON.stringify({
      ...valid,
      cards: [{ ...card, timeConstraint: { date: "2026-02-30", period: "afternoon" } }],
      placements: [{ ...valid.placements[0], pageKey: "2026-02-30" }],
    });
    localStorage.setItem("citroam.workspace", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(malformed);
  });

  it("rejects a stored exact time whose period disagrees with its clock", async () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const card = createCard({ title: "时间语义不能打架" }, { id: "card-1", now });
    const workspace = workspaceReducer(createEmptyWorkspace(now), {
      type: "add-card",
      card: {
        ...card,
        timeConstraint: {
          date: "2026-08-24",
          period: "morning",
          startTime: "14:00",
        },
      },
      position: { x: 120, y: 160 },
    });
    const malformed = JSON.stringify(workspace);
    localStorage.setItem("citroam.workspace", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(malformed);
  });

  it("rejects a card whose page key belongs to a different date", async () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const card = createCard({
      title: "不能落错日期",
      timeConstraint: { date: "2026-08-26", period: "morning" },
    }, { id: "card-1", now });
    const workspace = workspaceReducer(createEmptyWorkspace(now), {
      type: "add-card",
      card,
      position: { x: 120, y: 160 },
    });
    const malformed = JSON.stringify({
      ...workspace,
      placements: [{ ...workspace.placements[0], pageKey: "2026-08-25" }],
    });
    localStorage.setItem("citroam.workspace", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(malformed);
  });

  it("rejects legacy date-container fields masquerading as schema v3", async () => {
    const now = new Date("2026-08-24T09:00:00+08:00");
    const workspace = createEmptyWorkspace(now);
    const malformed = JSON.stringify({ ...workspace, timeFences: [] });
    localStorage.setItem("citroam.workspace", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取本地画布");
    expect(localStorage.getItem("citroam.workspace")).toBe(malformed);
  });

  it("rejects an invalid legacy due date without overwriting old tasks", async () => {
    const timestamp = new Date("2026-08-18T09:00:00+08:00").toISOString();
    const malformed = JSON.stringify([{
      id: "legacy-invalid-date",
      title: "日期损坏的旧待办",
      notes: "仍然要保留原数据",
      status: "inbox",
      priority: "normal",
      dueDate: "not-a-date",
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }]);
    localStorage.setItem("notes.tasks", malformed);

    await expect(createWorkspaceRepository().load()).rejects.toThrow("无法读取旧版待办");
    expect(localStorage.getItem("notes.tasks")).toBe(malformed);
    expect(localStorage.getItem("citroam.workspace")).toBeNull();
  });
});

describe("Tauri workspace repository", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    tauriStore.values.clear();
    tauriStore.save.mockClear();
    tauriStore.load.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("loads the legacy Store and persists the migrated citroam workspace", async () => {
    const timestamp = new Date("2026-08-18T09:00:00+08:00").toISOString();
    const task: LegacyTask = {
      id: "tauri-legacy-task",
      title: "从桌面旧版本迁移",
      notes: "保留本地内容",
      status: "inbox",
      priority: "normal",
      dueDate: "2026-08-26",
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    tauriStore.values.set("notes.tasks", [task]);
    const repository = createWorkspaceRepository();

    const workspace = await repository.load();
    await repository.save(workspace);

    expect(tauriStore.load).toHaveBeenCalledWith("notes.store.json", {
      autoSave: false,
      defaults: {},
    });
    expect(workspace.cards[0]).toMatchObject({
      id: "tauri-legacy-task",
      title: "从桌面旧版本迁移",
      timeConstraint: { date: "2026-08-26", period: "anytime" },
    });
    expect(tauriStore.values.get("citroam.workspace")).toEqual(workspace);
    expect(tauriStore.save).toHaveBeenCalledOnce();
  });
});
