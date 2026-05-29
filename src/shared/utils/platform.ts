export const IS_WINDOWS = navigator.platform.toLowerCase().includes("win");
export const IS_MACOS =
  navigator.platform.toLowerCase().includes("mac") ||
  navigator.userAgent.toLowerCase().includes("mac");
