export interface PopoverPosition {
  left: number;
  top: number;
  openUp: boolean;
}

export function getPopoverPosition(
  anchorEl: HTMLElement,
  width: number,
  maxHeight: number,
  padding = 8,
): PopoverPosition {
  const rect = anchorEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  let left = rect.left;
  if (left + width > window.innerWidth - padding) {
    left = rect.right - width;
  }
  if (left < padding) left = padding;

  let top: number;
  let openUp = false;
  if (spaceBelow >= maxHeight || spaceBelow >= spaceAbove) {
    top = rect.bottom + 4;
  } else {
    top = rect.top - 4;
    openUp = true;
  }

  return { left, top, openUp };
}
