import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { sidebarStore } from './sidebarStore';
import { CloseDrawerButton } from './CloseDrawerButton';

describe('CloseDrawerButton', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    sidebarStore.setState({ isOpen: false });
  });

  it('is a button named "Close menu"', () => {
    render(<CloseDrawerButton />);

    expect(
      screen.getByRole('button', { name: 'Close menu' })
    ).toBeInTheDocument();
  });

  it('closes the drawer and moves focus to the sidebar toggle', async () => {
    const user = userEvent.setup();
    sidebarStore.setState({ isOpen: true });
    render(
      <>
        <button type="button" aria-label="Toggle Sidebar" />
        <CloseDrawerButton />
      </>
    );

    await user.click(screen.getByRole('button', { name: 'Close menu' }));

    expect(sidebarStore.getState().isOpen).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Toggle Sidebar' })
    ).toHaveFocus();
  });
});
