import { useEffect } from 'react';
import { useCurrentStateAndParams } from '@uirouter/react';

import { sidebarStore } from './sidebarStore';

// Below this width the sidebar is an off-canvas drawer (see Sidebar.module.css).
const drawerMediaQuery = '(max-width: 767px)';

function isDrawerLayout() {
  return window.matchMedia(drawerMediaQuery).matches;
}

export function closeDrawer({ returnFocus = false } = {}) {
  sidebarStore.getState().setOpen(false);

  if (returnFocus) {
    document
      .querySelector<HTMLElement>('button[aria-label="Toggle Sidebar"]')
      ?.focus();
  }
}

/**
 * On phones, close the sidebar drawer after navigating and when Escape is pressed.
 * Has no effect at tablet and desktop widths.
 */
export function useMobileDrawer(isOpen: boolean) {
  const { state, params } = useCurrentStateAndParams();
  const location = `${state.name}:${JSON.stringify(params)}`;

  useEffect(() => {
    if (isDrawerLayout()) {
      sidebarStore.getState().setOpen(false);
    }
  }, [location]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isDrawerLayout()) {
        closeDrawer({ returnFocus: true });
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);
}
