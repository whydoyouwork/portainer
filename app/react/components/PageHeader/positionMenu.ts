import { positionDefault } from '@reach/popover';

// Below this width the header is laid out for tablets and phones (see Sidebar.module.css).
const smallScreenMaxWidth = 991;

/**
 * Where a header menu opens. At desktop widths this is Reach's own placement.
 *
 * Reach decides between aligning the menu to the left or the right of its button by comparing against
 * `window.innerWidth`, which on a phone grows as soon as anything is wider than the screen. A menu
 * that starts wider than the screen therefore never moves, and opens past the right edge. Below
 * 992px the menu is kept inside the layout width instead: aligned to the button's left edge when it
 * fits, to its right edge when that fits better, and against the screen edge otherwise.
 */
export function positionWithinScreen(
  targetRect: Parameters<typeof positionDefault>[0],
  popoverRect: Parameters<typeof positionDefault>[1]
): ReturnType<typeof positionDefault> {
  const screenWidth = document.documentElement.clientWidth;

  if (!targetRect || !popoverRect || screenWidth > smallScreenMaxWidth) {
    return positionDefault(targetRect, popoverRect);
  }

  const alignedLeft = targetRect.left;
  const alignedRight = targetRect.right - popoverRect.width;
  const preferred =
    alignedLeft + popoverRect.width > screenWidth ? alignedRight : alignedLeft;
  const left = Math.max(
    0,
    Math.min(preferred, screenWidth - popoverRect.width)
  );
  const opensUp =
    window.innerHeight < targetRect.bottom + popoverRect.height &&
    targetRect.top - popoverRect.height >= 0;

  return {
    left: `${left + window.pageXOffset}px`,
    top: opensUp
      ? `${targetRect.top - popoverRect.height + window.pageYOffset}px`
      : `${targetRect.bottom + window.pageYOffset}px`,
  };
}
