import { expect, test } from "@playwright/test";
import { dragTo, loginAsNewUser } from "./helpers";

const COUNT = 150;
const TYPES = ["bug", "feature", "fix"];
const STATES = ["new", "ready_for_implementation", "in_progress", "ready_for_acceptance", "done"];

// §8.10: the board stays usable with 100+ tickets. Data is created through the API, never seeded (§9.9).
test("board with 150 tickets loads, filters and drags quickly", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsNewUser(page, "bulk");
  const team = await (await page.request.post("/api/teams", { data: { name: `Bulk ${Date.now()}` } })).json();
  const epic = await (await page.request.post("/api/epics", { data: { team_id: team.id, title: "Bulk epic" } })).json();

  try {
    for (let start = 0; start < COUNT; start += 25) {
      await Promise.all(
        Array.from({ length: Math.min(25, COUNT - start) }, (_, k) => {
          const i = start + k;
          return page.request.post("/api/tickets", {
            data: {
              team_id: team.id,
              type: TYPES[i % 3],
              state: STATES[i % 5],
              title: `Bulk ticket ${String(i).padStart(3, "0")}`,
              body: "Created by the large-board test.",
              epic_id: i % 2 ? epic.id : null,
            },
          });
        }),
      );
    }

    const t0 = Date.now();
    await page.goto(`/board?team=${team.id}`);
    await expect(page.getByTestId("ticket-count")).toHaveText(`${COUNT} tickets`);
    await expect(page.locator(".ticket-card")).toHaveCount(COUNT);
    const loadMs = Date.now() - t0;
    for (const s of STATES) await expect(page.getByTestId(`count-${s}`)).toHaveText(String(COUNT / 5));

    // Filtering 150 cards
    const t1 = Date.now();
    await page.getByLabel("Search").fill("bulk ticket 14");
    await expect(page.getByTestId("ticket-count")).toHaveText(`10 of ${COUNT} tickets`); // 140–149
    const filterMs = Date.now() - t1;
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    // search is applied with useDeferredValue: wait until all cards are back before picking one
    await expect(page.locator(".ticket-card")).toHaveCount(COUNT);

    // Drag still works and persists
    const card = page.getByTestId("column-new").locator(".ticket-card").first();
    const id = (await card.getAttribute("data-testid"))!.replace("card-", "");
    await dragTo(page, card, page.getByTestId("column-done"));
    await expect(page.getByTestId("column-done").getByTestId(`card-${id}`)).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(`/api/tickets/${id}`)).json()).state).toBe("done");

    console.log(`150-ticket board: load+render ${loadMs} ms, filter ${filterMs} ms`);
    expect(loadMs).toBeLessThan(5000);
    expect(filterMs).toBeLessThan(1500);
  } finally {
    for (const t of await (await page.request.get(`/api/tickets?team_id=${team.id}`)).json())
      await page.request.delete(`/api/tickets/${t.id}`);
    await page.request.delete(`/api/epics/${epic.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});
