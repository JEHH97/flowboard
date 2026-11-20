export function orderBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return (after as number) / 2;
  if (after === undefined) return before + 1024;
  if (after <= before)
    throw new RangeError("The upper order must follow the lower order");
  const midpoint = before + (after - before) / 2;
  if (midpoint === before || midpoint === after)
    throw new RangeError("Ordering gap is exhausted; rebalance first");
  return midpoint;
}

export function rebalance(
  ids: readonly string[],
): Array<{ id: string; order: number }> {
  return ids.map((id, index) => ({ id, order: (index + 1) * 1024 }));
}

export function moveInOrder<T extends { id: string; order: number }>(
  items: readonly T[],
  id: string,
  index: number,
): T[] {
  const current = items.find((item) => item.id === id);
  if (!current) throw new Error("Item was not found");
  const remaining = items
    .filter((item) => item.id !== id)
    .sort((a, b) => a.order - b.order);
  const boundedIndex = Math.max(0, Math.min(index, remaining.length));
  remaining.splice(boundedIndex, 0, current);
  const neighbors = [
    remaining[boundedIndex - 1]?.order,
    remaining[boundedIndex + 1]?.order,
  ];
  const nextOrder = orderBetween(neighbors[0], neighbors[1]);
  return remaining.map((item, position) =>
    position === boundedIndex ? { ...item, order: nextOrder } : item,
  );
}
