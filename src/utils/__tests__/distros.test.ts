import { describe, it, expect, vi } from 'vitest';

// Use vi.hoisted() to define mocks before module import
const mocks = vi.hoisted(() => {
  return {
    ubuntu: 'ubuntu-icon',
    debian: 'debian-icon',
    fedora: 'fedora-icon',
    opensuse: 'opensuse-icon',
    archlinux: 'archlinux-icon',
    kalilinux: 'kalilinux-icon',
    alpine: 'alpine-icon',
    centos: 'centos-icon',
    oracle: 'oracle-icon',
    linux: 'linux-icon',
  };
});

vi.mock('../assets/distros/ubuntu.svg', () => ({ default: mocks.ubuntu }));
vi.mock('../assets/distros/debian.svg', () => ({ default: mocks.debian }));
vi.mock('../assets/distros/fedora.svg', () => ({ default: mocks.fedora }));
vi.mock('../assets/distros/opensuse.svg', () => ({ default: mocks.opensuse }));
vi.mock('../assets/distros/archlinux.svg', () => ({ default: mocks.archlinux }));
vi.mock('../assets/distros/kalilinux.svg', () => ({ default: mocks.kalilinux }));
vi.mock('../assets/distros/alpine.svg', () => ({ default: mocks.alpine }));
vi.mock('../assets/distros/centos.svg', () => ({ default: mocks.centos }));
vi.mock('../assets/distros/oracle.svg', () => ({ default: mocks.oracle }));
vi.mock('../assets/linux.svg', () => ({ default: mocks.linux }));

import { getDistroIcon } from '../distros';

describe('getDistroIcon', () => {
  describe('exact matches', () => {
    it('should return ubuntu icon for "Ubuntu"', () => {
      expect(getDistroIcon('Ubuntu')).toBe('ubuntu-icon');
    });

    it('should return debian icon for "Debian"', () => {
      expect(getDistroIcon('Debian')).toBe('debian-icon');
    });

    it('should return fedora icon for "Fedora"', () => {
      expect(getDistroIcon('Fedora')).toBe('fedora-icon');
    });

    it('should return alpine icon for "Alpine"', () => {
      expect(getDistroIcon('Alpine')).toBe('alpine-icon');
    });

    it('should return centos icon for "CentOS"', () => {
      expect(getDistroIcon('CentOS')).toBe('centos-icon');
    });
  });

  describe('version suffix removal', () => {
    it('should strip version from "Ubuntu-22.04"', () => {
      expect(getDistroIcon('Ubuntu-22.04')).toBe('ubuntu-icon');
    });

    it('should strip version from "Ubuntu-20.04.6"', () => {
      expect(getDistroIcon('Ubuntu-20.04.6')).toBe('ubuntu-icon');
    });

    it('should strip version from "Debian-11"', () => {
      expect(getDistroIcon('Debian-11')).toBe('debian-icon');
    });
  });

  describe('alias matching', () => {
    it('should return opensuse icon for "openSUSE-Leap"', () => {
      expect(getDistroIcon('openSUSE-Leap')).toBe('opensuse-icon');
    });

    it('should return opensuse icon for "openSUSE-Tumbleweed"', () => {
      expect(getDistroIcon('openSUSE-Tumbleweed')).toBe('opensuse-icon');
    });

    it('should return archlinux icon for "Arch"', () => {
      expect(getDistroIcon('Arch')).toBe('archlinux-icon');
    });

    it('should return archlinux icon for "Arch Linux"', () => {
      expect(getDistroIcon('Arch Linux')).toBe('archlinux-icon');
    });

    it('should return kalilinux icon for "kali-linux"', () => {
      expect(getDistroIcon('kali-linux')).toBe('kalilinux-icon');
    });

    it('should return oracle icon for "Oracle Linux"', () => {
      expect(getDistroIcon('Oracle Linux')).toBe('oracle-icon');
    });
  });

  describe('fallback', () => {
    it('should return generic linux icon for unknown distro', () => {
      expect(getDistroIcon('CustomDistro')).toBe('linux-icon');
    });

    it('should return generic linux icon for empty string', () => {
      expect(getDistroIcon('')).toBe('linux-icon');
    });
  });
});
