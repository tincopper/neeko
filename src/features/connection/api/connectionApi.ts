import { invoke } from '@tauri-apps/api/core';
import type { AuthMethod, GitInfo } from '@/shared/types';

export function invokeRemoteGitCommand(
  command: string,
  host: string,
  port: number,
  username: string,
  auth: AuthMethod,
  extra: Record<string, unknown>,
): Promise<unknown> {
  return invoke(command, { host, port, username, auth, ...extra });
}

export function getWslDistros(): Promise<string[]> {
  return invoke<string[]>('get_wsl_distros');
}

export function getWslDirectories(distro: string, path?: string | null): Promise<string[]> {
  return invoke<string[]>('get_wsl_directories', { distro, path });
}

export function getWslHomeDir(distro: string): Promise<string> {
  return invoke<string>('get_wsl_home_dir', { distro });
}

export function testRemoteConnection(
  host: string,
  port: number,
  username: string,
  auth: AuthMethod,
): Promise<void> {
  return invoke<void>('test_remote_connection', { host, port, username, auth });
}

export function listRemoteDirectories(
  host: string,
  port: number,
  username: string,
  auth: AuthMethod,
  path: string,
): Promise<string[]> {
  return invoke<string[]>('list_remote_directories', { host, port, username, auth, path });
}

export function getRemoteGitInfo(transport: Record<string, unknown>): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { transport });
}
