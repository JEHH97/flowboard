import argon2 from "argon2";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";

export async function upsertDemoUser(
  email: string,
  displayName: string,
  password: string,
) {
  const passwordHash = await argon2.hash(password);
  const [user] = await db
    .insert(users)
    .values({ email, displayName, passwordHash })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName, passwordHash },
    })
    .returning();
  if (!user) throw new Error("Could not seed demo user");
  return user;
}
