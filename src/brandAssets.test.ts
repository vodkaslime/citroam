/// <reference types="vite/client" />

import indexHtml from "../index.html?raw";
import iconSource from "../src-tauri/icons/icon-source.svg?raw";
import tauriConfig from "../src-tauri/tauri.conf.json?raw";

describe("citroam native brand surfaces", () => {
  it("uses the canvas color before the webview has loaded", () => {
    const config = JSON.parse(tauriConfig);

    expect(config.app.windows[0].backgroundColor).toBe("#F4F6EA");
    expect(indexHtml).toContain('<meta name="theme-color" content="#F4F6EA" />');
  });

  it("uses the Juicy Utility accent and soda surface in the app icon source", () => {
    expect(iconSource).toContain('fill="#F06A3B"');
    expect(iconSource).toContain('fill="#FFFDF7"');
  });

  it("reuses the native citroam mark as the web favicon", () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/src-tauri/icons/icon-source.svg" />');
  });
});
