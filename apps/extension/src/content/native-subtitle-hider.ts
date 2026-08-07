export class NativeSubtitleHider {
  private styleElement: HTMLStyleElement | null = null;

  constructor(private readonly documentRoot: Document = document) {}

  apply(selectors: readonly string[], hidden: boolean): void {
    this.clear();
    if (!hidden || selectors.length === 0) {
      return;
    }
    const style = this.documentRoot.createElement("style");
    style.dataset.dualSubtitlesNativeHider = "true";
    style.textContent = `${selectors.join(",\n")} {
      opacity: 0 !important;
      color: transparent !important;
      text-shadow: none !important;
    }`;
    (this.documentRoot.head ?? this.documentRoot.documentElement).append(style);
    this.styleElement = style;
  }

  clear(): void {
    this.styleElement?.remove();
    this.styleElement = null;
  }
}
