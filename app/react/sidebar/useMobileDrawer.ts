import { RefObject, useEffect, useState } from 'react';
import { useCurrentStateAndParams } from '@uirouter/react';

import { sidebarStore } from './sidebarStore';

// Below this width the sidebar is an off-canvas drawer (see Sidebar.module.css).
const drawerMediaQuery = '(max-width: 767px)';

const toggleSelector = 'button[aria-label="Toggle Sidebar"]';
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// an environment without media queries has no phone screen to serve
function isDrawerLayout() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(drawerMediaQuery).matches
  );
}

let restoreFrame = 0;

function isFocusLost() {
  return !document.activeElement || document.activeElement === document.body;
}

// Puts focus on the toggle, and keeps an eye on it for a moment. A link in the drawer to another page replaces the
// page it was opened from, header and toggle included, so the toggle that has focus is removed and focus falls
// back to <body>: when that happens, put it on the toggle of the page that was opened.
function focusToggle() {
  window.cancelAnimationFrame(restoreFrame);

  const toggle = document.querySelector<HTMLElement>(toggleSelector);
  toggle?.focus();

  let frames = 0;
  function watch() {
    frames += 1;
    if (!toggle || !toggle.isConnected) {
      const next = document.querySelector<HTMLElement>(toggleSelector);
      if (next) {
        if (isFocusLost()) {
          next.focus();
        }
        return;
      }
    }

    if (frames < 300) {
      restoreFrame = window.requestAnimationFrame(watch);
    }
  }
  restoreFrame = window.requestAnimationFrame(watch);
}

export function closeDrawer({ returnFocus = false } = {}) {
  sidebarStore.getState().setOpen(false);

  if (returnFocus) {
    focusToggle();
  }
}

/**
 * True while the sidebar is laid out as an off-canvas drawer, that is on phones (below 768px).
 * Also the way for a component to know it is on a phone-width screen.
 */
export function useIsDrawerLayout() {
  const [matches, setMatches] = useState(isDrawerLayout);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const query = window.matchMedia(drawerMediaQuery);
    function onChange() {
      setMatches(query.matches);
    }

    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return matches;
}

/**
 * On phones the sidebar is a drawer and behaves as a modal dialog:
 * - closes after a link is followed (including the link of the page you are on), on Escape and on a tap
 *   outside, returning focus to its toggle
 * - moves focus into the drawer when it opens and keeps Tab inside it
 * - makes the page behind it inert and stops it scrolling
 * - is not focusable or readable while closed
 *
 * Has no effect at tablet and desktop widths.
 */
export function useMobileDrawer(
  isOpen: boolean,
  rootRef: RefObject<HTMLElement>
) {
  const { state, params } = useCurrentStateAndParams();
  const location = `${state.name}:${JSON.stringify(params)}`;
  const isDrawer = useIsDrawerLayout();

  useEffect(() => {
    if (isDrawerLayout()) {
      sidebarStore.getState().setOpen(false);
    }
  }, [location]);

  // a closed drawer is off screen: keep it out of the tab order and the accessibility tree
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    if (isDrawer && !isOpen) {
      root.setAttribute('inert', '');
    } else {
      root.removeAttribute('inert');
    }
  }, [isDrawer, isOpen, rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!isOpen || !isDrawer || !root) {
      return undefined;
    }

    // a drawer that is open again is no longer waiting to hand focus back
    window.cancelAnimationFrame(restoreFrame);

    const page = document.getElementById('content-wrapper');
    const previousOverflow = document.body.style.overflow;

    page?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    // the drawer is still `visibility: hidden` for the first frame of its slide, and a hidden
    // element cannot take focus, so retry until it can
    let frame = 0;
    let attempts = 0;
    function focusFirst() {
      const first = root?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
      attempts += 1;
      if (root && !root.contains(document.activeElement) && attempts < 20) {
        frame = window.requestAnimationFrame(focusFirst);
      }
    }
    focusFirst();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeDrawer({ returnFocus: true });
        return;
      }

      if (event.key !== 'Tab' || !root) {
        return;
      }

      const focusable = [
        ...root.querySelectorAll<HTMLElement>(focusableSelector),
      ].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !root.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    // a link to the page you are already on does not change the location, so closing on a location
    // change alone would leave the drawer open
    function onClick(event: MouseEvent) {
      if ((event.target as Element | null)?.closest('a[href]')) {
        closeDrawer();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    root.addEventListener('click', onClick);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('click', onClick);
      page?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      // focus the opener when the drawer closes; the page was inert, so focus was parked inside it
      if (
        root.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        focusToggle();
      }
    };
  }, [isOpen, isDrawer, rootRef]);

  return isDrawer;
}
