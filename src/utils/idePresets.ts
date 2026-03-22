export interface IdePreset {
  id: string;
  name: string;
  // 各平台的默认命令（空字符串表示该平台不支持）
  command: {
    windows: string;
    macos: string;
    linux: string;
  };
  icon: string;
}

export const IDE_PRESETS: IdePreset[] = [
  {
    id: "vscode",
    name: "VS Code",
    command: {
      windows: "code",
      macos: "code",
      linux: "code",
    },
    icon: "󰨞",
  },
  {
    id: "cursor",
    name: "Cursor",
    command: {
      windows: "cursor",
      macos: "cursor",
      linux: "cursor",
    },
    icon: "⬡",
  },
  {
    id: "zed",
    name: "Zed",
    command: {
      windows: "zed",
      macos: "zed",
      linux: "zed",
    },
    icon: "Z",
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    command: {
      windows: "idea64.exe",
      macos: "idea",
      linux: "idea.sh",
    },
    icon: "I",
  },
  {
    id: "goland",
    name: "GoLand",
    command: {
      windows: "goland64.exe",
      macos: "goland",
      linux: "goland.sh",
    },
    icon: "G",
  },
  {
    id: "rustrover",
    name: "RustRover",
    command: {
      windows: "rustrover64.exe",
      macos: "rustrover",
      linux: "rustrover.sh",
    },
    icon: "R",
  },
  {
    id: "pycharm",
    name: "PyCharm",
    command: {
      windows: "pycharm64.exe",
      macos: "pycharm",
      linux: "pycharm.sh",
    },
    icon: "P",
  },
];

// 根据当前平台返回预设命令
export function getIdeCommand(preset: IdePreset): string {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return preset.command.windows;
  if (platform.includes("mac")) return preset.command.macos;
  return preset.command.linux;
}
