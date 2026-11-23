import { expect, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

// §8.9: type AND epic AND case-insensitive title substring; Clear; count
test("filters combine with AND and Clear resets them", async ({ page }) => {
  await loginAsNewUser(page, "filters");
  const team = await (await page.request.post("/api/teams", { data: { name: `Filters ${Date.now()}` } })).json();
  const checkout = await (await page.request.post("/api/epics", { data: { team_id: team.id, title: "Checkout" } })).json();
  const mobile = await (await page.request.post("/api/epics", { data: { team_id: team.id, title: "Mobile" } })).json();
  const rows: [string, string, string, number | null][] = [
    ["Payment fails for expired card", "bug", "new", checkout.id],
    ["PAYMENT page slow", "bug", "in_progress", mobile.id],
    ["Add payment retry", "feature", "done", checkout.id],
    ["Login button misaligned", "bug", "new", null],
    ["Fix rounding", "fix", "ready_for_acceptance", checkout.id],
  ];
  for (const [title, type, state, epic_id] of rows)
    await page.request.post("/api/tickets", { data: { team_id: team.id, title, type, state, epic_id, body: "b" } });

  const titles = () => page.getByTestId("board").locator(".card-title");
  try {
    await page.goto(`/board?team=${team.id}`);
    await expect(page.getByTestId("ticket-count")).toHaveText("5 tickets");

    // Case-insensitive substring over title
    await page.getByLabel("Search").fill("pAyMeNt");
    await expect(page.getByTestId("ticket-count")).toHaveText("3 of 5 tickets");
    await expect(titles()).toHaveCount(3);

    // AND type
    await page.getByLabel("Type").selectOption({ label: "Bug" });
    await expect(page.getByTestId("ticket-count")).toHaveText("2 of 5 tickets");

    // AND epic
    await page.getByLabel("Epic").selectOption({ label: "Checkout" });
    await expect(page.getByTestId("ticket-count")).toHaveText("1 of 5 tickets");
    await expect(titles()).toHaveText(["Payment fails for expired card"]);
    await expect(page.getByTestId("count-new")).toHaveText("1"); // column counts follow the filters

    // No match → message
    await page.getByLabel("Search").fill("nothing like this");
    await expect(page.getByTestId("board-no-match")).toBeVisible();

    // Clear resets everything
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByLabel("Search")).toHaveValue("");
    await expect(page.getByLabel("Type")).toHaveValue("");
    await expect(page.getByLabel("Epic")).toHaveValue("");
    await expect(page.getByTestId("ticket-count")).toHaveText("5 tickets");
    await expect(titles()).toHaveCount(5);
  } finally {
    for (const t of await (await page.request.get(`/api/tickets?team_id=${team.id}`)).json())
      await page.request.delete(`/api/tickets/${t.id}`);
    await page.request.delete(`/api/epics/${checkout.id}`);
    await page.request.delete(`/api/epics/${mobile.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});
