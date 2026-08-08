const DEFAULT_PAUSE_DELAY_MS = 700;

export class InitialWarmupPause {
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private pausedVideo: HTMLVideoElement | null = null;
  private handled = false;

  constructor(
    private readonly selectVideo: () => HTMLVideoElement | null,
    private readonly onStateChange: () => void = () => undefined,
    private readonly pauseDelayMs = DEFAULT_PAUSE_DELAY_MS,
  ) {}

  schedule(enabled: boolean): void {
    if (!enabled || this.handled || this.scheduledTimer !== null) return;
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      const video = this.selectVideo();
      if (!video || video.paused || video.ended) return;
      this.handled = true;
      this.pausedVideo = video;
      video.pause();
      this.onStateChange();
    }, this.pauseDelayMs);
  }

  async complete(): Promise<boolean> {
    this.clearScheduledPause();
    this.handled = true;
    return this.resumePausedVideo();
  }

  async disable(): Promise<boolean> {
    this.clearScheduledPause();
    this.handled = true;
    return this.resumePausedVideo();
  }

  async reset(): Promise<boolean> {
    this.clearScheduledPause();
    const resumed = await this.resumePausedVideo();
    this.handled = false;
    return resumed;
  }

  isPausedByExtension(): boolean {
    return this.pausedVideo !== null;
  }

  private clearScheduledPause(): void {
    if (this.scheduledTimer === null) return;
    clearTimeout(this.scheduledTimer);
    this.scheduledTimer = null;
  }

  private async resumePausedVideo(): Promise<boolean> {
    const video = this.pausedVideo;
    this.pausedVideo = null;
    this.onStateChange();
    if (!video?.isConnected || video.ended || !video.paused) return false;
    try {
      await video.play();
      return true;
    } catch {
      return false;
    }
  }
}
