import { expect, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

// DoD-4 / §7: add comments, see author + time, oldest first; ticket modified unchanged (§7.5)
test("add comments and see author and time, oldest first", async ({ page }) => {
  const email = await loginAsNewUser(page, "comments");
  const team = await (await page.request.post("/api/teams", { data: { name: `Comments ${Date.now()}` } })).json();
  const ticket = await (
    await page.request.post("/api/tickets", { data: { team_id: team.id, type: "bug", title: "Has comments", body: "b" } })
  ).json();

  try {
    await page.goto(`/tickets/${ticket.id}`);
    const panel = page.getByTestId("comments");
    await expect(panel.getByTestId("comments-empty")).toBeVisible();

    // §7.3 empty comment rejected
    await panel.getByRole("button", { name: "Post comment" }).click();
    await expect(panel.getByTestId("comment-error")).toHaveText("Comment cannot be empty.");

    await panel.getByLabel("Add comment").fill("Reproduced in Chrome.");
    await panel.getByRole("button", { name: "Post comment" }).click();
    await expect(panel.getByTestId("comment")).toHaveCount(1);
    await expect(panel.getByLabel("Add comment")).toHaveValue("");
    await panel.getByLabel("Add comment").fill("Backend returns HTTP 500.");
    await panel.getByRole("button", { name: "Post comment" }).click();

    await expect(panel.getByTestId("comments-count")).toHaveText("2");
    const items = panel.getByTestId("comment");
    await expect(items.locator(".comment-body")).toHaveText(["Reproduced in Chrome.", "Backend returns HTTP 500."]);
    await expect(items.first().locator(".comment-author")).toHaveText(email);
    await expect(items.first().locator("time")).toContainText("UTC");

    // §7.5 the ticket's modified timestamp did not move; comments persist after reload
    const after = await (await page.request.get(`/api/tickets/${ticket.id}`)).json();
    expect(after.modified_at).toBe(ticket.modified_at);
    await page.reload();
    await expect(page.getByTestId("comment")).toHaveCount(2);

    // §6.7 deleting the ticket removes its comments
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete ticket" }).click();
    await expect(page).toHaveURL(/\/board\?team=/);
    expect((await page.request.get(`/api/tickets/${ticket.id}/comments`)).status()).toBe(404);
  } finally {
    await page.request.delete(`/api/tickets/${ticket.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});
