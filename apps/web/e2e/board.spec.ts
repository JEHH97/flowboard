import { expect, test } from "@playwright/test";

test("sign in, create a card, sync to a second client, and capture themes", async ({
  browser,
  page,
}) => {
  const second = await browser.newPage();
  const cardTitle = "Review the onboarding flow";
  const dialogHandler = (dialog: {
    accept: (value?: string) => Promise<void>;
  }) => dialog.accept(cardTitle);
  page.on("dialog", dialogHandler);
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@flowboard.dev");
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });
  await second.goto("/");
  await second.getByLabel("Email").fill("demo@flowboard.dev");
  await second.getByLabel("Password").fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await second.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    second.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".live-status.online")).toBeVisible({
    timeout: 15000,
  });
  await expect(second.locator(".live-status.online")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".heading-tools .avatars")).toHaveAttribute(
    "aria-label",
    /Flowboard Demo/,
  );
  const cookies = await page.context().cookies("http://localhost:3001");
  const cookieHeader = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const boardsResponse = await page.request.get(
    "http://localhost:3001/api/boards",
    {
      headers: { cookie: cookieHeader },
    },
  );
  const boards = (await boardsResponse.json()) as Array<{
    id: string;
    name: string;
  }>;
  const demoBoard = boards.find((board) => board.name === "Product Launch");
  if (!demoBoard) throw new Error("Seed board was not available");
  const boardResponse = await page.request.get(
    `http://localhost:3001/api/boards/${demoBoard.id}`,
    { headers: { cookie: cookieHeader } },
  );
  const boardData = (await boardResponse.json()) as {
    columns: Array<{ cards: Array<{ id: string; title: string }> }>;
  };
  for (const card of boardData.columns.flatMap((column) => column.cards)) {
    if (
      card.title === cardTitle ||
      card.title.startsWith("Review onboarding ") ||
      card.title === "Launch with confidence"
    ) {
      await page.request.delete(
        `http://localhost:3001/api/boards/${demoBoard.id}/cards/${card.id}`,
        { headers: { cookie: cookieHeader } },
      );
    }
  }
  await page.getByRole("button", { name: /Add card to Ideas/ }).click();
  await expect(second.getByText(cardTitle)).toBeVisible({
    timeout: 15000,
  });
  const card = page.getByRole("button", {
    name: `Open card: ${cardTitle}`,
  });
  await card.click();
  const dialog = page.getByRole("dialog", { name: "Edit card" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-labelledby", "card-details-title");
  await expect(page.getByLabel("Card title")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Close card details" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await card.click();
  await page.getByLabel("Card title").fill("Launch with confidence");
  await page.getByLabel("Card description").fill("The launch plan is ready.");
  await page
    .getByLabel("Assignee")
    .selectOption({ label: "Flowboard Demo · owner" });
  await page.getByLabel("New label name").fill("Launch");
  await page.getByRole("button", { name: "Create label" }).click();
  await expect(page.getByRole("checkbox", { name: "Launch" })).toBeChecked();
  await page.getByLabel("Due date").fill("2099-12-31");
  await page.getByLabel("Card title").focus();
  await page.screenshot({ path: "docs/card-details.png" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(second.getByText("Launch with confidence")).toBeVisible({
    timeout: 15000,
  });
  await expect(second.getByText("Launch", { exact: true })).toBeVisible();
  await expect(second.getByText(/Due/)).toBeVisible();
  await page.screenshot({ path: "docs/board-light.png", fullPage: true });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await page.screenshot({ path: "docs/board-dark.png", fullPage: true });
  await expect(page.getByText("Launch with confidence")).toBeVisible();
  await second.close();
});
