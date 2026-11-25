import { expect, test } from "@playwright/test";

test("shows an error for wrong credentials, signs in, persists across reload, and signs out", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@flowboard.dev");
  await page.getByLabel("Password").fill("not-the-right-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(page.getByRole("status")).toHaveText(/incorrect/i);

  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("Email")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
});
