import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

if (!("PointerEvent" in globalThis)) {
  globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
}

afterEach(() => {
  localStorage.clear();
});
