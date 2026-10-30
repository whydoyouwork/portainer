import { X } from 'lucide-react';

import { Button } from '@@/buttons';

import { closeDrawer } from './useMobileDrawer';

/**
 * The phone drawer's own way out. While the drawer is open the page behind it is inert, so its toggle
 * cannot be reached by a screen reader or by keyboard; this is the first control inside the drawer.
 */
export function CloseDrawerButton() {
  return (
    // the drawer's own background sits on the menu below, so this row brings its own
    <div className="flex shrink-0 justify-end bg-[var(--bg-sidebar-color)] px-3 pt-3">
      <Button
        color="none"
        icon={X}
        aria-label="Close menu"
        data-cy="sidebar-close-button"
        className="!h-[44px] !w-[44px] shrink-0 !rounded !text-white hover:bg-graphite-500 focus-visible:!ring-2 focus-visible:!ring-blue-5"
        onClick={() => closeDrawer({ returnFocus: true })}
      />
    </div>
  );
}
