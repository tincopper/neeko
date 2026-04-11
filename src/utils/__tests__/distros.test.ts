import { describe, it, expect } from 'vitest';
import { getDistroIcon } from '../../utils/distros';

describe('getDistroIcon', () => {
  it('识别 Ubuntu 发行版', () => {
    const icon = getDistroIcon('Ubuntu');
    expect(icon).toBeTruthy();
    expect(icon).not.toBe(getDistroIcon('unknown-distro'));
  });

  it('处理 Ubuntu 带版本号', () => {
    const icon = getDistroIcon('Ubuntu-22.04');
    expect(icon).toBeTruthy();
    expect(icon).toBe(getDistroIcon('Ubuntu'));
  });

  it('识别 Debian 发行版', () => {
    const icon = getDistroIcon('Debian');
    expect(icon).toBeTruthy();
  });

  it('识别 Fedora 发行版', () => {
    const icon = getDistroIcon('Fedora');
    expect(icon).toBeTruthy();
  });

  it('识别 OpenSUSE Leap', () => {
    const icon = getDistroIcon('openSUSE-Leap-15.6');
    expect(icon).toBeTruthy();
  });

  it('识别 OpenSUSE Tumbleweed', () => {
    const icon = getDistroIcon('openSUSE-Tumbleweed');
    expect(icon).toBeTruthy();
  });

  it('识别 Arch Linux', () => {
    const icon = getDistroIcon('Arch');
    expect(icon).toBeTruthy();
  });

  it('识别 Kali Linux', () => {
    const icon = getDistroIcon('kali-linux');
    expect(icon).toBeTruthy();
  });

  it('大写和小写一致', () => {
    expect(getDistroIcon('Ubuntu')).toBe(getDistroIcon('ubuntu'));
    expect(getDistroIcon('Debian')).toBe(getDistroIcon('debian'));
  });

  it('未知发行版返回通用 Linux 图标', () => {
    const unknown = getDistroIcon('unknown-distro');
    const generic = getDistroIcon('truly-random-name');
    expect(unknown).toBe(generic);
  });
});
