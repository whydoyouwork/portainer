import { act, renderHook } from '@testing-library/react-hooks';
import { useRef } from 'react';

import { sidebarStore } from './sidebarStore';
import { useMobileDrawer } from './useMobileDrawer';

vi.mock('@uirouter/react', () => ({
  useCurrentStateAndParams: () => ({
    state: { name: 'portainer.home' },
    params: {},
  }),
}));

function mockPhone(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function buildPage() {
  document.body.innerHTML = `
    <div id="content-wrapper"><button aria-label="Toggle Sidebar"></button></div>
    <div class="sidebar"><a href="#!/one">One</a><a href="#!/two">Two</a></div>
  `;
  return document.querySelector<HTMLElement>('.sidebar') as HTMLElement;
}

function renderDrawer(isOpen: boolean, root: HTMLElement) {
  return renderHook(
    ({ open }) => {
      const ref = useRef<HTMLElement>(root);
      return useMobileDrawer(open, ref);
    },
    { initialProps: { open: isOpen } }
  );
}

describe('useMobileDrawer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    sidebarStore.setState({ isOpen: false });
  });

  it('keeps a closed drawer out of the tab order', () => {
    mockPhone(true);
    const root = buildPage();

    renderDrawer(false, root);

    expect(root).toHaveAttribute('inert');
  });

  it('makes the page behind an open drawer inert and moves focus into the drawer', () => {
    mockPhone(true);
    const root = buildPage();

    renderDrawer(true, root);

    expect(root).not.toHaveAttribute('inert');
    expect(document.getElementById('content-wrapper')).toHaveAttribute('inert');
    expect(document.activeElement).toBe(root.querySelector('a'));
  });

  it('keeps Tab inside the open drawer', () => {
    mockPhone(true);
    const root = buildPage();
    renderDrawer(true, root);
    const links = root.querySelectorAll('a');
    // jsdom has no layout, so every element reports no offset parent
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    links[1].focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[0]);
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  });

  it('keeps Shift+Tab inside the open drawer', () => {
    mockPhone(true);
    const root = buildPage();
    renderDrawer(true, root);
    const links = root.querySelectorAll('a');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    links[0].focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[1]);
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  });

  it('closes on Escape and returns focus to the toggle', () => {
    mockPhone(true);
    const root = buildPage();
    sidebarStore.setState({ isOpen: true });
    renderDrawer(true, root);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(sidebarStore.getState().isOpen).toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector('button[aria-label="Toggle Sidebar"]')
    );
  });

  it('does nothing at widths where the sidebar is not a drawer', () => {
    mockPhone(false);
    const root = buildPage();

    renderDrawer(true, root);

    expect(root).not.toHaveAttribute('inert');
    expect(document.getElementById('content-wrapper')).not.toHaveAttribute(
      'inert'
    );
  });
});
