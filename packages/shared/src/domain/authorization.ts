export type BoardRole = "owner" | "editor" | "viewer";
export type BoardAction =
  "read" | "create" | "update" | "delete" | "invite" | "manage-members";

const permissions: Record<BoardRole, readonly BoardAction[]> = {
  owner: ["read", "create", "update", "delete", "invite", "manage-members"],
  editor: ["read", "create", "update", "delete"],
  viewer: ["read"],
};

export function can(
  role: BoardRole | null | undefined,
  action: BoardAction,
): boolean {
  return role ? permissions[role].includes(action) : false;
}

export function assertCan(
  role: BoardRole | null | undefined,
  action: BoardAction,
): void {
  if (!can(role, action)) throw new Error("Forbidden");
}
