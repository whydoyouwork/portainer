import { X } from 'lucide-react';
import clsx from 'clsx';

import { Button } from '@@/buttons';

import { closeDrawer } from './useMobileDrawer';
import styles from './Sidebar.module.css';

/**
 * The phone drawer's own way out. While the drawer is open the page behind it is inert, so its toggle
 * cannot be reached by a screen reader or by keyboard; this is the first control inside the drawer.
 * It sits level with the logo (see `.closeButton`), so it takes no height from the menu.
 */
export function CloseDrawerButton() {
  return (
    <Button
      color="none"
      icon={X}
      aria-label="Close menu"
      data-cy="sidebar-close-button"
      className={clsx(
        styles.closeButton,
        '!h-[36px] !w-[36px] shrink-0 !rounded !text-white hover:bg-graphite-500 focus-visible:!ring-2 focus-visible:!ring-blue-5'
      )}
      onClick={() => closeDrawer({ returnFocus: true })}
    />
  );
}
