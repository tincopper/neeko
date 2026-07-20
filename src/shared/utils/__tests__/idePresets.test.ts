import { describe, it, expect } from 'vitest';
import {
  getIdeIconSrc,
  getIdeCommand,
  getIdeIconByCommand,
  getIdeDisplayName,
  getMacAppNameByCommand,
  resolveIdeLaunchCommand,
  resolveIdePreset,
  IDE_PRESETS,
} from '../../utils/idePresets';

describe('getIdeIconSrc', () => {
  it('null 返回默认图标', () => {
    const result = getIdeIconSrc(null);
    expect(result).toBeTruthy();
    expect(result).toContain('.svg');
  });

  it('undefined 返回默认图标', () => {
    expect(getIdeIconSrc(undefined)).toBeTruthy();
  });

  it('空字符串返回默认图标', () => {
    expect(getIdeIconSrc('')).toBeTruthy();
  });

  it('未知 icon 文件名返回默认图标', () => {
    expect(getIdeIconSrc('nonexistent.svg')).toBeTruthy();
  });
});

describe('getIdeCommand', () => {
  it('返回对应平台的命令字符串', () => {
    for (const preset of IDE_PRESETS) {
      const cmd = getIdeCommand(preset);
      expect(typeof cmd).toBe('string');
      expect(cmd.length).toBeGreaterThan(0);
      // 命令应来自预设的三个平台之一
      expect(
        [preset.command.windows, preset.command.macos, preset.command.linux],
      ).toContain(cmd);
    }
  });
});

describe('getIdeIconByCommand', () => {
  it('null 命令返回默认图标', () => {
    expect(getIdeIconByCommand(null)).toBeTruthy();
  });

  it('undefined 命令返回默认图标', () => {
    expect(getIdeIconByCommand(undefined)).toBeTruthy();
  });

  it('空字符串返回默认图标', () => {
    expect(getIdeIconByCommand('')).toBeTruthy();
  });

  it('匹配预设命令时返回对应的图标（非默认）', () => {
    // VS Code 的三个平台命令都返回相同图标
    const iconByWindows = getIdeIconByCommand('code');
    expect(iconByWindows).toBeTruthy();

    // 通过 overrides 反向查找
    const iconWithOverride = getIdeIconByCommand('code', { vscode: 'code' });
    expect(iconWithOverride).toBe(iconByWindows);
  });

  it('should_resolve_vscode_preset_id_to_same_icon_as_code_command', () => {
    const byId = getIdeIconByCommand('vscode');
    const byCmd = getIdeIconByCommand('code');
    expect(byId).toBe(byCmd);
    // Must not fall back to black default.svg used when unresolved
    expect(byId).not.toBe(getIdeIconByCommand('totally-unknown-ide'));
  });

  it('should_resolve_path_style_code_command', () => {
    expect(getIdeIconByCommand('/usr/local/bin/code')).toBe(getIdeIconByCommand('code'));
  });

  it('未匹配的命令返回默认图标', () => {
    const result = getIdeIconByCommand('totally-unknown-ide');
    expect(result).toBeTruthy();
  });

  it('overrides 反向查找工作', () => {
    // 使用 Cursor 的 macos 命令 + overrides
    const icon = getIdeIconByCommand('cursor', { cursor: 'cursor' });
    expect(icon).toBeTruthy();
  });
});

describe('resolveIdePreset / launch / display', () => {
  it('should_map_vscode_id_to_launch_code', () => {
    expect(resolveIdePreset('vscode')?.id).toBe('vscode');
    expect(resolveIdeLaunchCommand('vscode')).toBe('code');
    expect(getIdeDisplayName('vscode')).toBe('VS Code');
    expect(getIdeDisplayName('code')).toBe('VS Code');
  });

  it('should_keep_custom_command_when_unknown', () => {
    expect(resolveIdeLaunchCommand('my-custom-ide')).toBe('my-custom-ide');
    expect(getIdeDisplayName('my-custom-ide')).toBe('my-custom-ide');
  });
});

describe('IDE_PRESETS', () => {
  it('包含至少 7 个预设', () => {
    expect(IDE_PRESETS.length).toBeGreaterThanOrEqual(7);
  });

  it('每个预设有必需字段', () => {
    for (const preset of IDE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.command.windows).toBeTruthy();
      expect(preset.command.macos).toBeTruthy();
      expect(preset.command.linux).toBeTruthy();
      expect(preset.icon).toBeTruthy();
    }
  });
});

describe('getMacAppNameByCommand', () => {
  it('null/undefined/空字符串返回 null', () => {
    expect(getMacAppNameByCommand(null)).toBeNull();
    expect(getMacAppNameByCommand(undefined)).toBeNull();
    expect(getMacAppNameByCommand('')).toBeNull();
  });

  it('IntelliJ IDEA 的 macos 命令 idea 反查到正确的 bundle name', () => {
    expect(getMacAppNameByCommand('idea')).toBe('IntelliJ IDEA');
  });

  it('VS Code 的命令 code 反查到 Visual Studio Code', () => {
    expect(getMacAppNameByCommand('code')).toBe('Visual Studio Code');
  });

  it('GoLand / PyCharm / RustRover / Zed / Cursor 都能反查', () => {
    expect(getMacAppNameByCommand('goland')).toBe('GoLand');
    expect(getMacAppNameByCommand('pycharm')).toBe('PyCharm');
    expect(getMacAppNameByCommand('rustrover')).toBe('RustRover');
    expect(getMacAppNameByCommand('zed')).toBe('Zed');
    expect(getMacAppNameByCommand('cursor')).toBe('Cursor');
  });

  it('Windows / Linux 命令也能反查到 macAppName（同 preset）', () => {
    expect(getMacAppNameByCommand('idea64.exe')).toBe('IntelliJ IDEA');
    expect(getMacAppNameByCommand('idea.sh')).toBe('IntelliJ IDEA');
  });

  it('未知命令返回 null；路径 basename 能命中预设', () => {
    expect(getMacAppNameByCommand('my-custom-ide')).toBeNull();
    // path-style commands resolve via basename → idea → IntelliJ IDEA
    expect(getMacAppNameByCommand('/usr/local/bin/idea')).toBe('IntelliJ IDEA');
  });

  it('overrides 命中时返回对应预设的 macAppName', () => {
    expect(getMacAppNameByCommand('my-idea-shim', { idea: 'my-idea-shim' })).toBe('IntelliJ IDEA');
  });
});
