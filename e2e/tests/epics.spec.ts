import { expect, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

// §5.3 / §10.8 epic CRUD on its own screen, §5.2 team fixed, §4.5 team with epics can't be deleted
test("create, edit and delete an epic; team with epics cannot be deleted", async ({ page }) => {
  await loginAsNewUser(page, "epics");
  const teamName = `Epic Team ${suffix()}`;
  const team = await (await page.request.post("/api/teams", { data: { name: teamName } })).json();

  await page.goto("/board");
  await page.getByRole("link", { name: "Epics" }).click();
  await page.getByLabel("Team").selectOption(String(team.id));
  await expect(page).toHaveURL(new RegExp(`/epics\\?team=${team.id}$`));
  await expect(page.getByTestId("epics-empty")).toBeVisible();

  // Create: empty title rejected, then created with trimmed title
  await page.getByRole("button", { name: "+ Create epic" }).click();
  await expect(page.getByTestId("epic-form-team")).toHaveText(`Team: ${teamName} (cannot be changed later)`);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("epic-form-error")).toHaveText("Epic title is required.");
  await page.getByLabel("Title").fill("  Checkout reliability  ");
  await page.getByLabel("Description (optional)").fill("Improve checkout errors.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("epics-notice")).toHaveText('Epic "Checkout reliability" created.');
  const row = page.locator("tr", { hasText: "Checkout reliability" });
  await expect(row).toContainText("Improve checkout errors.");
  await expect(row.getByRole("cell").nth(1)).toHaveText("0");

  // Edit: team shown as fixed; changes survive a reload (§11.2)
  await page.getByRole("button", { name: "Edit Checkout reliability" }).click();
  await expect(page.getByTestId("epic-form-team")).toHaveText(`Team: ${teamName} (cannot be changed)`);
  await page.getByLabel("Title").fill("Checkout v2");

  // Unsaved edits: closing the panel by opening "+ Create epic" asks first; Keep editing keeps the text
  await page.getByRole("button", { name: "+ Create epic" }).click();
  const discard = page.getByRole("alertdialog", { name: "Leave without saving changes?" });
  await discard.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Checkout v2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("epics-notice")).toHaveText('Epic "Checkout v2" saved.');
  await page.reload();
  await expect(page.locator("tr", { hasText: "Checkout v2" })).toBeVisible();

  // §4.5: Teams screen shows 1 epic and Delete is disabled; the API answers 409
  await page.getByRole("link", { name: "Teams" }).click();
  const teamRow = page.locator("tr", { has: page.getByRole("cell", { name: teamName, exact: true }) });
  await expect(teamRow.getByRole("cell").nth(2)).toHaveText("1");
  await expect(teamRow.getByRole("button", { name: `Delete ${teamName}` })).toBeDisabled();
  const blocked = await page.request.delete(`/api/teams/${team.id}`);
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).message).toBe("Team has 0 tickets and 1 epic. Delete or move them first.");

  // Delete the epic → the team becomes deletable
  await page.goto(`/epics?team=${team.id}`);
  await page.getByRole("button", { name: "Delete Checkout v2" }).click();
  await page.getByRole("alertdialog", { name: 'Delete epic "Checkout v2"?' }).getByRole("button", { name: "Delete epic" }).click();
  await expect(page.getByTestId("epics-notice")).toHaveText('Epic "Checkout v2" deleted.');
  await expect(page.getByTestId("epics-empty")).toBeVisible();
  await page.goto("/teams");
  await expect(teamRow.getByRole("button", { name: `Delete ${teamName}` })).toBeEnabled();
  await teamRow.getByRole("button", { name: `Delete ${teamName}` }).click();
  await page.getByRole("button", { name: "Delete team" }).click();
  await expect(page.getByTestId("teams-notice")).toHaveText(`Team "${teamName}" deleted.`);
});

// §5.2 the API refuses to move an epic to another team
test("epic team cannot be changed through the API", async ({ page }) => {
  await loginAsNewUser(page, "epicteam");
  const a = await (await page.request.post("/api/teams", { data: { name: `A ${suffix()}` } })).json();
  const b = await (await page.request.post("/api/teams", { data: { name: `B ${suffix()}` } })).json();
  const epic = await (await page.request.post("/api/epics", { data: { team_id: a.id, title: "Fixed" } })).json();
  const r = await page.request.patch(`/api/epics/${epic.id}`, { data: { team_id: b.id } });
  expect(r.status()).toBe(422);
  expect((await r.json()).message).toBe("The team of an epic cannot be changed.");

  // clean up so the dev database doesn't fill with test teams
  expect((await page.request.delete(`/api/epics/${epic.id}`)).status()).toBe(204);
  expect((await page.request.delete(`/api/teams/${a.id}`)).status()).toBe(204);
  expect((await page.request.delete(`/api/teams/${b.id}`)).status()).toBe(204);
});

// Regression (found by the suite 2026-11-24): a slow response for the previously selected team
// must not overwrite the epics of the team selected now.
test("switching teams quickly shows the selected team's epics", async ({ page }) => {
  await loginAsNewUser(page, "epicrace");
  const s = suffix();
  const a = await (await page.request.post("/api/teams", { data: { name: `Race A ${s}` } })).json();
  const b = await (await page.request.post("/api/teams", { data: { name: `Race B ${s}` } })).json();
  const ea = await (await page.request.post("/api/epics", { data: { team_id: a.id, title: "Epic of A" } })).json();
  const eb = await (await page.request.post("/api/epics", { data: { team_id: b.id, title: "Epic of B" } })).json();
  try {
    await page.route(`**/api/epics?team_id=${a.id}`, async (route) => {
      await new Promise((r) => setTimeout(r, 1500)); // A answers late
      await route.continue();
    });
    await page.goto(`/epics?team=${a.id}`);
    await page.getByLabel("Team").selectOption(String(b.id));
    const rows = page.getByTestId("epics-table").locator("tbody tr");
    await expect(rows).toHaveText([/Epic of B/]);
    await page.waitForTimeout(2000); // let A's late answer arrive
    await expect(rows).toHaveText([/Epic of B/]);
  } finally {
    await page.unrouteAll();
    await page.request.delete(`/api/epics/${ea.id}`);
    await page.request.delete(`/api/epics/${eb.id}`);
    await page.request.delete(`/api/teams/${a.id}`);
    await page.request.delete(`/api/teams/${b.id}`);
  }
});
