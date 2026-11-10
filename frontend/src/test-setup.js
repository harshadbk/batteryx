import '@testing-library/jest-dom/vitest'

// jsdom lacks these browser APIs used by Recharts / layout code.
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || RO
window.scrollTo = () => {}
Element.prototype.scrollIntoView = function scrollIntoView() {}
