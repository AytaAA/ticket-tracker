import { expect, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

// Team names are global and unique (§4.4), so every run uses its own suffix.
const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

// §4.2 / §4.4 / §10.7: create, duplicate rejected, rename, delete — through the UI
test("create, rename and delete a team", async ({ page }) => {
  await loginAsNewUser(page, "teams");
  const name = `QA Team ${suffix()}`;

  await page.goto("/board");
  await page.getByRole("link", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();

  // Create (name is trimmed)
  await page.getByRole("button", { name: "+ Create team" }).click();
  const dialog = page.getByRole("dialog", { name: "Create team" });
  await dialog.getByLabel("Team name").fill(`   ${name}   `);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("teams-notice")).toHaveText(`Team "${name}" created.`);
  const row = page.locator("tr", { has: page.getByRole("cell", { name, exact: true }) });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(1)).toHaveText("0");
  await expect(row.getByRole("cell").nth(2)).toHaveText("0");
  await expect(row.getByRole("cell").nth(3)).toContainText("UTC");

  // Empty name → client message; duplicate with other case → server 409 message
  await page.getByRole("button", { name: "+ Create team" }).click();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("create-team-error")).toHaveText("Team name is required.");
  await dialog.getByLabel("Team name").fill(name.toUpperCase());
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("create-team-error")).toHaveText(`A team named "${name.toUpperCase()}" already exists.`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Rename inline; survives a refresh (§11.2)
  const renamed = `${name} renamed`;
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  await page.getByRole("textbox", { name: "Team name" }).fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("teams-notice")).toHaveText(`Team renamed to "${renamed}".`);
  await page.reload();
  await expect(page.getByRole("cell", { name: renamed, exact: true })).toBeVisible();

  // Delete (empty team)
  await page.getByRole("button", { name: `Delete ${renamed}` }).click();
  await expect(page.getByTestId("teams-notice")).toHaveText(`Team "${renamed}" deleted.`);
  await expect(page.getByRole("cell", { name: renamed, exact: true })).toHaveCount(0);
});

// §3.8: the teams API needs a session
test("teams API returns 401 without a session", async ({ request }) => {
  const r = await request.get("/api/teams");
  expect(r.status()).toBe(401);
});
