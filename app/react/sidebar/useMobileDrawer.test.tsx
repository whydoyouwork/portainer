import { act, renderHook } from '@testing-library/react-hooks';
import { waitFor } from '@testing-library/react';
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

  it('closes when a link is followed, including the link of the page you are on', () => {
    mockPhone(true);
    const root = buildPage();
    renderDrawer(true, root);
    // the hook closes the drawer when it mounts (the location "changed"); open it afterwards
    act(() => sidebarStore.setState({ isOpen: true }));
    const link = root.querySelector('a') as HTMLAnchorElement;
    // the page you are on: the click is handled, but the location does not change
    link.addEventListener('click', (event) => event.preventDefault());

    act(() => {
      link.click();
    });

    expect(sidebarStore.getState().isOpen).toBe(false);
  });

  // A link to another page replaces the page it was opened from, header and toggle included. Mutation: the drawer
  // hands focus to the toggle once, as it did before, and that toggle is gone with the old page: focus is left on <body>.
  it('puts focus on the toggle of the new page when a link to another page replaces the header', async () => {
    mockPhone(true);
    const root = buildPage();
    const { rerender } = renderDrawer(true, root);
    act(() => sidebarStore.setState({ isOpen: true }));
    const link = root.querySelector('a') as HTMLAnchorElement;
    link.focus();
    const oldToggle = document.querySelector(
      'button[aria-label="Toggle Sidebar"]'
    ) as HTMLElement;

    act(() => {
      link.click();
    });
    // the sidebar re-renders as closed, and hands focus back to the toggle it can see
    rerender({ open: false });
    expect(document.activeElement).toBe(oldToggle);

    // the new page is drawn: its header, with a new toggle, replaces the old one, and focus falls back to <body>
    oldToggle.remove();
    expect(document.activeElement).toBe(document.body);
    const newToggle = document.createElement('button');
    newToggle.setAttribute('aria-label', 'Toggle Sidebar');
    document.getElementById('content-wrapper')?.append(newToggle);

    await waitFor(() => expect(document.activeElement).toBe(newToggle));
  });

  it('leaves focus alone when the new page has already moved it', async () => {
    mockPhone(true);
    const root = buildPage();
    const { rerender } = renderDrawer(true, root);
    act(() => sidebarStore.setState({ isOpen: true }));
    const link = root.querySelector('a') as HTMLAnchorElement;
    link.focus();
    const oldToggle = document.querySelector(
      'button[aria-label="Toggle Sidebar"]'
    ) as HTMLElement;

    act(() => {
      link.click();
    });
    rerender({ open: false });
    oldToggle.remove();
    const field = document.createElement('input');
    const newToggle = document.createElement('button');
    newToggle.setAttribute('aria-label', 'Toggle Sidebar');
    document.getElementById('content-wrapper')?.append(field, newToggle);
    field.focus();

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    expect(document.activeElement).toBe(field);
  });

  it('stays open when something that is not a link is clicked', () => {
    mockPhone(true);
    const root = buildPage();
    root.insertAdjacentHTML('beforeend', '<span id="label">Label</span>');
    renderDrawer(true, root);
    act(() => sidebarStore.setState({ isOpen: true }));

    act(() => {
      (document.getElementById('label') as HTMLElement).click();
    });

    expect(sidebarStore.getState().isOpen).toBe(true);
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
