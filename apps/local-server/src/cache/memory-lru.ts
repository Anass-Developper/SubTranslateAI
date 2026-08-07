export class MemoryLru<Key, Value> {
  readonly #entries = new Map<Key, Value>();
  #maximumSize: number;

  public constructor(maximumSize: number) {
    this.#maximumSize = this.#validateSize(maximumSize);
  }

  public get size(): number {
    return this.#entries.size;
  }

  public get(key: Key): Value | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  public set(key: Key, value: Value): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    this.#trim();
  }

  public clear(): void {
    this.#entries.clear();
  }

  public resize(maximumSize: number): void {
    this.#maximumSize = this.#validateSize(maximumSize);
    this.#trim();
  }

  #trim(): void {
    while (this.#entries.size > this.#maximumSize) {
      const oldestKey = this.#entries.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      this.#entries.delete(oldestKey);
    }
  }

  #validateSize(size: number): number {
    if (!Number.isInteger(size) || size < 1) throw new RangeError('Taille LRU invalide');
    return size;
  }
}
