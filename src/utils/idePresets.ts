import vscodeIcon from "../assets/ides/vscode.svg";
import cursorIcon from "../assets/ides/cursor.png";
import zedIcon from "../assets/ides/zed.png";
import ideaIcon from "../assets/ides/idea.svg";
import golandIcon from "../assets/ides/goland.svg";
import rustroverIcon from "../assets/ides/rustrover.svg";
import pycharmIcon from "../assets/ides/pycharm.svg";
import defaultIdeIcon from "../assets/ides/default.svg";

const IDE_ICON_MAP: Record<string, string> = {
  "vscode.svg": vscodeIcon,
  "cursor.png": cursorIcon,
  "zed.png": zedIcon,
  "idea.svg": ideaIcon,
  "goland.svg": golandIcon,
  "rustrover.svg": rustroverIcon,
  "pycharm.svg": pycharmIcon,
  "default.svg": defaultIdeIcon,
};

/** Resolve IDE icon filename to importable URL. Returns default icon if not found. */
export function getIdeIconSrc(icon: string | null | undefined): string {
  if (!icon) return defaultIdeIcon;
  return IDE_ICON_MAP[icon] ?? defaultIdeIcon;
}

export interface IdePreset {
  id: string;
  name: string;
  command: {
    windows: string;
    macos: string;
    linux: string;
  };
  /**
   * macOS LaunchServices fallback 用的 app 显示名（CFBundleName）。
   * 当 PATH shim 不存在导致 `Command::new(<command>)` ENOENT 时，
   * 后端会用 `open -a <macAppName>` 兜底——LaunchServices 按 bundle name 匹配，
   * 不按 CFBundleExecutable，所以 IntelliJ IDEA 这种 command（idea）≠ bundle name
   * 的产品必须显式声明，否则 fallback 也会失败。
   */
  macAppName?: string;
  icon: string;
}

export const IDE_PRESETS: IdePreset[] = [
  {
    id: "vscode",
    name: "VS Code",
    command: { windows: "code", macos: "code", linux: "code" },
    macAppName: "Visual Studio Code",
    icon: "vscode.svg",
  },
  {
    id: "cursor",
    name: "Cursor",
    command: { windows: "cursor", macos: "cursor", linux: "cursor" },
    macAppName: "Cursor",
    icon: "cursor.png",
  },
  {
    id: "zed",
    name: "Zed",
    command: { windows: "zed", macos: "zed", linux: "zed" },
    macAppName: "Zed",
    icon: "zed.png",
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    command: { windows: "idea64.exe", macos: "idea", linux: "idea.sh" },
    macAppName: "IntelliJ IDEA",
    icon: "idea.svg",
  },
  {
    id: "goland",
    name: "GoLand",
    command: { windows: "goland64.exe", macos: "goland", linux: "goland.sh" },
    macAppName: "GoLand",
    icon: "goland.svg",
  },
  {
    id: "rustrover",
    name: "RustRover",
    command: { windows: "rustrover64.exe", macos: "rustrover", linux: "rustrover.sh" },
    macAppName: "RustRover",
    icon: "rustrover.svg",
  },
  {
    id: "pycharm",
    name: "PyCharm",
    command: { windows: "pycharm64.exe", macos: "pycharm", linux: "pycharm.sh" },
    macAppName: "PyCharm",
    icon: "pycharm.svg",
  },
];

// 根据当前平台返回预设命令
export function getIdeCommand(preset: IdePreset): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return preset.command.windows;
  if (platform.includes("mac")) return preset.command.macos;
  return preset.command.linux;
}

/** 根据 IDE 命令字符串匹配预设图标，找不到返回 default */
export function getIdeIconByCommand(
  command: string | null | undefined,
  overrides?: Record<string, string>,
): string {
  if (!command) return defaultIdeIcon;
  // 1. 先匹配预设的默认命令
  for (const preset of IDE_PRESETS) {
    if (preset.command.windows === command || preset.command.macos === command || preset.command.linux === command) {
      return IDE_ICON_MAP[preset.icon] ?? defaultIdeIcon;
    }
  }
  // 2. 再匹配用户自定义覆盖的命令 → 反向查找 presetId
  if (overrides) {
    for (const [presetId, cmd] of Object.entries(overrides)) {
      if (cmd === command) {
        const preset = IDE_PRESETS.find(p => p.id === presetId);
        if (preset) return IDE_ICON_MAP[preset.icon] ?? defaultIdeIcon;
      }
    }
  }
  return defaultIdeIcon;
}

/**
 * 根据 IDE 命令反查 macOS app 显示名（CFBundleName），
 * 用于后端 LaunchServices fallback。命中不到返回 null。
 */
export function getMacAppNameByCommand(
  command: string | null | undefined,
  overrides?: Record<string, string>,
): string | null {
  if (!command) return null;
  for (const preset of IDE_PRESETS) {
    if (
      preset.command.windows === command ||
      preset.command.macos === command ||
      preset.command.linux === command
    ) {
      return preset.macAppName ?? null;
    }
  }
  if (overrides) {
    for (const [presetId, cmd] of Object.entries(overrides)) {
      if (cmd === command) {
        const preset = IDE_PRESETS.find((p) => p.id === presetId);
        if (preset) return preset.macAppName ?? null;
      }
    }
  }
  return null;
}
