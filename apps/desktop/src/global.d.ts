import type { DesktopApi } from './contracts.js';

declare global {
  interface Window {
    subTranslate: DesktopApi;
  }
}

export {};
