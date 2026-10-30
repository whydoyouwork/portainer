import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from '@uirouter/react';
import { useEffect } from 'react';
import userEvent from '@testing-library/user-event';

import { withTestRouter } from '@/react/test-utils/withRouter';

import { Context } from '../useSidebarState';

import { SidebarParent } from './SidebarParent';
import { SidebarItem } from './SidebarItem';

function Empty() {
  return null;
}

const states = [
  { name: 'home', url: '/', component: Empty },
  { name: 'parent', url: '/parent', component: Empty },
  { name: 'parent.child', url: '/child', component: Empty },
];

function mockInput(canHover: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(hover: none)' ? !canHover : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

// the states have no views to load, so transitions are observed as they start rather than by the URL
const transitions = vi.fn();

function TestSidebar() {
  const router = useRouter();
  // the test router cannot finish a transition, which is not what is under test
  router.stateService.defaultErrorHandler(() => {});
  useEffect(() => {
    const deregister = router.transitionService.onStart({}, (transition) => {
      transitions(transition.to().name);
    });
    return () => {
      deregister();
    };
  }, [router]);

  return (
    <>
      <ul>
        <SidebarParent
          label="Parent"
          icon={<svg />}
          to="parent"
          listId="parent-list"
          data-cy="parent"
        >
          <SidebarItem
            to="parent.child"
            label="Child"
            isSubMenu
            data-cy="child"
          />
        </SidebarParent>
      </ul>
      <button type="button">Elsewhere</button>
    </>
  );
}

function renderRail() {
  const Wrapped = withTestRouter(TestSidebar, {
    route: 'home',
    stateConfig: states,
  });
  return render(
    <Context.Provider value={{ isOpen: false, toggle: vi.fn() }}>
      <Wrapped />
    </Context.Provider>
  );
}

function getParentLink() {
  return screen.getByTestId('parent-link');
}

describe('SidebarParent on the collapsed rail', () => {
  beforeEach(() => {
    transitions.mockClear();
  });

  describe('with a touch screen', () => {
    beforeEach(() => mockInput(false));

    it('opens the sub-menu on tap instead of following the parent link', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(getParentLink());

      expect(await screen.findByText('Child')).toBeVisible();
      expect(transitions).not.toHaveBeenCalledWith('parent');
    });

    it('announces whether the sub-menu is open', async () => {
      const user = userEvent.setup();
      renderRail();

      expect(getParentLink()).toHaveAttribute('aria-expanded', 'false');
      // it opens a list of links, not a menu widget, so it must not claim a pop-up menu
      expect(getParentLink()).not.toHaveAttribute('aria-haspopup');
      expect(getParentLink()).toHaveAccessibleName('Parent');

      await user.click(getParentLink());

      await waitFor(() =>
        expect(getParentLink()).toHaveAttribute('aria-expanded', 'true')
      );
    });

    it('moves focus into the sub-menu when it opens', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(getParentLink());

      const child = await screen.findByText('Child');
      await waitFor(() => expect(child.closest('a')).toHaveFocus());
    });

    it('closes on Escape and returns focus to the rail item', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(getParentLink());
      await screen.findByText('Child');

      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(screen.queryByText('Child')).not.toBeInTheDocument()
      );
      expect(getParentLink()).toHaveAttribute('aria-expanded', 'false');
      expect(getParentLink()).toHaveFocus();
    });

    it('closes when tapping outside', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(getParentLink());
      await screen.findByText('Child');

      await user.click(screen.getByText('Elsewhere'));

      await waitFor(() =>
        expect(screen.queryByText('Child')).not.toBeInTheDocument()
      );
    });

    it('closes again when the rail item is tapped a second time', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(getParentLink());
      await screen.findByText('Child');

      await user.click(getParentLink());

      await waitFor(() =>
        expect(screen.queryByText('Child')).not.toBeInTheDocument()
      );
    });

    it('navigates and closes when a sub-item is chosen', async () => {
      const user = userEvent.setup();
      renderRail();
      await user.click(getParentLink());

      await user.click(await screen.findByText('Child'));

      await waitFor(() =>
        expect(transitions).toHaveBeenCalledWith('parent.child')
      );
      await waitFor(() =>
        expect(screen.queryByText('Child')).not.toBeInTheDocument()
      );
    });
  });

  describe('with a mouse', () => {
    beforeEach(() => mockInput(true));

    it('follows the parent link on click', async () => {
      const user = userEvent.setup();
      renderRail();

      await user.click(getParentLink());

      await waitFor(() => expect(transitions).toHaveBeenCalledWith('parent'));
    });

    it('opens the sub-menu on hover and adds no touch attributes', async () => {
      const user = userEvent.setup();
      renderRail();

      expect(getParentLink()).not.toHaveAttribute('aria-expanded');
      expect(getParentLink()).not.toHaveAttribute('aria-haspopup');

      await user.hover(getParentLink());

      expect(await screen.findByText('Child')).toBeVisible();
    });
  });
});
