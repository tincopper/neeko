import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AppInfo } from '@/shared/types/app';
import { invoke } from '@/testing/tauriCore';

import AboutPanel from '../AboutPanel';

const mockInvoke = vi.mocked(invoke);

const mockAppInfo: AppInfo = {
  name: 'Neeko',
  version: '1.0.6',
  identifier: 'com.neeko.desktop',
  description: 'Multi-project AI agent session manager',
  authors: 'Tomgs',
  license: 'Apache-2.0',
  tauriVersion: '2.10.3',
  os: 'macos',
  arch: 'aarch64',
  copyright: 'Copyright © 2024 Tomgs. All rights reserved.',
};

describe('AboutPanel', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('渲染应用名称与版本号', async () => {
    mockInvoke.mockResolvedValue(mockAppInfo);
    render(<AboutPanel />);
    expect(await screen.findByText('Neeko')).toBeInTheDocument();
    expect(screen.getByText('1.0.6')).toBeInTheDocument();
  });

  it('展示全部版本元数据字段', async () => {
    mockInvoke.mockResolvedValue(mockAppInfo);
    render(<AboutPanel />);
    await screen.findByText('Neeko');
    expect(screen.getByText('com.neeko.desktop')).toBeInTheDocument();
    expect(screen.getByText('2.10.3')).toBeInTheDocument();
    expect(screen.getByText('macos')).toBeInTheDocument();
    expect(screen.getByText('aarch64')).toBeInTheDocument();
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument();
    expect(screen.getByText('Copyright © 2024 Tomgs. All rights reserved.')).toBeInTheDocument();
    expect(screen.getByText('Multi-project AI agent session manager')).toBeInTheDocument();
  });

  it('元数据缺失的字段不渲染', async () => {
    mockInvoke.mockResolvedValue({
      ...mockAppInfo,
      description: null,
      authors: null,
      copyright: null,
    });
    render(<AboutPanel />);
    await screen.findByText('Neeko');
    expect(screen.getByText('1.0.6')).toBeInTheDocument();
    expect(screen.queryByText('Multi-project AI agent session manager')).not.toBeInTheDocument();
  });

  it('加载失败显示错误信息与重试按钮', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    render(<AboutPanel />);
    expect(await screen.findByText(/failed to load app information/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('点击重试后重新拉取并渲染', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(mockAppInfo);
    const user = (await import('@testing-library/user-event')).default;
    render(<AboutPanel />);
    const retry = await screen.findByRole('button', { name: /retry/i });
    await user.click(retry);
    expect(await screen.findByText('Neeko')).toBeInTheDocument();
  });
});
