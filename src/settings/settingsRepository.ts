import { invoke } from "@tauri-apps/api/core";

export type ApiKeySource = "stored" | "environment" | "missing";

export interface AgentSettings {
  provider: string;
  model: string;
  harnessRoot: string;
  apiKeyConfigured: boolean;
  apiKeySource: ApiKeySource;
}

export interface AgentSettingsInput {
  provider: string;
  model: string;
  harnessRoot: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AgentConnectionResult {
  message: string;
}

export interface SettingsRepository {
  loadAgentSettings(): Promise<AgentSettings>;
  saveAgentSettings(input: AgentSettingsInput): Promise<AgentSettings>;
  testAgentConnection(): Promise<AgentConnectionResult>;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: "deepseek-official",
  model: "deepseek-v4-flash",
  harnessRoot: "",
  apiKeyConfigured: false,
  apiKeySource: "missing",
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function createSettingsRepository(): SettingsRepository {
  if (!isTauriRuntime()) {
    return {
      async loadAgentSettings() {
        return DEFAULT_AGENT_SETTINGS;
      },
      async saveAgentSettings() {
        throw new Error("模型设置只能在 citroam 桌面应用中保存。");
      },
      async testAgentConnection() {
        throw new Error("模型连接只能在 citroam 桌面应用中测试。");
      },
    };
  }

  return {
    loadAgentSettings: () => invoke<AgentSettings>("settings_get_agent"),
    saveAgentSettings: (input) => invoke<AgentSettings>("settings_save_agent", { input }),
    testAgentConnection: () => invoke<AgentConnectionResult>("settings_test_agent"),
  };
}

