/// <reference types="vite/client" />

import stageSource from "./CanvasStage.tsx?raw";

describe("CanvasStage primary-surface contract", () => {
  it("does not expose a hidden mode", () => {
    expect(stageSource).not.toMatch(/\bhidden:\s*boolean/);
    expect(stageSource).not.toMatch(/\bhidden=\{hidden\}/);
  });
});
