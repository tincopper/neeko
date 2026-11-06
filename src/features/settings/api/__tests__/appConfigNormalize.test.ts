import { describe, it, expect } from 'vitest';

import {
  DEFAULT_CONFIG,
  isBuiltinTheme,
  mergeLspConfig,
  normalizeLoadedConfig,
} from '@/features/settings/api/appConfigNormalize';
import { applyConfigSave, persistConfigSave } from '@/features/settings/api/appConfigSave';
import { __resetConfigWriteGateForTests } from '@/shared/utils/configWriteGate';

describe('appConfigNormalize', () => {
  describe('normalizeLoadedConfig — 未建模键保留（回归 2026-10-16）', () => {
    /**
     * 这是本次修复的**核心判据**。`config.json` 是多域共享文件，而 `save_config` 是
     * 整份覆盖 —— 解析层丢掉未建模键，一次「设置页改字号」就会删掉其它域的键。
     *
     * 反证：把 `normalizeLoadedConfig` 的 `...(saved as Partial<AppConfig>)` 去掉，本组必红。
     */
    it('原样携带本模块不认识的键（notification / agentHookSources / projectOnboarding）', () => {
      const onDisk = {
        appearanceFontSize: 15,
        notification: { enabled: true, cliHooks: true },
        agentHookSources: { claude: false, codex: true },
        projectOnboarding: { proj1: { step: 'done' } },
        someFutureKey: { nested: [1, 2, 3] },
      };
      const { config } = normalizeLoadedConfig(onDisk);
      const asRecord = config as unknown as Record<string, unknown>;

      expect(asRecord.notification).toEqual(onDisk.notification);
      expect(asRecord.agentHookSources).toEqual(onDisk.agentHookSources);
      expect(asRecord.projectOnboarding).toEqual(onDisk.projectOnboarding);
      // 对**将来任何新键**自动免疫：不需要维护「已建模键」清单。
      expect(asRecord.someFutureKey).toEqual(onDisk.someFutureKey);
      // 已建模字段照常生效。
      expect(config.appearanceFontSize).toBe(15);
    });

    it('已建模字段仍覆盖磁盘原值（透传不得让非法值漏进 state）', () => {
      const { config } = normalizeLoadedConfig({
        appearanceFontSize: 'not-a-number',
        diffMode: 'bogus',
        hiddenAgentIds: ['keep', 42, null],
      });
      expect(config.appearanceFontSize).toBe(DEFAULT_CONFIG.appearanceFontSize);
      expect(config.diffMode).toBe('unified');
      expect(config.hiddenAgentIds).toEqual(['keep']);
    });
  });

  describe('normalizeLoadedConfig — 迁移与容错', () => {
    it('旧 fontSize 迁移为 terminalFontSize（仅在新键缺失时）', () => {
      expect(normalizeLoadedConfig({ fontSize: 18 }).config.terminalFontSize).toBe(18);
      // 新键存在时不被旧键覆盖。
      expect(
        normalizeLoadedConfig({ fontSize: 18, terminalFontSize: 12 }).config.terminalFontSize,
      ).toBe(12);
    });

    it('旧 fontFamily 迁移为 monoFontFamily（读旧写新，幂等）', () => {
      expect(normalizeLoadedConfig({ fontFamily: 'JetBrains Mono' }).config.monoFontFamily).toBe(
        'JetBrains Mono',
      );
      // 幂等：再规范化一次结果不变。
      const once = normalizeLoadedConfig({ fontFamily: 'F' }).config;
      expect(normalizeLoadedConfig(once).config.monoFontFamily).toBe('F');
    });

    it('非对象 / null 输入回落默认', () => {
      for (const bad of [null, undefined, 42, 'x', []]) {
        const { config } = normalizeLoadedConfig(bad);
        expect(config.theme).toBe('dark');
        expect(config.appearanceFontSize).toBe(DEFAULT_CONFIG.appearanceFontSize);
      }
    });

    it('非内置主题置 needsCustomThemeVars，并回传主题名', () => {
      const got = normalizeLoadedConfig({ theme: 'my-custom-theme' });
      expect(got.theme).toBe('my-custom-theme');
      expect(got.needsCustomThemeVars).toBe(true);

      const builtin = normalizeLoadedConfig({ theme: 'dark' });
      expect(builtin.needsCustomThemeVars).toBe(false);
    });
  });

  describe('mergeLspConfig', () => {
    it('缺字段 / 非法值回落默认（老 config.json 向后兼容）', () => {
      const cfg = mergeLspConfig(undefined);
      expect(cfg.autoStart).toBe('onFirstFile');
      expect(cfg.importStrategy).toBe('auto');
      expect(cfg.customServers).toEqual([]);
    });

    it('过滤掉结构不完整的自定义 server（不得让畸形项进 registry）', () => {
      const cfg = mergeLspConfig({
        customServers: [
          { languageId: 'go', command: ['gopls'], file_extensions: ['.go'] },
          { languageId: 'bad' }, // 缺 command / file_extensions
          null,
          'nope',
        ],
      });
      expect(cfg.customServers).toHaveLength(1);
      expect(cfg.customServers[0].languageId).toBe('go');
    });

    it('deactivateStopMinutes 只接受正数', () => {
      expect(mergeLspConfig({ deactivateStopMinutes: 0 }).deactivateStopMinutes).toBe(
        DEFAULT_CONFIG.lsp.deactivateStopMinutes,
      );
      expect(mergeLspConfig({ deactivateStopMinutes: -5 }).deactivateStopMinutes).toBe(
        DEFAULT_CONFIG.lsp.deactivateStopMinutes,
      );
      expect(mergeLspConfig({ deactivateStopMinutes: 7.9 }).deactivateStopMinutes).toBe(7);
    });
  });

  describe('isBuiltinTheme', () => {
    it('内置主题 vs 自定义主题', () => {
      expect(isBuiltinTheme('dark')).toBe(true);
      expect(isBuiltinTheme('my-theme')).toBe(false);
    });
  });

  describe('applyConfigSave', () => {
    it('updater 形态基于**传入基线**求值（不是闭包里的旧值）', () => {
      // 基线里有磁盘上的其它域键；updater 必须看到这份基线。
      const base = { ...DEFAULT_CONFIG, hiddenAgentIds: ['a'], notification: { x: 1 } };
      const got = applyConfigSave(base, (current) => ({
        hiddenAgentIds: [...(current.hiddenAgentIds ?? []), 'b'],
      }));
      expect(got.hiddenAgentIds).toEqual(['a', 'b']);
    });

    it('保留基线里未建模的键（整份写回不会抹掉别的域）', () => {
      const base = { ...DEFAULT_CONFIG, agentHookSources: { claude: false } } as never;
      const got = applyConfigSave(base, { editorFontSize: 20 });
      expect((got as unknown as Record<string, unknown>).agentHookSources).toEqual({
        claude: false,
      });
      expect(got.editorFontSize).toBe(20);
    });

    it('monoFontFamily 变化时同步 fontFamily（幂等迁移）', () => {
      const got = applyConfigSave(DEFAULT_CONFIG, {
        monoFontFamily: 'JetBrains Mono',
        fontFamily: 'old',
      });
      expect(got.fontFamily).toBe('JetBrains Mono');
    });

    it('lsp 块被规范化（缺字段回落默认）', () => {
      const got = applyConfigSave(DEFAULT_CONFIG, {
        lsp: { autoStart: 'manual' } as never,
      });
      expect(got.lsp.autoStart).toBe('manual');
      expect(got.lsp.customServers).toEqual([]);
    });
  });

  describe('persistConfigSave', () => {
    it('基线取**磁盘现值**：磁盘上别的域新写的键不会被内存快照覆盖', async () => {
      __resetConfigWriteGateForTests();
      // 磁盘上已有 notification（其它写入者刚写的），内存 DEFAULT_CONFIG 里没有。
      let disk: Record<string, unknown> = {
        ...DEFAULT_CONFIG,
        notification: { enabled: true },
      } as unknown as Record<string, unknown>;
      const load = async () => disk;
      const save = async (next: Record<string, unknown>) => {
        disk = next;
      };

      await persistConfigSave({ editorFontSize: 20 }, load, save);

      expect(disk.editorFontSize).toBe(20);
      // 关键：如果基线用了内存快照，这个键会被抹掉。
      expect(disk.notification).toEqual({ enabled: true });
    });
  });
});
