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

  // Unfinished rename: leaving the page asks first (product-owner decision 2026-11-24)
  await page.getByRole("button", { name: `Edit ${renamed}` }).click();
  await page.getByRole("textbox", { name: "Team name" }).fill("half-typed name");
  await page.getByRole("link", { name: "Board" }).click();
  const discard = page.getByRole("alertdialog", { name: "Leave without saving changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "No", exact: true }).click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(page.getByRole("textbox", { name: "Team name" })).toHaveValue("half-typed name");
  await page.getByRole("button", { name: "Cancel" }).click(); // explicit Cancel needs no confirmation

  // Delete (empty team) asks for confirmation; Cancel keeps it
  await page.getByRole("button", { name: `Delete ${renamed}` }).click();
  const confirm = page.getByRole("alertdialog", { name: `Delete team "${renamed}"?` });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("cell", { name: renamed, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Delete ${renamed}` }).click();
  await confirm.getByRole("button", { name: "Delete team" }).click();
  await expect(page.getByTestId("teams-notice")).toHaveText(`Team "${renamed}" deleted.`);
  await expect(page.getByRole("cell", { name: renamed, exact: true })).toHaveCount(0);
});

// §3.8: the teams API needs a session
test("teams API returns 401 without a session", async ({ request }) => {
  const r = await request.get("/api/teams");
  expect(r.status()).toBe(401);
});

// Regression (found by the suite 2026-11-24): creating a team while the list is still loading
// must not be hidden by the late, older list response.
test("team created while the list is loading stays visible", async ({ page }) => {
  await loginAsNewUser(page, "teamrace");
  const name = `QA Race ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  let delayed = false;
  await page.route("**/api/teams", async (route) => {
    if (route.request().method() === "GET" && !delayed) {
      delayed = true;
      const response = await route.fetch(); // snapshot taken BEFORE the team exists
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });
  try {
    await page.goto("/teams");
    await page.getByRole("button", { name: "+ Create team" }).click();
    await page.getByRole("dialog").getByLabel("Team name").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await page.waitForTimeout(2000); // the old list answer arrives now
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  } finally {
    await page.unrouteAll();
    const team = (await (await page.request.get("/api/teams")).json()).find((t: { name: string }) => t.name === name);
    if (team) await page.request.delete(`/api/teams/${team.id}`);
  }
});
