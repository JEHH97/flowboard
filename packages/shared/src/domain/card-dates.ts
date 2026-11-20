export function isOverdue(
  dueDate: string | Date | null | undefined,
  today = new Date(),
): boolean {
  if (!dueDate) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.toISOString().slice(0, 10) < today.toISOString().slice(0, 10);
}

export function toDateInputValue(
  dueDate: string | Date | null | undefined,
): string {
  if (!dueDate) return "";
  const date = dueDate instanceof Date ? dueDate : new Date(dueDate);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
