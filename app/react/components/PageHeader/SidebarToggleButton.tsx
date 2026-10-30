import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { sidebarId, sidebarStore } from '@/react/sidebar/sidebarStore';

import { TooltipWithChildren } from '@@/Tip/TooltipWithChildren';

export function SidebarToggleButton() {
  const { isOpen, toggle } = sidebarStore();

  return (
    <TooltipWithChildren message={`${isOpen ? 'Collapse' : 'Expand'} sidebar`}>
      <button
        type="button"
        onClick={toggle}
        className="flex h-6 shrink-0 items-center justify-center rounded border-0 bg-transparent text-sm text-gray-8 transition-colors duration-200 hover:bg-gray-6/30 th-highcontrast:text-white th-dark:text-gray-5 max-[991px]:-mx-[6px] max-[991px]:h-[36px] max-[991px]:w-[36px]"
        aria-label="Toggle Sidebar"
        aria-expanded={isOpen}
        aria-controls={sidebarId}
      >
        {isOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
      </button>
    </TooltipWithChildren>
  );
}
