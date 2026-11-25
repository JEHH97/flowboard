import { expect, test } from "@playwright/test";

test("sign in, create a card, sync to a second client, and capture themes", async ({
  browser,
  page,
}) => {
  const second = await browser.newPage();
  const cardTitle = "Review the onboarding flow";
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@flowboard.dev");
  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });
  await second.goto("/");
  await second.getByLabel("Email").fill("demo@flowboard.dev");
  await second
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
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
  await page.getByPlaceholder("Card title").fill(cardTitle);
  await page.getByPlaceholder("Card title").press("Enter");
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

test("deletes a card, a column, and a board", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo@flowboard.dev");
  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "flowboard-demo-password");
  await page.getByRole("button", { name: /Open your workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible({ timeout: 30000 });

  // Clean up any leftover test data from previous runs
  const cookies = await page.context().cookies("http://localhost:3001");
  const cookieHeader = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const boardsResponse = await page.request.get(
    "http://localhost:3001/api/boards",
    { headers: { cookie: cookieHeader } },
  );
  const boardsList = (await boardsResponse.json()) as Array<{
    id: string;
    name: string;
  }>;
  // Clean up old Temp Columns from Product Launch
  const demoBoard = boardsList.find((board) => board.name === "Product Launch");
  if (demoBoard) {
    const boardResponse = await page.request.get(
      `http://localhost:3001/api/boards/${demoBoard.id}`,
      { headers: { cookie: cookieHeader } },
    );
    const boardData = (await boardResponse.json()) as {
      columns: Array<{
        id: string;
        name: string;
        cards: Array<{ id: string }>;
      }>;
    };
    for (const column of boardData.columns) {
      if (column.name === "Temp Column") {
        await page.request.delete(
          `http://localhost:3001/api/boards/${demoBoard.id}/columns/${column.id}`,
          { headers: { cookie: cookieHeader } },
        );
      }
    }
  }
  // Clean up old Scratch boards
  for (const board of boardsList) {
    if (board.name === "Scratch board") {
      await page.request.delete(
        `http://localhost:3001/api/boards/${board.id}`,
        { headers: { cookie: cookieHeader } },
      );
    }
  }

  // A column with a card cascades on delete. Named to not be a substring
  // of any other accessible name used in this test (Playwright's `name`
  // matching is substring-based unless `exact: true` is passed).
  await page.getByRole("button", { name: /Add column/ }).click();
  await expect(page.getByPlaceholder("Column name")).toBeVisible();
  await page.getByPlaceholder("Column name").fill("Temp Column");
  await page.getByPlaceholder("Column name").press("Enter");
  await expect(page.getByRole("heading", { name: "Temp Column" })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: /Add card to Temp Column/ }).click();
  await expect(page.getByPlaceholder("Card title")).toBeVisible();
  await page.getByPlaceholder("Card title").fill("Temporary card");
  await page.getByPlaceholder("Card title").press("Enter");
  await expect(page.getByText("Temporary card")).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Delete Temp Column" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm delete Temp Column" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm delete Temp Column" })
    .click();
  await expect(page.getByRole("heading", { name: "Temp Column" })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await expect(page.getByText("Temporary card")).toHaveCount(0);

  // Deleting the board you're currently viewing must land you back on a
  // remaining board, not a blank state; the only board can't be deleted.
  await page.getByRole("button", { name: /New board/ }).click();
  await page.getByPlaceholder("Board name").fill("Scratch board");
  await page.getByPlaceholder("Board name").press("Enter");
  await page
    .getByRole("button", { name: "Scratch board", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scratch board" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete Scratch board" }).click();
  await page
    .getByRole("button", { name: "Confirm delete Scratch board" })
    .click();
  await expect(page.getByText("Scratch board")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Product Launch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete Product Launch" }),
  ).toHaveCount(0);
});
