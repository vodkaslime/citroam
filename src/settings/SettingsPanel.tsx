import {
  ChatCircleDots,
  CheckCircle,
  DownloadSimple,
  Eye,
  HardDrive,
  Key,
  LockKey,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../ui/useFocusTrap";
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
  type SettingsRepository,
} from "./settingsRepository";

export type SettingsSection = "appearance" | "agent" | "data";
export type AppTheme = "light" | "dark";

interface SettingsPanelProps {
  repository: SettingsRepository;
  initialSection: SettingsSection;
  theme: AppTheme;
  onThemeChange(theme: AppTheme): void;
  onExport(): void;
  onImport(): void;
  onClose(): void;
}

const sectionLabels: Record<SettingsSection, string> = {
  appearance: "外观",
  agent: "Agent",
  data: "数据",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function apiKeyDescription(settings: AgentSettings): string {
  if (settings.apiKeySource === "stored") return "已安全保存在系统凭据中。留空不会覆盖。";
  if (settings.apiKeySource === "environment") return "当前从启动环境读取。填写后将改用系统凭据。";
  return "只保存在系统凭据中，不写入画布或备份。";
}

export function SettingsPanel({
  repository,
  initialSection,
  theme,
  onThemeChange,
  onExport,
  onImport,
  onClose,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [settings, setSettings] = useState(DEFAULT_AGENT_SETTINGS);
  const [model, setModel] = useState(DEFAULT_AGENT_SETTINGS.model);
  const [harnessRoot, setHarnessRoot] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useFocusTrap(true, panelRef);

  useEffect(() => {
    let active = true;
    repository.loadAgentSettings().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      setModel(loaded.model);
      setHarnessRoot(loaded.harnessRoot);
      setLoading(false);
      setLoadFailed(false);
    }).catch((error) => {
      if (!active) return;
      setLoading(false);
      setLoadFailed(true);
      setNotice({ kind: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [repository]);

  async function saveAgentSettings(testAfterSave: boolean) {
    if (loadFailed) return;
    if (!model.trim()) {
      setNotice({ kind: "error", message: "请填写模型名称。" });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const saved = await repository.saveAgentSettings({
        provider: settings.provider,
        model: model.trim(),
        harnessRoot: harnessRoot.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(saved);
      setModel(saved.model);
      setHarnessRoot(saved.harnessRoot);
      setApiKey("");
      if (testAfterSave) {
        const result = await repository.testAgentConnection();
        setNotice({ kind: "success", message: result.message });
      } else {
        setNotice({ kind: "success", message: "模型设置已保存。" });
      }
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function clearStoredApiKey() {
    if (!settings.apiKeyConfigured || saving || loadFailed) return;
    if (!model.trim()) {
      setNotice({ kind: "error", message: "请先填写模型名称。" });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const saved = await repository.saveAgentSettings({
        provider: settings.provider,
        model: model.trim(),
        harnessRoot: harnessRoot.trim(),
        clearApiKey: true,
      });
      setSettings(saved);
      setModel(saved.model);
      setHarnessRoot(saved.harnessRoot);
      setApiKey("");
      setNotice({ kind: "success", message: "已清除保存的 API Key。" });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  function submitAgentSettings(event: FormEvent) {
    event.preventDefault();
    void saveAgentSettings(false);
  }

  return (
    <div
      className="canvas-settings-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="canvas-settings-panel"
        ref={panelRef}
        role="dialog"
        aria-labelledby="canvas-settings-title"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="canvas-settings-header">
          <div><span>citroam</span><h1 id="canvas-settings-title">应用设置</h1></div>
          <button type="button" aria-label="关闭设置" onClick={onClose}><X size={17} /></button>
        </header>

        <nav className="canvas-settings-nav" aria-label="设置分类">
          {(Object.keys(sectionLabels) as SettingsSection[]).map((item) => {
            const Icon = item === "appearance" ? Eye : item === "agent" ? ChatCircleDots : HardDrive;
            return (
              <button
                type="button"
                key={item}
                aria-current={section === item ? "page" : undefined}
                autoFocus={section === item}
                onClick={() => { setSection(item); setNotice(null); }}
              ><Icon size={17} /><span>{sectionLabels[item]}</span></button>
            );
          })}
        </nav>

        <div className="canvas-settings-content">
          {section === "appearance" && (
            <section className="canvas-settings-section" aria-labelledby="settings-appearance-title">
              <header><Eye size={21} /><div><h2 id="settings-appearance-title">外观</h2><p>选择你看着最舒服的画布。</p></div></header>
              <div className="canvas-theme-choice" role="group" aria-label="外观模式">
                <button type="button" aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}><span className="is-light" aria-hidden="true" /><strong>浅色</strong><small>柠檬汽水</small></button>
                <button type="button" aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}><span className="is-dark" aria-hidden="true" /><strong>深色</strong><small>夜间气泡</small></button>
              </div>
            </section>
          )}

          {section === "agent" && (
            <form className="canvas-settings-section canvas-agent-settings" onSubmit={submitAgentSettings}>
              <header><ChatCircleDots size={21} /><div><h2>Agent</h2><p>让 DeepSeek Harness 处理你明确说出的操作。</p></div></header>
              <div className="canvas-settings-status" data-configured={settings.apiKeyConfigured}>
                {settings.apiKeyConfigured ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} />}
                <span>{settings.apiKeyConfigured ? "已经配置密钥" : "还没有配置密钥"}</span>
              </div>
              <div className="canvas-settings-field">
                <div className="canvas-settings-field-heading"><span><Key size={15} />DeepSeek API Key</span>{settings.apiKeySource === "stored" && <button type="button" className="canvas-settings-clear-key" aria-label="清除已保存密钥" disabled={loading || saving || loadFailed} onClick={() => { void clearStoredApiKey(); }}>清除已保存密钥</button>}</div>
                <input
                  type="password"
                  aria-label="DeepSeek API Key"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings.apiKeyConfigured ? "••••••••••••••••" : "sk-..."}
                  disabled={loading || saving || loadFailed}
                />
                <small>{apiKeyDescription(settings)}</small>
              </div>
              <label className="canvas-settings-field">
                <span>模型</span>
                <input aria-label="模型" value={model} onChange={(event) => setModel(event.target.value)} disabled={loading || saving || loadFailed} />
                <small>默认使用 Harness 已注册的 deepseek-v4-flash。</small>
              </label>
              <details className="canvas-settings-advanced">
                <summary>高级设置</summary>
                <label className="canvas-settings-field">
                  <span>Harness 路径</span>
                  <input aria-label="Harness 路径" value={harnessRoot} onChange={(event) => setHarnessRoot(event.target.value)} placeholder="自动查找或使用 App 内置版本" disabled={loading || saving || loadFailed} />
                  <small>开发时可指向本机 deepseek-harness；留空时自动查找。</small>
                </label>
              </details>
              {notice && <p className={`canvas-settings-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "success" ? <CheckCircle size={16} /> : <WarningCircle size={16} />}{notice.message}</p>}
              <footer className="canvas-settings-actions">
                <button type="button" disabled={loading || saving || loadFailed} onClick={() => { void saveAgentSettings(true); }}>保存并测试</button>
                <button type="submit" className="is-primary" disabled={loading || saving || loadFailed}>{saving ? "正在保存" : "保存"}</button>
              </footer>
            </form>
          )}

          {section === "data" && (
            <section className="canvas-settings-section" aria-labelledby="settings-data-title">
              <header><HardDrive size={21} /><div><h2 id="settings-data-title">本地数据</h2><p>画布留在本机，也可以自己带走。</p></div></header>
              <div className="canvas-settings-data-actions">
                <button type="button" aria-label="导出本地备份" onClick={onExport}><DownloadSimple size={19} /><span><strong>导出本地备份</strong><small>保存完整 Workspace JSON</small></span></button>
                <button type="button" aria-label="导入本地备份" onClick={onImport}><UploadSimple size={19} /><span><strong>导入本地备份</strong><small>确认后替换当前画布</small></span></button>
              </div>
              <p className="canvas-settings-privacy"><LockKey size={16} />API Key 不会进入画布备份。</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
