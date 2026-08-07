import { FragmentGrouper, coalesceSubtitleFragments } from "../src/core/fragment-grouper";

describe("regroupement des fragments", () => {
  it("conserve la version cumulative la plus complète", () => {
    expect(coalesceSubtitleFragments(["I didn't", "I didn't know", "I didn't know you"])).toBe(
      "I didn't know you",
    );
  });

  it("assemble un fragment détaché commençant en minuscule", () => {
    expect(coalesceSubtitleFragments(["I didn't know", "you were here."])).toBe(
      "I didn't know you were here.",
    );
  });

  it("ne mélange pas deux phrases terminées", () => {
    expect(coalesceSubtitleFragments(["Where are you?", "I'm here."])).toBe("I'm here.");
  });

  it("debounce les mutations rapprochées", async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const grouper = new FragmentGrouper(180, 500);

    grouper.push("I didn't", handler);
    await vi.advanceTimersByTimeAsync(100);
    grouper.push("I didn't know", handler);
    await vi.advanceTimersByTimeAsync(179);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("I didn't know");
  });

  it("plafonne l'attente même quand les fragments continuent d'arriver", async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const grouper = new FragmentGrouper(100, 250);

    grouper.push("I", handler);
    await vi.advanceTimersByTimeAsync(80);
    grouper.push("I am", handler);
    await vi.advanceTimersByTimeAsync(80);
    grouper.push("I am here", handler);
    await vi.advanceTimersByTimeAsync(80);
    grouper.push("I am here now", handler);
    await vi.advanceTimersByTimeAsync(9);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("I am here now");
  });

  it("peut annuler un regroupement obsolète", async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const grouper = new FragmentGrouper(100);
    grouper.push("obsolete", handler);
    grouper.clear();
    await vi.advanceTimersByTimeAsync(100);
    expect(handler).not.toHaveBeenCalled();
  });
});
