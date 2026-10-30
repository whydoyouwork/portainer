import Tippy, { TippyProps } from '@tippyjs/react';

type Props = {
  content: React.ReactNode;
  children?: TippyProps['children'];
  /** When set, the tooltip is controlled: it opens and closes only through these props, not on hover or focus. */
  visible?: TippyProps['visible'];
  onClickOutside?: TippyProps['onClickOutside'];
  onMount?: TippyProps['onMount'];
};

export function SidebarTooltip({
  children,
  content,
  visible,
  onClickOutside,
  onMount,
}: Props) {
  return (
    <Tippy
      className="sidebar !rounded-md bg-graphite-600 p-3 !opacity-100 th-highcontrast:border th-highcontrast:border-solid th-highcontrast:border-white th-highcontrast:bg-black"
      content={content}
      delay={[0, 0]}
      duration={[0, 0]}
      zIndex={1000}
      placement="right"
      arrow
      allowHTML
      interactive
      visible={visible}
      onClickOutside={onClickOutside}
      onMount={onMount}
    >
      {children}
    </Tippy>
  );
}
