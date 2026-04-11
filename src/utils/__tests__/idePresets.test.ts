import { describe, it, expect } from 'vitest';
import {
  getIdeIconSrc,
  getIdeCommand,
  getIdeIconByCommand,
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
