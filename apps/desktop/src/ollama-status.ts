export function ollamaModelNames(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return [];
  return payload.models.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.name === 'string' && item.name) return [item.name];
    if (typeof item.model === 'string' && item.model) return [item.model];
    return [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
