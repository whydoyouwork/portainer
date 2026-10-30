import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { sidebarId, sidebarStore } from '@/react/sidebar/sidebarStore';

import { SidebarToggleButton } from './SidebarToggleButton';

describe('SidebarToggleButton', () => {
  afterEach(() => {
    sidebarStore.setState({ isOpen: false });
  });

  it('announces whether the sidebar is expanded', async () => {
    const user = userEvent.setup();
    sidebarStore.setState({ isOpen: false });
    render(<SidebarToggleButton />);
    const toggle = screen.getByRole('button', { name: 'Toggle Sidebar' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('points at the sidebar it controls', () => {
    render(<SidebarToggleButton />);

    expect(
      screen.getByRole('button', { name: 'Toggle Sidebar' })
    ).toHaveAttribute('aria-controls', sidebarId);
  });
});
