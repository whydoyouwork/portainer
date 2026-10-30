import { useEffect, useState } from 'react';

// The primary input cannot hover: a touch screen. A mouse or trackpad (hover: hover) is not affected.
const touchMediaQuery = '(hover: none)';

// an environment without media queries has no touch screen to serve
function matchTouchQuery() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(touchMediaQuery)
    : undefined;
}

/** True while the primary input is a touch screen, which has no hover to open a flyout with. */
export function useIsTouchInput() {
  const [matches, setMatches] = useState(!!matchTouchQuery()?.matches);

  useEffect(() => {
    const query = matchTouchQuery();
    if (!query) {
      return undefined;
    }

    function onChange() {
      setMatches(!!query?.matches);
    }

    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return matches;
}
