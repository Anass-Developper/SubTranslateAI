/**
 * Central selector registry. Keep the most precise selectors first. When a
 * platform changes its player, edit this file only and use debug diagnostics
 * to verify the replacement selector before shipping it.
 */
export const YOUTUBE_SUBTITLE_SELECTORS = [
  ".ytp-caption-window-container .ytp-caption-segment",
  ".ytp-caption-window-container .captions-text",
  ".caption-window .ytp-caption-segment",
  ".caption-window .captions-text",
] as const;

export const YOUTUBE_NATIVE_SUBTITLE_SELECTORS = [
  ".ytp-caption-window-container",
  ".caption-window",
] as const;

export const NETFLIX_SUBTITLE_SELECTORS = [
  ".player-timedtext-text-container span",
  "[data-uia='player-subtitle'] span",
  "[data-uia='player-subtitle']",
  ".player-timedtext span",
  ".player-timedtext",
] as const;

export const NETFLIX_NATIVE_SUBTITLE_SELECTORS = [
  ".player-timedtext",
  "[data-uia='player-subtitle']",
] as const;

export const PRIME_VIDEO_SUBTITLE_SELECTORS = [
  ".atvwebplayersdk-captions-text",
  ".atvwebplayersdk-subtitle-text",
  "[data-testid*='subtitle' i]",
  "[class*='captions' i] [class*='text' i]",
  "[class*='subtitle' i] [class*='text' i]",
] as const;

export const PRIME_VIDEO_NATIVE_SUBTITLE_SELECTORS = [
  ".atvwebplayersdk-captions-overlay",
  ".atvwebplayersdk-captions-text",
  "[data-testid*='subtitle' i]",
] as const;

export const CANAL_PLUS_SUBTITLE_SELECTORS = [
  "[data-testid='playerRoot'] .rxp-texttrack-region",
  "[player-root='true'] .rxp-texttrack-region",
  ".rxp-texttrack-region",
  "[data-testid='playerRoot'] [data-testid*='subtitle' i][aria-live]",
  "[player-root='true'] [data-testid*='subtitle' i][aria-live]",
  ".shaka-text-container .shaka-text-wrapper",
] as const;

export const CANAL_PLUS_NATIVE_SUBTITLE_SELECTORS = [
  "[data-testid='playerRoot'] .rxp-texttrack-region",
  "[player-root='true'] .rxp-texttrack-region",
  ".rxp-texttrack-region",
  "[data-testid='playerRoot'] [data-testid*='subtitle' i][aria-live]",
  "[player-root='true'] [data-testid*='subtitle' i][aria-live]",
  ".shaka-text-container",
] as const;

export const APPLE_TV_SUBTITLE_SELECTORS = [
  "[data-testid='subtitle-container'] [role='text']",
  "[data-testid='subtitles-container'] [role='text']",
  "[data-testid*='subtitle' i][aria-live] [role='text']",
  "[data-testid*='caption' i][aria-live] [role='text']",
  ".bmpui-ui-subtitle-overlay .bmpui-ui-subtitle-label",
  ".shaka-text-container .shaka-text-wrapper",
] as const;

export const APPLE_TV_NATIVE_SUBTITLE_SELECTORS = [
  "[data-testid='subtitle-container']",
  "[data-testid='subtitles-container']",
  "[data-testid*='subtitle' i][aria-live]",
  "[data-testid*='caption' i][aria-live]",
  ".bmpui-ui-subtitle-overlay",
  ".shaka-text-container",
] as const;

export const BILIBILI_SUBTITLE_SELECTORS = [
  ".bpx-player-subtitle-panel-major-group .bpx-player-subtitle-panel-text",
  ".bpx-player-subtitle-panel-text",
  ".bpx-player-subtitle-inner-text",
  ".bilibili-player-video-subtitle .subtitle-item-text",
  ".bilibili-player-video-subtitle",
  ".bpx-player-subtitle-wrap",
] as const;

export const BILIBILI_NATIVE_SUBTITLE_SELECTORS = [
  ".bpx-player-subtitle-panel",
  ".bpx-player-subtitle-wrap",
  ".bilibili-player-video-subtitle",
] as const;

export const GENERIC_SUBTITLE_SELECTORS = [
  ".rxp-texttrack-region",
  ".shaka-text-container .shaka-text-wrapper",
  ".shaka-text-container .shaka-text-region",
  ".bmpui-ui-subtitle-overlay .bmpui-ui-subtitle-label",
  ".vjs-text-track-display .vjs-text-track-cue",
  ".jw-text-track-display .jw-text-track-cue",
  ".plyr__captions .plyr__caption",
  ".theoplayer-texttrack-region",
  "[data-testid='subtitle-container'] [role='text']",
  "[data-testid='subtitles-container'] [role='text']",
  "video ~ [class*='subtitle' i]",
  "video ~ [class*='caption' i]",
  "[aria-live='assertive'][class*='subtitle' i]",
  "[aria-live='polite'][class*='caption' i]",
  "[class*='subtitle' i] [role='text']",
  "[class*='caption' i] [role='text']",
] as const;

export const GENERIC_NATIVE_SUBTITLE_SELECTORS = [
  ".rxp-texttrack-region",
  ".shaka-text-container",
  ".bmpui-ui-subtitle-overlay",
  ".vjs-text-track-display",
  ".jw-text-track-display",
  ".plyr__captions",
  ".theoplayer-texttrack-region",
  "[data-testid='subtitle-container']",
  "[data-testid='subtitles-container']",
  "video ~ [class*='subtitle' i]",
  "video ~ [class*='caption' i]",
  "[class*='subtitle' i] [role='text']",
  "[class*='caption' i] [role='text']",
] as const;
