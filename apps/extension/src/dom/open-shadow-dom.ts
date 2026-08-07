export type OpenDomSearchRoot = Document | ShadowRoot;

/** Returns the document and every recursively reachable open ShadowRoot. */
export function collectOpenDomSearchRoots(documentRoot: Document): OpenDomSearchRoot[] {
  const roots: OpenDomSearchRoot[] = [documentRoot];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    if (!root) continue;
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) {
        roots.push(element.shadowRoot);
      }
    }
  }
  return roots;
}

export function querySelectorAllOpen<T extends Element>(
  documentRoot: Document,
  selector: string,
): T[] {
  return collectOpenDomSearchRoots(documentRoot).flatMap((root) =>
    Array.from(root.querySelectorAll<T>(selector)),
  );
}
