import { positionDefault } from '@reach/popover';

import { positionWithinScreen } from './positionMenu';

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  } as DOMRect;
}

function setScreenWidth(width: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  });
}

describe('positionWithinScreen', () => {
  const button = rect(292, 19, 80, 36);

  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
  });

  it('keeps a menu that is wider than the screen inside it on a phone', () => {
    setScreenWidth(390);

    const { left } = positionWithinScreen(button, rect(0, 0, 500, 160));

    expect(left).toBe('0px');
  });

  it('aligns a menu to the right edge of its button when the left edge would run off the screen', () => {
    setScreenWidth(390);

    const { left } = positionWithinScreen(button, rect(0, 0, 218, 120));

    expect(left).toBe('154px');
  });

  it('aligns a menu to the left edge of its button when it fits', () => {
    setScreenWidth(768);

    const { left } = positionWithinScreen(
      rect(100, 19, 80, 36),
      rect(0, 0, 218, 120)
    );

    expect(left).toBe('100px');
  });

  it('uses the library placement at desktop widths', () => {
    setScreenWidth(1440);
    // the library decides from window.innerWidth, which is narrower than the screen here
    window.innerWidth = 1024;
    const target = rect(900, 19, 80, 36);
    const popover = rect(0, 0, 218, 120);

    expect(positionWithinScreen(target, popover)).toEqual(
      positionDefault(target, popover)
    );
  });
});
