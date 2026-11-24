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
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete ticket" }).click();
    await expect(page).toHaveURL(/\/board\?team=/);
    expect((await page.request.get(`/api/tickets/${ticket.id}/comments`)).status()).toBe(404);
  } finally {
    await page.request.delete(`/api/tickets/${ticket.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});

// §14 stretch (requested by the product owner 2026-11-24): edit and delete OWN comments
test("edit and delete own comments; others' comments have no actions", async ({ browser, page }) => {
  await loginAsNewUser(page, "cedit");
  const team = await (await page.request.post("/api/teams", { data: { name: `Comment edit ${Date.now()}` } })).json();
  const ticket = await (
    await page.request.post("/api/tickets", { data: { team_id: team.id, type: "bug", title: "Edit comments", body: "b" } })
  ).json();
  // another user comments too (separate browser context = separate session)
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const otherPage = await other.newPage();
  await loginAsNewUser(otherPage, "cother");

  try {
    await page.request.post(`/api/tickets/${ticket.id}/comments`, { data: { body: "My first commnet" } });
    await otherPage.request.post(`/api/tickets/${ticket.id}/comments`, { data: { body: "Someone else's comment" } });

    await page.goto(`/tickets/${ticket.id}`);
    const items = page.getByTestId("comment");
    await expect(items).toHaveCount(2);
    await expect(items.nth(1).getByRole("button", { name: "Edit comment" })).toHaveCount(0); // not mine
    await expect(items.nth(1).getByRole("button", { name: "Delete comment" })).toHaveCount(0);

    // Edit: Cancel keeps the old text; Save stores the new one and marks it (edited)
    await items.first().getByRole("button", { name: "Edit comment" }).click();
    await page.getByRole("textbox", { name: "Edit comment" }).fill("My first comment");
    await page.getByRole("link", { name: /← Back to/ }).click(); // unsaved edit → asks first
    const leave = page.getByRole("alertdialog", { name: "Leave without saving changes?" });
    await leave.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Edit comment" })).toHaveValue("My first comment");
    await items.first().getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("comments-notice")).toHaveText("Comment updated.");
    await expect(items.first().locator(".comment-body")).toHaveText("My first comment");
    await expect(items.first()).toContainText("(edited)");

    // Delete asks for confirmation; Cancel keeps it, confirm removes it
    await items.first().getByRole("button", { name: "Delete comment" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete this comment?" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(items).toHaveCount(2);
    await items.first().getByRole("button", { name: "Delete comment" }).click();
    await confirm.getByRole("button", { name: "Delete comment" }).click();
    await expect(page.getByTestId("comments-notice")).toHaveText("Comment deleted.");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Someone else's comment");

    // The API refuses to touch someone else's comment
    const theirs = (await (await page.request.get(`/api/tickets/${ticket.id}/comments`)).json())[0];
    expect((await page.request.delete(`/api/tickets/${ticket.id}/comments/${theirs.id}`)).status()).toBe(403);
  } finally {
    await other.close();
    await page.request.delete(`/api/tickets/${ticket.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});
