import { expect, Page, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function makeTeam(page: Page, name: string) {
  return (await page.request.post("/api/teams", { data: { name } })).json();
}
async function makeEpic(page: Page, teamId: number, title: string) {
  return (await page.request.post("/api/epics", { data: { team_id: teamId, title } })).json();
}
async function cleanup(page: Page, teamIds: number[]) {
  for (const id of teamIds) {
    for (const t of await (await page.request.get(`/api/tickets?team_id=${id}`)).json())
      await page.request.delete(`/api/tickets/${t.id}`);
    for (const e of await (await page.request.get(`/api/epics?team_id=${id}`)).json())
      await page.request.delete(`/api/epics/${e.id}`);
    await page.request.delete(`/api/teams/${id}`);
  }
}

// DoD-3 / §6.2–§6.7: create, view, edit, delete a ticket through the UI
test("create, view, edit and delete a ticket", async ({ page }) => {
  const email = await loginAsNewUser(page, "tickets");
  const s = suffix();
  const teamA = await makeTeam(page, `Tickets A ${s}`);
  const teamB = await makeTeam(page, `Tickets B ${s}`);
  await makeEpic(page, teamA.id, "Checkout reliability");
  await makeEpic(page, teamB.id, "Mobile login");

  try {
    // Create: client-side validation first
    await page.goto(`/tickets/new?team=${teamA.id}`);
    await expect(page.getByLabel("Team")).toHaveValue(String(teamA.id));
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Select a type.")).toBeVisible();
    await expect(page.getByText("Title is required.")).toBeVisible();
    await expect(page.getByText("Body is required.")).toBeVisible();

    await page.getByLabel("Type").selectOption({ label: "Bug" });
    await page.getByLabel("State").selectOption({ label: "In progress" });
    await page.getByLabel("Epic (optional)").selectOption({ label: "Checkout reliability" });
    await page.getByLabel("Title").fill("  Payment fails for expired card  ");
    await page.getByLabel("Body").fill("Steps: open checkout, use an expired card.");
    await page.getByRole("button", { name: "Create" }).click();

    // §6.3 view: all fields incl. created by / created / modified (UTC)
    await expect(page.getByTestId("ticket-notice")).toHaveText(/Ticket #\d+ created\./);
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    const id = page.url().split("/").pop();
    await expect(page.getByTestId("ticket-meta")).toContainText(`#${id} • Created by ${email}`);
    await expect(page.getByTestId("ticket-meta")).toContainText("UTC");
    await expect(page.getByRole("heading", { name: "Payment fails for expired card" })).toBeVisible();
    await expect(page.getByLabel("State")).toHaveValue("in_progress");

    // §6.5 saving unchanged values keeps modified
    const modified = await page.getByTestId("ticket-modified").textContent();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("ticket-notice")).toHaveText("No changes to save.");
    const api1 = await (await page.request.get(`/api/tickets/${id}`)).json();

    // §6.6 team change clears the epic; the other team's epics are offered
    await page.getByLabel("Team").selectOption(String(teamB.id));
    await expect(page.getByTestId("ticket-notice")).toHaveText("Epic cleared because the team changed.");
    await expect(page.getByLabel("Epic (optional)")).toHaveValue("");
    await expect(page.getByLabel("Epic (optional)").locator("option")).toHaveText(["No epic", "Mobile login"]);
    await page.getByLabel("Type").selectOption({ label: "Feature" });
    await page.getByLabel("Title").fill("Payment fails (moved)");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("ticket-notice")).toHaveText("Ticket saved.");
    const api2 = await (await page.request.get(`/api/tickets/${id}`)).json();
    expect([api2.team_id, api2.epic_id, api2.type, api2.title]).toEqual([teamB.id, null, "feature", "Payment fails (moved)"]);
    expect(api2.modified_at > api1.modified_at).toBe(true);
    expect(modified).toContain("UTC");

    // Survives reload (§11.2)
    await page.reload();
    await expect(page.getByLabel("Title")).toHaveValue("Payment fails (moved)");

    // §6.7 delete needs explicit confirmation; Cancel keeps the ticket
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Delete ticket #${id}?`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await page.request.get(`/api/tickets/${id}`)).status()).toBe(200);

    await page.getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete ticket" }).click();
    await expect(page).toHaveURL(new RegExp(`/board\\?team=${teamB.id}$`));
    expect((await page.request.get(`/api/tickets/${id}`)).status()).toBe(404);
  } finally {
    await cleanup(page, [teamA.id, teamB.id]);
  }
});

// §5.7 / §6.9 / §4.5 / §5.8 server-side rules seen from the API
test("API enforces enums, same-team epic and 409 delete guards", async ({ page }) => {
  await loginAsNewUser(page, "ticketapi");
  const s = suffix();
  const a = await makeTeam(page, `Rules A ${s}`);
  const b = await makeTeam(page, `Rules B ${s}`);
  const epicB = await makeEpic(page, b.id, "B epic");
  const epicA = await makeEpic(page, a.id, "A epic");
  try {
    const bad = await page.request.post("/api/tickets", { data: { team_id: a.id, type: "task", title: "T", body: "B" } });
    expect(bad.status()).toBe(422);
    const mismatch = await page.request.post("/api/tickets", {
      data: { team_id: a.id, type: "bug", title: "T", body: "B", epic_id: epicB.id },
    });
    expect(mismatch.status()).toBe(422);
    expect((await mismatch.json()).code).toBe("epic_team_mismatch");

    const ok = await page.request.post("/api/tickets", {
      data: { team_id: a.id, type: "fix", title: "T", body: "B", epic_id: epicA.id },
    });
    expect(ok.status()).toBe(201);
    expect((await page.request.delete(`/api/teams/${a.id}`)).status()).toBe(409);
    expect((await page.request.delete(`/api/epics/${epicA.id}`)).status()).toBe(409);

    // UI: epic Delete disabled while referenced
    await page.goto(`/epics?team=${a.id}`);
    await expect(page.getByRole("button", { name: "Delete A epic" })).toBeDisabled();
  } finally {
    await cleanup(page, [a.id, b.id]);
  }
});
