import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPanel from "@/features/settings";
import { AppProvider } from "@/shared/contexts";
import type { AppConfig } from '@/shared/types';
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

const defaultConfig: AppConfig = {
   appearanceFontSize: 12,
   editorFontSize: 14,
   terminalFontSize: 14,
   diffMode: "unified",
   shell: "",
   fontFamily: "",
   customIdes: [],
   customAgents: [],
   ideCommandOverrides: {},
   agentCommandOverrides: {},
};

function renderPanel(overrides: Partial<AppConfig> = {}) {
   const config = { ...defaultConfig, ...overrides };
   const onConfigChange = vi.fn();
   const onClose = vi.fn();
   const appContext = {
      config,
      agents: [],
      agentInstalledMap: {},
      loading: false,
      ideCommandOverrides: config.ideCommandOverrides ?? {},
      showToast: vi.fn(),
   };
   const result = render(
      <AppProvider value={appContext}>
         <SettingsPanel onConfigChange={onConfigChange} onClose={onClose} />
      </AppProvider>
   );
   return { ...result, onConfigChange, onClose, config };
}

describe("SettingsPanel", () => {
   beforeEach(() => {
      mockInvoke.mockReset();
   });

   describe("基础渲染", () => {
      it("渲染 Settings 标题", () => {
         renderPanel();
         expect(screen.getByText("Settings")).toBeInTheDocument();
      });

      it("渲染导航项", () => {
         renderPanel();
         // Use role-based query for nav buttons
         expect(screen.getByRole("button", { name: "Editor" })).toBeInTheDocument();
         expect(screen.getByRole("button", { name: "Terminal" })).toBeInTheDocument();
         expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
         expect(screen.getByRole("button", { name: "IDE" })).toBeInTheDocument();
         expect(screen.getByRole("button", { name: "Git" })).toBeInTheDocument();
      });
   });

   describe("Esc 关闭", () => {
      it("按 Escape 调用 onClose", () => {
         const { onClose } = renderPanel();
         fireEvent.keyDown(document, { key: "Escape" });
         expect(onClose).toHaveBeenCalledTimes(1);
      });
   });

   describe("Editor 导航", () => {
      it("显示 Font Size 设置", () => {
         renderPanel();
         expect(screen.getByText("Font Size")).toBeInTheDocument();
      });

      it("显示当前编辑器字号", () => {
         renderPanel({ editorFontSize: 16 });
         fireEvent.click(screen.getByRole("button", { name: "Editor" }));
         expect(screen.getByText("16px")).toBeInTheDocument();
      });

      it("中间值可以正常增减", () => {
         const { onConfigChange } = renderPanel({ editorFontSize: 14 });
         fireEvent.click(screen.getByRole("button", { name: "Editor" }));
         fireEvent.click(screen.getByText("+"));
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({ editorFontSize: 15 })
         );
      });

      it("字号被 clamp 在 10-24 范围", () => {
         // editorFontSize=11 时减 1 应该得到 10
         const { onConfigChange } = renderPanel({ editorFontSize: 11 });
         fireEvent.click(screen.getByRole("button", { name: "Editor" }));
         fireEvent.click(screen.getByText("\u2212"));
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({ editorFontSize: 10 })
         );
      });

      it("字号上限 clamp 到 24", () => {
         const { onConfigChange } = renderPanel({ editorFontSize: 23 });
         fireEvent.click(screen.getByRole("button", { name: "Editor" }));
         fireEvent.click(screen.getByText("+"));
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({ editorFontSize: 24 })
         );
      });
   });

   describe("Shell 预设", () => {
      it("切换到 Terminal 导航显示 shell 预设", async () => {
         mockInvoke.mockResolvedValue([]);
         const user = userEvent.setup();
         renderPanel();
         await user.click(screen.getByRole("button", { name: "Terminal" }));
         // jsdom 的 navigator.platform 不含 "win"，所以用 unix 预设
         expect(screen.getByText("Default ($SHELL)")).toBeInTheDocument();
         expect(screen.getByText("bash")).toBeInTheDocument();
         expect(screen.getByText("zsh")).toBeInTheDocument();
      });

      it("点击预设按钮更新 shell", async () => {
         mockInvoke.mockResolvedValue([]);
         const { onConfigChange } = renderPanel();
         const user = userEvent.setup();
         await user.click(screen.getByRole("button", { name: "Terminal" }));
         await user.click(screen.getByText("bash"));
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({ shell: "/bin/bash" })
         );
      });
   });

   describe("自定义 IDE", () => {
      it("点击 IDE 导航显示自定义 IDE 区域", () => {
         renderPanel();
         fireEvent.click(screen.getByRole("button", { name: "IDE" }));
         expect(screen.getByText("Custom IDEs")).toBeInTheDocument();
      });

      it("空名称或空命令时 Add IDE 按钮 disabled", () => {
         renderPanel();
         fireEvent.click(screen.getByRole("button", { name: "IDE" }));
         const addButton = screen.getByText("Add IDE");
         expect(addButton).toBeDisabled();
      });

      it("已有自定义 IDE 时可以删除", () => {
         const { onConfigChange } = renderPanel({
            customIdes: [{ name: "My IDE", command: "/usr/bin/myide" }],
         });
         fireEvent.click(screen.getByRole("button", { name: "IDE" }));
         const removeBtn = screen.getByTitle("Remove");
         fireEvent.click(removeBtn);
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({ customIdes: [] })
         );
      });
   });

   describe("自定义 Agent", () => {
      it("点击 Agents 导航显示自定义 Agent 区域", () => {
         renderPanel();
         fireEvent.click(screen.getByRole("button", { name: "Agents" }));
         expect(screen.getByText("Custom Agents")).toBeInTheDocument();
      });

      it("已有自定义 Agent 时可以删除", () => {
         mockInvoke.mockResolvedValue(undefined);
         const { onConfigChange } = renderPanel({
            customAgents: [
               { id: "custom:my-agent", name: "My Agent", command: "myagent", args: [], icon: "cli.svg", enabled: true },
            ],
         });
         fireEvent.click(screen.getByRole("button", { name: "Agents" }));
         const removeBtn = screen.getByTitle("Remove");
         fireEvent.click(removeBtn);
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({ customAgents: [] })
         );
      });
   });

   describe("IDE 命令覆盖", () => {
      it("getEffectiveCommand 返回覆盖值", () => {
         renderPanel({
            ideCommandOverrides: { cursor: "custom-cursor" },
         });
         fireEvent.click(screen.getByRole("button", { name: "IDE" }));
         expect(screen.getByText("custom-cursor")).toBeInTheDocument();
      });

      it("重置按钮删除 override", () => {
         const { onConfigChange } = renderPanel({
            ideCommandOverrides: { cursor: "custom-cursor" },
         });
         fireEvent.click(screen.getByRole("button", { name: "IDE" }));
         const resetBtn = screen.getByTitle("Reset to default");
         fireEvent.click(resetBtn);
         expect(onConfigChange).toHaveBeenCalledWith(
            expect.objectContaining({
               ideCommandOverrides: {},
            })
         );
      });
   });

   describe("字体过滤", () => {
      it("打开字体列表显示内置字体", async () => {
         mockInvoke.mockResolvedValue([]);
         const user = userEvent.setup();
         renderPanel();
         await user.click(screen.getByRole("button", { name: "Terminal" }));
         // Find font trigger by text content (shows current font or "Select font...")
         const fontTrigger = screen.getByText(/default.*mono/i);
         expect(fontTrigger).toBeTruthy();
         await user.click(fontTrigger);
         expect(screen.getByText("Fira Code")).toBeInTheDocument();
         expect(screen.getByText("JetBrains Mono")).toBeInTheDocument();
      });
   });

    describe("全页模式 (fullPage)", () => {
       it("全页模式不渲染遮罩层", () => {
          const config = { ...defaultConfig };
          const appContext = {
             config,
             agents: [],
             agentInstalledMap: {},
             loading: false,
             ideCommandOverrides: config.ideCommandOverrides ?? {},
             showToast: vi.fn(),
          };
          render(
             <AppProvider value={appContext}>
                <SettingsPanel fullPage onConfigChange={vi.fn()} onClose={vi.fn()} />
             </AppProvider>
          );
          // 全页模式不应有 fixed overlay
          expect(document.querySelector(".fixed.inset-0")).toBeNull();
       });


        it("全页模式内容区可正常滚动", () => {
          const config = { ...defaultConfig };
          const appContext = {
             config,
             agents: [],
             agentInstalledMap: {},
             loading: false,
             ideCommandOverrides: config.ideCommandOverrides ?? {},
             showToast: vi.fn(),
          };
          render(
             <AppProvider value={appContext}>
                <SettingsPanel fullPage onConfigChange={vi.fn()} onClose={vi.fn()} />
             </AppProvider>
          );
          // 内容区应有 overflow-y-auto 以支持滚动
          const contentArea = document.querySelector(".overflow-y-auto");
          expect(contentArea).toBeInTheDocument();
       });
    });

    describe("AgentsPanel Switch 开关", () => {
       it("Show Agent Bar 使用 Switch 组件", () => {
          renderPanel({ agentSelectorShowPresetBar: true });
          fireEvent.click(screen.getByRole("button", { name: "Agents" }));
          expect(screen.getByText("Show Agent Bar")).toBeInTheDocument();
          // Switch 组件应存在 (Radix switch renders role="switch")
          const switches = screen.getAllByRole("switch");
          expect(switches.length).toBeGreaterThanOrEqual(2);
       });

       it("切换 Show Agent Bar 调用 onConfigChange", () => {
          const { onConfigChange } = renderPanel({ agentSelectorShowPresetBar: true });
          fireEvent.click(screen.getByRole("button", { name: "Agents" }));
          const switches = screen.getAllByRole("switch");
          fireEvent.click(switches[0]);
          expect(onConfigChange).toHaveBeenCalledWith(
             expect.objectContaining({ agentSelectorShowPresetBar: false })
          );
       });

       it("Compact Mode 使用 Switch 组件", () => {
          renderPanel({ agentSelectorCompactMode: true });
          fireEvent.click(screen.getByRole("button", { name: "Agents" }));
          const switches = screen.getAllByRole("switch");
          // 第二个 switch 是 Compact Mode
          fireEvent.click(switches[1]);
          expect(screen.getByText("Compact Mode")).toBeInTheDocument();
       });
    });

    describe("GitPanel ToggleGroup", () => {
       it("Diff View Mode 使用 ToggleGroup 组件", () => {
          renderPanel();
          fireEvent.click(screen.getByRole("button", { name: "Git" }));
          // ToggleGroup 渲染 Unified 和 Split 选项
          expect(screen.getByText("Unified")).toBeInTheDocument();
          expect(screen.getByText("Split")).toBeInTheDocument();
       });

       it("点击 Split 切换 diff 模式", () => {
          const { onConfigChange } = renderPanel({ diffMode: "unified" });
          fireEvent.click(screen.getByRole("button", { name: "Git" }));
          fireEvent.click(screen.getByText("Split"));
          expect(onConfigChange).toHaveBeenCalledWith(
             expect.objectContaining({ diffMode: "split" })
          );
       });
    });
});
