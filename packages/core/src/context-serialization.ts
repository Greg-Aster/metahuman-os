/**
 * Serialize model context without repeating identical JSON objects or arrays.
 * The first occurrence remains complete; later copies use a JSON Pointer $ref.
 * This changes only the wire representation, never the underlying evidence.
 */
export function serializeContext(value: unknown): string {
  const json = JSON.stringify(value);
  const firstOccurrence = new Map<string, string>();
  function project(item: any, pointer: string): any {
    if (item === null || typeof item !== 'object') return item;
    const contents = JSON.stringify(item);
    const previous = firstOccurrence.get(contents);
    if (previous !== undefined) {
      const reference = { $ref: previous };
      if (JSON.stringify(reference).length < contents.length) return reference;
    } else {
      firstOccurrence.set(contents, pointer);
    }
    if (Array.isArray(item)) return item.map((child, index) => project(child, `${pointer}/${index}`));
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [
      key, project(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`),
    ]));
  }
  return JSON.stringify(project(JSON.parse(json), '#'));
}
