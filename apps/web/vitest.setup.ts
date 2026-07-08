// jsdom does not implement `window.matchMedia`. GSAP's ScrollTrigger plugin
// (registered eagerly at import time by the vendored SplitText component)
// calls it during `gsap.registerPlugin(...)`, so any jsdom test that imports
// a page/component importing SplitText needs this polyfill in place first.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom also does not implement scrollTo/scrollIntoView on elements -- the
// stick-to-bottom scroll container and the message jump-rail both call these.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}
