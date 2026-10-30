import { RefObject, useEffect, useState } from 'react';
import { useCurrentStateAndParams } from '@uirouter/react';

import { sidebarStore } from './sidebarStore';

// Below this width the sidebar is an off-canvas drawer (see Sidebar.module.css).
const drawerMediaQuery = '(max-width: 767px)';

const toggleSelector = 'button[aria-label="Toggle Sidebar"]';
const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isDrawerLayout() {
  return window.matchMedia(drawerMediaQuery).matches;
}

export function closeDrawer({ returnFocus = false } = {}) {
  sidebarStore.getState().setOpen(false);

  if (returnFocus) {
    document.querySelector<HTMLElement>(toggleSelector)?.focus();
  }
}

/** True while the sidebar is laid out as an off-canvas drawer (phones). */
export function useIsDrawerLayout() {
  const [matches, setMatches] = useState(isDrawerLayout);

  useEffect(() => {
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
 * - closes after navigating, on Escape and on a tap outside, returning focus to its toggle
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

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      page?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      // focus the opener when the drawer closes; the page was inert, so focus was parked inside it
      if (
        root.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        document.querySelector<HTMLElement>(toggleSelector)?.focus();
      }
    };
  }, [isOpen, isDrawer, rootRef]);

  return isDrawer;
}
