import { normalizeDetectedText } from "../core/text";
import { collectOpenDomSearchRoots, type OpenDomSearchRoot } from "../dom/open-shadow-dom";
import type { CandidateDiagnostic, PlatformId, SubtitleSnapshot } from "../types";
import type { SubtitleAdapter, SubtitleListener } from "./types";

const MAX_DIAGNOSTIC_CANDIDATES = 30;
const NATIVE_TEXT_TRACK_SELECTOR = "video.textTracks.activeCues";
const OBSERVER_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["class", "style", "hidden", "aria-hidden"],
};

export abstract class BaseDomSubtitleAdapter implements SubtitleAdapter {
  abstract readonly platform: PlatformId;
  abstract readonly name: string;
  abstract readonly selectors: readonly string[];
  abstract readonly nativeSubtitleSelectors: readonly string[];

  private observer: MutationObserver | null = null;
  private listener: SubtitleListener | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private safetyInterval: ReturnType<typeof setInterval> | null = null;
  private lastSignature = "";
  private readonly observedRoots = new Set<OpenDomSearchRoot>();
  private readonly observedTextTracks = new Set<TextTrack>();

  constructor(protected readonly documentRoot: Document = document) {}

  start(listener: SubtitleListener): void {
    this.stop();
    this.listener = listener;
    this.observer = new MutationObserver((records) => this.handleMutations(records));
    this.refreshObservedSources(collectOpenDomSearchRoots(this.documentRoot));
    this.safetyInterval = setInterval(() => {
      this.refreshObservedSources(collectOpenDomSearchRoots(this.documentRoot));
      this.emitIfChanged();
    }, 1_000);
    this.emitIfChanged(true);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observedRoots.clear();
    this.clearTextTrackListeners();
    if (this.scanTimer !== null) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.safetyInterval !== null) {
      clearInterval(this.safetyInterval);
      this.safetyInterval = null;
    }
    this.listener = null;
    this.lastSignature = "";
  }

  readSnapshot(): SubtitleSnapshot {
    const candidates: CandidateDiagnostic[] = [];
    let selectedText = "";
    let selectedSelector: string | null = null;
    const searchRoots =
      this.observedRoots.size > 0
        ? [...this.observedRoots]
        : collectOpenDomSearchRoots(this.documentRoot);

    for (const selector of this.selectors) {
      const elements = searchRoots.flatMap((root) =>
        Array.from(root.querySelectorAll<HTMLElement>(selector)),
      );
      const texts: string[] = [];

      for (const element of elements) {
        const text = normalizeDetectedText(element.textContent ?? "");
        if (candidates.length < MAX_DIAGNOSTIC_CANDIDATES) {
          candidates.push({
            selector,
            tagName: element.tagName.toLocaleLowerCase(),
            className: typeof element.className === "string" ? element.className : "",
            text,
            visible: isElementVisible(element),
          });
        }
        if (text && isElementVisible(element)) {
          texts.push(text);
        }
      }

      if (!selectedText) {
        const combined = combineCandidateTexts(texts);
        if (combined) {
          selectedText = combined;
          selectedSelector = selector;
        }
      }
    }

    if (!selectedText) {
      selectedText = readActiveTextTrackCues(searchRoots);
      if (selectedText) selectedSelector = NATIVE_TEXT_TRACK_SELECTOR;
    }

    return {
      text: selectedText,
      selector: selectedSelector,
      candidates,
      capturedAt: Date.now(),
    };
  }

  private scheduleScan(): void {
    if (this.scanTimer !== null) {
      return;
    }
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.emitIfChanged();
    }, 25);
  }

  private handleMutations(records: readonly MutationRecord[]): void {
    if (records.some((record) => record.type === "childList" && record.addedNodes.length > 0)) {
      this.refreshObservedSources(collectOpenDomSearchRoots(this.documentRoot));
    }
    this.scheduleScan();
  }

  private emitIfChanged(force = false): void {
    const snapshot = this.readSnapshot();
    const signature = `${snapshot.selector ?? ""}\u0000${snapshot.text}`;
    if (!force && signature === this.lastSignature) {
      return;
    }
    this.lastSignature = signature;
    this.listener?.(snapshot);
  }

  private refreshObservedSources(searchRoots: readonly OpenDomSearchRoot[]): void {
    if (!this.observer) return;

    for (const root of searchRoots) {
      if (this.observedRoots.has(root)) continue;
      this.observer.observe(root, OBSERVER_OPTIONS);
      this.observedRoots.add(root);
    }

    const textTracks = collectTextTracks(searchRoots);
    for (const track of this.observedTextTracks) {
      if (textTracks.has(track)) continue;
      track.removeEventListener("cuechange", this.cueChangeListener);
      this.observedTextTracks.delete(track);
    }
    for (const track of textTracks) {
      if (this.observedTextTracks.has(track)) continue;
      track.addEventListener("cuechange", this.cueChangeListener);
      this.observedTextTracks.add(track);
    }
  }

  private clearTextTrackListeners(): void {
    for (const track of this.observedTextTracks) {
      track.removeEventListener("cuechange", this.cueChangeListener);
    }
    this.observedTextTracks.clear();
  }

  private readonly cueChangeListener = (): void => this.scheduleScan();
}

function collectTextTracks(searchRoots: readonly OpenDomSearchRoot[]): Set<TextTrack> {
  const tracks = new Set<TextTrack>();
  for (const root of searchRoots) {
    for (const video of root.querySelectorAll<HTMLVideoElement>("video")) {
      for (let index = 0; index < video.textTracks.length; index += 1) {
        const track = video.textTracks[index];
        if (track) tracks.add(track);
      }
    }
  }
  return tracks;
}

function readActiveTextTrackCues(searchRoots: readonly OpenDomSearchRoot[]): string {
  const texts: string[] = [];
  for (const track of collectTextTracks(searchRoots)) {
    if (track.mode !== "showing") continue;
    let activeCues: TextTrackCueList | null;
    try {
      activeCues = track.activeCues;
    } catch {
      continue;
    }
    if (!activeCues) continue;
    for (let index = 0; index < activeCues.length; index += 1) {
      const cue = activeCues[index] as (TextTrackCue & { text?: unknown }) | undefined;
      if (typeof cue?.text !== "string") continue;
      const text = normalizeDetectedText(cue.text);
      if (text) texts.push(text);
    }
  }
  return combineCandidateTexts(texts);
}

function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function combineCandidateTexts(texts: string[]): string {
  const unique: string[] = [];
  for (const text of texts) {
    if (unique.includes(text)) {
      continue;
    }
    const containingIndex = unique.findIndex(
      (existing) => existing.includes(text) || text.includes(existing),
    );
    if (containingIndex >= 0) {
      const existing = unique[containingIndex];
      if (existing !== undefined && text.length > existing.length) {
        unique[containingIndex] = text;
      }
      continue;
    }
    unique.push(text);
  }
  return normalizeDetectedText(unique.join(" "));
}
