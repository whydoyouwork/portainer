import clsx from 'clsx';
import {
  MouseEvent,
  PropsWithChildren,
  RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Instance } from 'tippy.js';

import { AutomationTestingProps } from '@/types';

import { Icon } from '@@/Icon';
import { Link } from '@@/Link';
import { CollapseExpandButton } from '@@/CollapseExpandButton';

import { useSidebarState } from '../useSidebarState';

import { Wrapper } from './Wrapper';
import { PathOptions, useSidebarSrefActive } from './useSidebarSrefActive';
import { SidebarTooltip } from './SidebarTooltip';
import { useIsTouchInput } from './useIsTouchInput';

type Props = {
  label: string;
  icon: React.ReactNode;
  to: string;
  pathOptions?: PathOptions;
  params?: object;
  listId: string;
};

export function SidebarParent({
  children,
  icon,
  label: title,
  to,
  params,
  pathOptions,
  listId,
  'data-cy': dataCy,
}: PropsWithChildren<Props & AutomationTestingProps>) {
  const anchorProps = useSidebarSrefActive(
    to,
    undefined,
    params,
    {},
    pathOptions
  );

  const hasActiveChild = !!anchorProps.className;

  const { isOpen: isSidebarOpen } = useSidebarState();

  const [isExpanded, setIsExpanded] = useState(hasActiveChild);

  // A touch screen has no hover, so on the collapsed rail a tap opens the sub-menu flyout instead of
  // following the parent's link. A mouse still opens it on hover and follows the link on click.
  const isTouch = useIsTouchInput();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const flyout = useRailFlyout(isTouch && !isSidebarOpen, triggerRef);
  const flyoutId = `${listId}-flyout`;

  const parentItem = (
    <Wrapper className="flex flex-col">
      <div
        className={clsx(
          'flex h-8 w-full items-center rounded-md transition-colors duration-200 ease-in-out hover:bg-graphite-500',
          // only highlight the parent when the sidebar is closed/contracted and a child item is selected
          (!isSidebarOpen || !isExpanded) && anchorProps.className
        )}
        data-cy={dataCy}
      >
        <button
          type="button"
          className={clsx(
            'flex h-full flex-1 cursor-pointer items-center border-none bg-transparent p-0',
            isSidebarOpen && 'pl-3'
          )}
          onClick={() => setIsExpanded(true)}
          onClickCapture={flyout.isEnabled ? flyout.onTriggerClick : undefined}
        >
          <Link
            to={to}
            params={params}
            className={clsx(
              'flex h-full w-full list-none items-center border-none !text-inherit hover:!text-inherit hover:no-underline focus:!text-inherit focus:!no-underline',
              {
                'justify-start': isSidebarOpen,
                'justify-center': !isSidebarOpen,
              }
            )}
            data-cy={`${dataCy}-link`}
            aria-label={flyout.isEnabled ? title : undefined}
            aria-expanded={flyout.isEnabled ? flyout.isOpen : undefined}
            aria-controls={flyout.isOpen ? flyoutId : undefined}
          >
            <Icon icon={icon} />
            {isSidebarOpen && <span className="pl-4">{title}</span>}
          </Link>
        </button>
        {isSidebarOpen && (
          <SidebarExpandButton
            onClick={() => setIsExpanded((isExpanded) => !isExpanded)}
            isExpanded={isExpanded}
            listId={listId}
          />
        )}
      </div>
    </Wrapper>
  );

  const childList = (
    <ul
      id={listId}
      // pl-11 must be important because it needs to avoid the padding from '.root ul' in sidebar.module.css
      className={clsx('!pl-11 text-white', {
        hidden: !isExpanded,
        block: isExpanded,
      })}
    >
      {children}
    </ul>
  );

  if (isSidebarOpen)
    return (
      <>
        {parentItem}
        {childList}
      </>
    );

  return (
    <SidebarTooltip
      content={
        <ul id={flyout.isEnabled ? flyoutId : undefined}>
          <li className="mb-1 flex items-center space-x-2 text-sm">
            <span>{title}</span>
          </li>
          <div className="rounded th-highcontrast:border th-highcontrast:border-solid th-highcontrast:border-white th-highcontrast:bg-black">
            {children}
          </div>
        </ul>
      }
      visible={flyout.isEnabled ? flyout.isOpen : undefined}
      onClickOutside={flyout.isEnabled ? flyout.close : undefined}
      onMount={flyout.isEnabled ? flyout.onMount : undefined}
    >
      <span ref={triggerRef}>{parentItem}</span>
    </SidebarTooltip>
  );
}

/**
 * The state of a rail item's sub-menu flyout when it is opened by a tap rather than by hover.
 * It closes on Escape (focus goes back to the rail item), on a tap outside, when focus moves away
 * and when a sub-item is chosen.
 */
function useRailFlyout(isEnabled: boolean, triggerRef: RefObject<HTMLElement>) {
  const [isOpen, setIsOpen] = useState(false);
  const popperRef = useRef<HTMLElement | null>(null);

  const isShown = isEnabled && isOpen;

  if (!isEnabled && isOpen) {
    // the rail went away (the sidebar expanded, or the input changed): forget the open flyout
    setIsOpen(false);
  }

  useEffect(() => {
    if (!isShown) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.querySelector<HTMLElement>('a')?.focus();
      }
    }

    function onFocusIn(event: FocusEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popperRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    // choosing a sub-item navigates (the link's own handler) and closes the flyout
    function onClick(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement;
      if (popperRef.current?.contains(target) && target.closest('a')) {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('click', onClick);
    };
  }, [isShown, triggerRef]);

  return {
    isEnabled,
    isOpen: isShown,
    close: () => setIsOpen(false),
    onTriggerClick(event: MouseEvent) {
      // runs before the link's own handler, so the tap does not navigate
      event.preventDefault();
      event.stopPropagation();
      setIsOpen((isOpen) => !isOpen);
    },
    onMount(instance: Instance) {
      popperRef.current = instance.popper;
      // move focus to the first sub-item so a keyboard or screen reader user lands in the menu
      instance.popper.querySelector<HTMLElement>('a[href]')?.focus();
    },
  };
}

function SidebarExpandButton({
  isExpanded,
  listId,
  onClick,
}: {
  onClick(): void;
  isExpanded: boolean;
  listId: string;
}) {
  return (
    <CollapseExpandButton
      isExpanded={isExpanded}
      onClick={onClick}
      aria-controls={listId}
      data-cy="expand-button"
      className="group flex h-8 flex-none items-center border-none bg-transparent p-0 px-3"
    />
  );
}
