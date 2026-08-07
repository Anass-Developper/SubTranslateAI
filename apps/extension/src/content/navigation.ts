export class SpaNavigationWatcher {
  private lastUrl: string;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly eventHandler = (): void => this.check();

  constructor(
    private readonly callback: () => void,
    private readonly windowRoot: Window = window,
  ) {
    this.lastUrl = windowRoot.location.href;
  }

  start(): void {
    this.stop();
    this.lastUrl = this.windowRoot.location.href;
    this.windowRoot.addEventListener("popstate", this.eventHandler);
    this.windowRoot.addEventListener("hashchange", this.eventHandler);
    this.windowRoot.document.addEventListener("yt-navigate-finish", this.eventHandler);
    this.interval = setInterval(() => this.check(), 500);
  }

  stop(): void {
    this.windowRoot.removeEventListener("popstate", this.eventHandler);
    this.windowRoot.removeEventListener("hashchange", this.eventHandler);
    this.windowRoot.document.removeEventListener("yt-navigate-finish", this.eventHandler);
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private check(): void {
    const currentUrl = this.windowRoot.location.href;
    if (currentUrl === this.lastUrl) {
      return;
    }
    this.lastUrl = currentUrl;
    this.callback();
  }
}
