import { expect, Page, test } from "@playwright/test";
import { dragTo, loginAsNewUser } from "./helpers";

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function setup(page: Page) {
  await loginAsNewUser(page, "board");
  const team = await (await page.request.post("/api/teams", { data: { name: `Board ${suffix()}` } })).json();
  const epic = await (await page.request.post("/api/epics", { data: { team_id: team.id, title: "Checkout" } })).json();
  const mk = async (title: string, state: string, type = "bug", epic_id: number | null = null) =>
    (await page.request.post("/api/tickets", { data: { team_id: team.id, type, state, title, body: "b", epic_id } })).json();
  return { team, epic, mk };
}

async function cleanup(page: Page, teamId: number) {
  for (const t of await (await page.request.get(`/api/tickets?team_id=${teamId}`)).json())
    await page.request.delete(`/api/tickets/${t.id}`);
  for (const e of await (await page.request.get(`/api/epics?team_id=${teamId}`)).json())
    await page.request.delete(`/api/epics/${e.id}`);
  await page.request.delete(`/api/teams/${teamId}`);
}

// DoD-5 / §8.1–§8.3 / §8.7: five columns, cards in the right column, newest modified first
test("board shows five columns with cards ordered by modified", async ({ page }) => {
  const { team, epic, mk } = await setup(page);
  try {
    const older = await mk("Older new ticket", "new", "feature");
    await mk("Newer new ticket", "new", "bug", epic.id);
    await mk("Work in progress", "in_progress", "fix");
    await mk("Finished", "done");

    await page.goto(`/board?team=${team.id}`);
    const headings = page.getByTestId("board").getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(["NEW", "READY FOR IMPLEMENTATION", "IN PROGRESS", "READY FOR ACCEPTANCE", "DONE"]);
    await expect(page.getByTestId("count-new")).toHaveText("2");
    await expect(page.getByTestId("count-ready_for_implementation")).toHaveText("0");
    await expect(page.getByTestId("count-in_progress")).toHaveText("1");
    await expect(page.getByTestId("count-done")).toHaveText("1");

    const newCards = page.getByTestId("column-new").locator(".ticket-card");
    await expect(newCards.locator(".card-title")).toHaveText(["Newer new ticket", "Older new ticket"]);
    await expect(newCards.first()).toContainText("BUG");
    await expect(newCards.first()).toContainText("Epic: Checkout");
    await expect(newCards.first()).toContainText("just now");

    // Editing the older ticket moves it to the top (§8.7)
    await page.request.patch(`/api/tickets/${older.id}`, { data: { title: "Older, edited" } });
    await page.reload();
    await expect(newCards.locator(".card-title")).toHaveText(["Older, edited", "Newer new ticket"]);

    // §8.8 open a ticket from the board, and the New ticket button
    await newCards.first().click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${older.id}$`));
    await page.goBack();
    await page.getByRole("link", { name: "+ New ticket" }).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/new\\?team=${team.id}$`));
  } finally {
    await cleanup(page, team.id);
  }
});

// DoD-6 / §6.8 / §8.4 / §8.6: drag persists through the API and survives a refresh
test("dragging a card changes its state on the server", async ({ page }) => {
  const { team, mk } = await setup(page);
  try {
    const t = await mk("Drag me", "new");
    await page.goto(`/board?team=${team.id}`);
    const card = page.getByTestId(`card-${t.id}`);

    const patched = page.waitForResponse((r) => r.url().endsWith(`/api/tickets/${t.id}`) && r.request().method() === "PATCH");
    await dragTo(page, card, page.getByTestId("column-done")); // any state to any state (§8.6)
    expect((await patched).status()).toBe(200);
    await expect(page.getByTestId("column-done").getByTestId(`card-${t.id}`)).toBeVisible();
    await expect(page.getByTestId("count-new")).toHaveText("0");
    expect((await (await page.request.get(`/api/tickets/${t.id}`)).json()).state).toBe("done");

    await page.reload();
    await expect(page.getByTestId("column-done").getByTestId(`card-${t.id}`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/board\\?team=${team.id}$`)); // drop did not open the ticket
  } finally {
    await cleanup(page, team.id);
  }
});

// §8.5: a failed drop puts the card back and shows an error
test("failed drop rolls the card back and shows an error", async ({ page }) => {
  const { team, mk } = await setup(page);
  try {
    const t = await mk("Will fail", "in_progress");
    await page.goto(`/board?team=${team.id}`);
    await page.route(`**/api/tickets/${t.id}`, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "error", message: "Server error." }) })
        : route.continue(),
    );
    await dragTo(page, page.getByTestId(`card-${t.id}`), page.getByTestId("column-done"));
    await expect(page.getByTestId("board-notice")).toContainText('Could not move "Will fail" to Done');
    await expect(page.getByTestId("board-notice")).toContainText("returned to In progress");
    await expect(page.getByTestId("column-in_progress").getByTestId(`card-${t.id}`)).toBeVisible();
    await expect(page.getByTestId("count-done")).toHaveText("0");
    expect((await (await page.request.get(`/api/tickets/${t.id}`)).json()).state).toBe("in_progress");
  } finally {
    await page.unrouteAll();
    await cleanup(page, team.id);
  }
});

// Product-owner decision 2026-11-24 (option B): dropping a card whose ticket was deleted elsewhere removes it
test("dropping a ticket deleted elsewhere removes its card", async ({ page }) => {
  const { team, mk } = await setup(page);
  try {
    const keep = await mk("Still here", "new");
    const gone = await mk("Deleted in another tab", "new");
    await page.goto(`/board?team=${team.id}`);
    await expect(page.getByTestId("count-new")).toHaveText("2");

    // someone else deletes it after the board was loaded
    expect((await page.request.delete(`/api/tickets/${gone.id}`)).status()).toBe(204);
    await dragTo(page, page.getByTestId(`card-${gone.id}`), page.getByTestId("column-done"));

    await expect(page.getByTestId("board-notice")).toHaveText(
      `Ticket #${gone.id} "Deleted in another tab" was deleted by someone else and has been removed from the board.`,
    );
    await expect(page.getByTestId(`card-${gone.id}`)).toHaveCount(0);
    await expect(page.getByTestId("count-new")).toHaveText("1");
    await expect(page.getByTestId("count-done")).toHaveText("0");
    await expect(page.getByTestId("ticket-count")).toHaveText("1 ticket");
    await expect(page.getByTestId(`card-${keep.id}`)).toBeVisible();
  } finally {
    await cleanup(page, team.id);
  }
});
