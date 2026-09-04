import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsRepository, DEFAULT_AGENT_SETTINGS } from "./settingsRepository";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

describe("settingsRepository", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    tauri.invoke.mockReset();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("maps all Agent settings operations to the desktop bridge", async () => {
    tauri.invoke
      .mockResolvedValueOnce(DEFAULT_AGENT_SETTINGS)
      .mockResolvedValueOnce({ ...DEFAULT_AGENT_SETTINGS, apiKeyConfigured: true, apiKeySource: "stored" })
      .mockResolvedValueOnce({ message: "连接成功" });
    const settings = createSettingsRepository();
    const input = {
      provider: "deepseek-official",
      model: "deepseek-chat",
      harnessRoot: "/opt/harness",
      apiKey: "sk-secret",
    };

    await settings.loadAgentSettings();
    await settings.saveAgentSettings(input);
    await settings.testAgentConnection();

    expect(tauri.invoke.mock.calls).toEqual([
      ["settings_get_agent"],
      ["settings_save_agent", { input }],
      ["settings_test_agent"],
    ]);
  });

  it("keeps browser preview read-only and never pretends a model connection exists", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const settings = createSettingsRepository();

    await expect(settings.loadAgentSettings()).resolves.toEqual(DEFAULT_AGENT_SETTINGS);
    await expect(settings.saveAgentSettings({
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      harnessRoot: "",
    })).rejects.toThrow(/桌面应用/);
    await expect(settings.testAgentConnection()).rejects.toThrow(/桌面应用/);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});
