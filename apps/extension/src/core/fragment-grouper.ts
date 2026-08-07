import { normalizeDetectedText } from "./text";

export type FragmentFlushHandler = (text: string) => void;

export class FragmentGrouper {
  private fragments: string[] = [];
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private settleMs: number,
    private maxWaitMs: number = settleMs,
  ) {}

  setDelays(settleMs: number, maxWaitMs: number): void {
    this.settleMs = settleMs;
    this.maxWaitMs = maxWaitMs;
    if (this.fragments.length > 0) {
      this.restartSettleTimer();
      this.restartMaxWaitTimer();
    }
  }

  private pendingHandler: FragmentFlushHandler | null = null;

  push(fragment: string, handler: FragmentFlushHandler): void {
    const normalized = normalizeDetectedText(fragment);
    if (!normalized) {
      return;
    }
    this.fragments.push(normalized);
    this.pendingHandler = handler;
    this.restartSettleTimer();
    if (this.maxWaitTimer === null) {
      this.startMaxWaitTimer();
    }
  }

  flush(): string {
    this.clearTimers();
    const grouped = coalesceSubtitleFragments(this.fragments);
    this.fragments = [];
    this.pendingHandler = null;
    return grouped;
  }

  clear(): void {
    this.clearTimers();
    this.fragments = [];
    this.pendingHandler = null;
  }

  private restartSettleTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
    }
    if (!this.pendingHandler) {
      return;
    }
    this.settleTimer = setTimeout(() => this.emitPending(), Math.max(0, this.settleMs));
  }

  private restartMaxWaitTimer(): void {
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (this.pendingHandler) this.startMaxWaitTimer();
  }

  private startMaxWaitTimer(): void {
    const maximum = Math.max(0, this.maxWaitMs);
    this.maxWaitTimer = setTimeout(() => this.emitPending(), maximum);
  }

  private emitPending(): void {
    const handler = this.pendingHandler;
    const grouped = this.flush();
    if (grouped && handler) handler(grouped);
  }

  private clearTimers(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    if (this.maxWaitTimer !== null) clearTimeout(this.maxWaitTimer);
    this.settleTimer = null;
    this.maxWaitTimer = null;
  }
}

export function coalesceSubtitleFragments(fragments: readonly string[]): string {
  const clean = fragments.map(normalizeDetectedText).filter(Boolean);
  if (clean.length === 0) {
    return "";
  }

  let result = clean[0] ?? "";
  for (let index = 1; index < clean.length; index += 1) {
    const next = clean[index];
    if (!next || next === result) {
      continue;
    }
    if (next.startsWith(result)) {
      result = next;
      continue;
    }
    if (result.startsWith(next)) {
      result = next;
      continue;
    }
    if (shouldAppendFragment(result, next)) {
      result = `${result} ${next}`;
    } else {
      result = next;
    }
  }
  return normalizeDetectedText(result);
}

function shouldAppendFragment(previous: string, next: string): boolean {
  if (/[.!?。！？…][\]})"'»”]*$/u.test(previous)) {
    return false;
  }
  const firstCharacter = next.trim().charAt(0);
  return (
    /^[a-zà-öø-ÿ]/u.test(firstCharacter) ||
    /^[,;:!?…'’]/u.test(firstCharacter) ||
    /^[\u3400-\u9fff]/u.test(firstCharacter)
  );
}
