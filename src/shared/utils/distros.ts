import ubuntu from "../../assets/distros/ubuntu.svg";
import debian from "../../assets/distros/debian.svg";
import fedora from "../../assets/distros/fedora.svg";
import opensuse from "../../assets/distros/opensuse.svg";
import archlinux from "../../assets/distros/archlinux.svg";
import kalilinux from "../../assets/distros/kalilinux.svg";
import alpine from "../../assets/distros/alpine.svg";
import centos from "../../assets/distros/centos.svg";
import oracle from "../../assets/distros/oracle.svg";
import linuxIcon from "../../assets/linux.svg";

const DISTRO_ICONS: Record<string, string> = {
  ubuntu,
  debian,
  fedora,
  opensuse,
  archlinux,
  kalilinux,
  alpine,
  centos,
  oracle,
};

// 映射表：从 WSL 发行版名称（小写）到 icon key
const NAME_MAP: Record<string, string> = {
  "ubuntu": "ubuntu",
  "debian": "debian",
  "fedora": "fedora",
  "opensuse": "opensuse",
  "opensuse-leap": "opensuse",
  "opensuse-tumbleweed": "opensuse",
  "arch": "archlinux",
  "arch linux": "archlinux",
  "kali-linux": "kalilinux",
  "kali": "kalilinux",
  "alpine": "alpine",
  "centos": "centos",
  "oracle linux": "oracle",
};

/**
 * 根据 WSL 发行版名称返回对应的图标 URL。
 * 例如 "Ubuntu-22.04" → Ubuntu logo, "Debian" → Debian logo, 其他 → 通用 Linux logo。
 */
export function getDistroIcon(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[-_]\d+(\.\d+)*.*$/, "") // "ubuntu-22.04" → "ubuntu", "opensuse-leap-15.6" → "opensuse-leap"
    .trim();

  const key = NAME_MAP[normalized] ?? NAME_MAP[normalized.replace(/\s+/g, " ")];
  return (key && DISTRO_ICONS[key]) ?? linuxIcon;
}
