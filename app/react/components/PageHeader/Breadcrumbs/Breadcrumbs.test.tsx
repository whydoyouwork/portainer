import { render, screen, within } from '@testing-library/react';

import { withTestRouter } from '@/react/test-utils/withRouter';

import { Breadcrumbs } from './Breadcrumbs';

function renderBreadcrumbs(
  breadcrumbs: React.ComponentProps<typeof Breadcrumbs>['breadcrumbs']
) {
  const Wrapped = withTestRouter(() => (
    <Breadcrumbs breadcrumbs={breadcrumbs} />
  ));
  return render(<Wrapped />);
}

describe('Breadcrumbs', () => {
  it('should render a home link', () => {
    renderBreadcrumbs([{ label: 'Settings' }]);

    expect(screen.getByTestId('breadcrumb-home')).toBeInTheDocument();
  });

  it('should render each breadcrumb label', () => {
    renderBreadcrumbs([
      { label: 'Settings' },
      { label: 'Environment Groups' },
      { label: 'Production' },
    ]);

    expect(screen.getByText('Settings')).toBeVisible();
    expect(screen.getByText('Environment Groups')).toBeVisible();
    expect(screen.getByText('Production')).toBeVisible();
  });

  it('should render string breadcrumbs', () => {
    renderBreadcrumbs(['Settings', 'Tags']);

    expect(screen.getByText('Settings')).toBeVisible();
    expect(screen.getByText('Tags')).toBeVisible();
  });

  it('should render a single string breadcrumb', () => {
    renderBreadcrumbs('Environments');

    expect(screen.getByText('Environments')).toBeVisible();
  });

  it('should render linked breadcrumbs with data-cy', () => {
    renderBreadcrumbs([
      { label: 'Settings', link: 'portainer.settings' },
      { label: 'Groups' },
    ]);

    expect(screen.getByTestId('breadcrumb-Settings')).toBeInTheDocument();
  });

  it('should keep the home link first and the crumbs in order', () => {
    renderBreadcrumbs([
      { label: 'Settings' },
      { label: 'Environment Groups' },
      { label: 'Production' },
    ]);

    const nodes = [
      screen.getByTestId('breadcrumb-home'),
      screen.getByText('Settings'),
      screen.getByText('Environment Groups'),
      screen.getByText('Production'),
    ];

    nodes.slice(1).forEach((node, index) => {
      expect(
        nodes[index].compareDocumentPosition(node) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  });

  it('should still render the home link when there are no crumbs', () => {
    renderBreadcrumbs([]);

    expect(screen.getByTestId('breadcrumb-home')).toBeInTheDocument();
  });

  it('should be a navigation landmark with a named home link', () => {
    renderBreadcrumbs([{ label: 'Settings' }]);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByLabelText('Home')).toBe(
      screen.getByTestId('breadcrumb-home')
    );
  });

  it('should mark only the last crumb as the current page', () => {
    renderBreadcrumbs([
      { label: 'Settings', link: 'portainer.settings' },
      { label: 'Environment Groups' },
      'Production',
    ]);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const current = nav.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Production');
  });

  it('should mark a linked last crumb on the link itself', () => {
    renderBreadcrumbs([{ label: 'Settings', link: 'portainer.settings' }]);

    expect(screen.getByTestId('breadcrumb-Settings')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('should not mark a current page when there are no crumbs', () => {
    renderBreadcrumbs([]);

    expect(
      screen
        .getByRole('navigation', { name: 'Breadcrumb' })
        .querySelector('[aria-current]')
    ).toBeNull();
  });
});
