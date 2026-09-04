import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import type { AgentSettings, SettingsRepository } from "./settingsRepository";

const SAVED_SETTINGS: AgentSettings = {
  provider: "deepseek-official",
  model: "deepseek-v4-flash",
  harnessRoot: "/opt/deepseek-harness",
  apiKeyConfigured: true,
  apiKeySource: "stored",
};

function repository(overrides: Partial<SettingsRepository> = {}): SettingsRepository {
  return {
    loadAgentSettings: vi.fn(async () => SAVED_SETTINGS),
    saveAgentSettings: vi.fn(async (input) => ({
      ...SAVED_SETTINGS,
      model: input.model,
      harnessRoot: input.harnessRoot,
      apiKeyConfigured: input.clearApiKey ? false : Boolean(input.apiKey) || SAVED_SETTINGS.apiKeyConfigured,
      apiKeySource: input.clearApiKey ? "missing" : SAVED_SETTINGS.apiKeySource,
    })),
    testAgentConnection: vi.fn(async () => ({ message: "连接成功，Harness 已准备好。" })),
    ...overrides,
  };
}

function renderPanel(settingsRepository: SettingsRepository, initialSection: "appearance" | "agent" | "data" = "agent") {
  const props = {
    repository: settingsRepository,
    initialSection,
    theme: "light" as const,
    onThemeChange: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onClose: vi.fn(),
  };
  render(<SettingsPanel {...props} />);
  return props;
}

describe("SettingsPanel", () => {
  it("loads the saved model and Harness path without ever returning the saved API Key", async () => {
    renderPanel(repository());

    expect(await screen.findByLabelText("模型")).toHaveValue("deepseek-v4-flash");
    expect(screen.getByLabelText("Harness 路径")).toHaveValue("/opt/deepseek-harness");
    expect(screen.getByLabelText("DeepSeek API Key")).toHaveValue("");
    expect(screen.getByText("已经配置密钥")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("sk-saved-secret");
  });

  it("saves a newly entered Key, model, and Harness path, then clears the Key field", async () => {
    const user = userEvent.setup();
    const settingsRepository = repository();
    renderPanel(settingsRepository);
    await screen.findByText("已经配置密钥");

    await user.clear(screen.getByLabelText("模型"));
    await user.type(screen.getByLabelText("模型"), "deepseek-chat");
    await user.clear(screen.getByLabelText("Harness 路径"));
    await user.type(screen.getByLabelText("Harness 路径"), "/Users/me/harness");
    await user.type(screen.getByLabelText("DeepSeek API Key"), "sk-new-secret");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(settingsRepository.saveAgentSettings).toHaveBeenCalledWith({
      provider: "deepseek-official",
      model: "deepseek-chat",
      harnessRoot: "/Users/me/harness",
      apiKey: "sk-new-secret",
    }));
    expect(screen.getByLabelText("DeepSeek API Key")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("模型设置已保存");
  });

  it("leaves the stored Key untouched when the password field stays empty", async () => {
    const user = userEvent.setup();
    const settingsRepository = repository();
    renderPanel(settingsRepository);
    await screen.findByText("已经配置密钥");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(settingsRepository.saveAgentSettings).toHaveBeenCalledWith({
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      harnessRoot: "/opt/deepseek-harness",
    }));
  });

  it("clears a stored Key only through the explicit clear action", async () => {
    const user = userEvent.setup();
    const settingsRepository = repository();
    renderPanel(settingsRepository);
    await screen.findByText("已经配置密钥");

    await user.click(screen.getByRole("button", { name: "清除已保存密钥" }));

    await waitFor(() => expect(settingsRepository.saveAgentSettings).toHaveBeenCalledWith({
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
      harnessRoot: "/opt/deepseek-harness",
      clearApiKey: true,
    }));
    expect(screen.getByText("还没有配置密钥")).toBeInTheDocument();
  });

  it("tests the connection only after saving and reports Harness failures", async () => {
    const user = userEvent.setup();
    const settingsRepository = repository({
      testAgentConnection: vi.fn(async () => { throw new Error("DeepSeek 拒绝了这个 API Key。"); }),
    });
    renderPanel(settingsRepository);
    await screen.findByText("已经配置密钥");

    await user.click(screen.getByRole("button", { name: "保存并测试" }));

    await waitFor(() => expect(settingsRepository.saveAgentSettings).toHaveBeenCalledOnce());
    await waitFor(() => expect(settingsRepository.testAgentConnection).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).toHaveTextContent("DeepSeek 拒绝了这个 API Key");
  });

  it("disables both actions while settings are loading or saving", async () => {
    let resolveLoad!: (settings: AgentSettings) => void;
    const loading = new Promise<AgentSettings>((resolve) => { resolveLoad = resolve; });
    const settingsRepository = repository({ loadAgentSettings: vi.fn(() => loading) });
    renderPanel(settingsRepository);

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存并测试" })).toBeDisabled();
    resolveLoad(SAVED_SETTINGS);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
  });

  it("does not allow overwriting settings when the existing config cannot be loaded", async () => {
    const settingsRepository = repository({
      loadAgentSettings: vi.fn(async () => { throw new Error("无法读取模型设置"); }),
    });
    renderPanel(settingsRepository);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取模型设置");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存并测试" })).toBeDisabled();
    expect(settingsRepository.saveAgentSettings).not.toHaveBeenCalled();
  });

  it("keeps Tab navigation inside the modal", async () => {
    const user = userEvent.setup();
    renderPanel(repository(), "data");
    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    const close = within(dialog).getByRole("button", { name: "关闭设置" });
    const last = within(dialog).getByRole("button", { name: "导入本地备份" });

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });
});
