import { normalizeSubtitleText } from './normalization.js';

export interface FragmentAggregation {
  text: string;
  merged: boolean;
}

function longestOverlap(left: string, right: string): number {
  const maximum = Math.min(left.length, right.length);
  for (let size = maximum; size > 0; size -= 1) {
    if (
      left.slice(-size).toLocaleLowerCase('und') === right.slice(0, size).toLocaleLowerCase('und')
    ) {
      return size;
    }
  }
  return 0;
}

export function mergeSubtitleFragments(previous: string, next: string): string {
  const left = normalizeSubtitleText(previous);
  const right = normalizeSubtitleText(next);
  if (!left) return right;
  if (!right) return left;

  const foldedLeft = left.toLocaleLowerCase('und');
  const foldedRight = right.toLocaleLowerCase('und');
  if (foldedRight.startsWith(foldedLeft)) return right;
  if (foldedLeft.startsWith(foldedRight)) return left;

  const overlap = longestOverlap(left, right);
  if (overlap > 0) return `${left}${right.slice(overlap)}`;
  return `${left} ${right}`;
}

/**
 * Agrégateur sans timer: l'appelant garde son debounce et fournit l'horodatage.
 * Une ligne arrivant hors fenêtre démarre automatiquement un nouveau groupe.
 */
export class SubtitleFragmentAggregator {
  readonly #windowMs: number;
  #value = '';
  #lastFragmentAt = Number.NEGATIVE_INFINITY;

  public constructor(windowMs = 220) {
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new RangeError('windowMs doit être un nombre positif');
    }
    this.#windowMs = windowMs;
  }

  public push(fragment: string, now = Date.now()): FragmentAggregation {
    const normalized = normalizeSubtitleText(fragment);
    if (!normalized) return { text: this.#value, merged: false };

    const withinWindow = now - this.#lastFragmentAt <= this.#windowMs;
    const previous = this.#value;
    this.#value = withinWindow ? mergeSubtitleFragments(previous, normalized) : normalized;
    this.#lastFragmentAt = now;
    return { text: this.#value, merged: withinWindow && previous.length > 0 };
  }

  public flush(): string {
    const value = this.#value;
    this.reset();
    return value;
  }

  public reset(): void {
    this.#value = '';
    this.#lastFragmentAt = Number.NEGATIVE_INFINITY;
  }
}
