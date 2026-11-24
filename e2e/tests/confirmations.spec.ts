import { expect, Page, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

// Product-owner decisions 2026-11-24 (PLAN.md §7 C2, C3, C8):
// every delete is confirmed; leaving unsaved edits asks "Leave without saving changes?" —
// Yes: leave, nothing is saved; No: stay, edits kept. One scenario per form, both answers.

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const leaveDialog = (page: Page) => page.getByRole("alertdialog", { name: "Leave without saving changes?" });
const answer = (page: Page, which: "Yes" | "No") =>
  leaveDialog(page).getByRole("button", { name: which, exact: true }).click();

type Fixture = { team: { id: number; name: string }; other: { id: number; name: string } };

async function setup(page: Page, prefix: string): Promise<Fixture> {
  await loginAsNewUser(page, prefix);
  const s = suffix();
  const team = await (await page.request.post("/api/teams", { data: { name: `Confirm ${prefix} ${s}` } })).json();
  const other = await (await page.request.post("/api/teams", { data: { name: `Confirm ${prefix} other ${s}` } })).json();
  return { team, other };
}

async function cleanup(page: Page, f: Fixture) {
  for (const id of [f.team.id, f.other.id]) {
    for (const t of await (await page.request.get(`/api/tickets?team_id=${id}`)).json())
      await page.request.delete(`/api/tickets/${t.id}`);
    for (const e of await (await page.request.get(`/api/epics?team_id=${id}`)).json())
      await page.request.delete(`/api/epics/${e.id}`);
    await page.request.delete(`/api/teams/${id}`);
  }
}

// ---------- deletes ----------

test("epic delete: Cancel keeps the epic", async ({ page }) => {
  const f = await setup(page, "epicdel");
  try {
    await page.request.post("/api/epics", { data: { team_id: f.team.id, title: "Keep me" } });
    await page.goto(`/epics?team=${f.team.id}`);
    await page.getByRole("button", { name: "Delete Keep me" }).click();
    const confirm = page.getByRole("alertdialog", { name: 'Delete epic "Keep me"?' });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId("epics-table").locator("tbody tr")).toHaveText([/Keep me/]);
    expect(await (await page.request.get(`/api/epics?team_id=${f.team.id}`)).json()).toHaveLength(1);
  } finally {
    await cleanup(page, f);
  }
});

// ---------- leave without saving ----------

test("new ticket form: No keeps the input, Yes leaves and creates nothing", async ({ page }) => {
  const f = await setup(page, "newticket");
  try {
    await page.goto(`/board?team=${f.team.id}`);
    await page.getByRole("link", { name: "+ New ticket" }).click();
    await page.getByLabel("Title").fill("Half-written ticket");

    await page.getByRole("link", { name: "Teams" }).click();
    await answer(page, "No");
    await expect(leaveDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/tickets\/new/);
    await expect(page.getByLabel("Title")).toHaveValue("Half-written ticket");

    await page.getByRole("link", { name: "Teams" }).click();
    await answer(page, "Yes");
    await expect(page).toHaveURL(/\/teams$/);
    expect(await (await page.request.get(`/api/tickets?team_id=${f.team.id}`)).json()).toHaveLength(0);
  } finally {
    await cleanup(page, f);
  }
});

test("epic panel: switching team asks once; No stays, Yes switches without saving", async ({ page }) => {
  const f = await setup(page, "epicswitch");
  try {
    const epic = await (await page.request.post("/api/epics", { data: { team_id: f.team.id, title: "Original" } })).json();
    await page.goto(`/epics?team=${f.team.id}`);
    await page.getByRole("button", { name: "Edit Original" }).click();
    await page.getByLabel("Title").fill("Edited, not saved");

    await page.getByLabel("Team").selectOption(String(f.other.id));
    await answer(page, "No");
    await expect(leaveDialog(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`team=${f.team.id}$`));
    await expect(page.getByLabel("Team")).toHaveValue(String(f.team.id));
    await expect(page.getByLabel("Title")).toHaveValue("Edited, not saved");

    // Code review CR-1: after "Yes" the dialog must not come back a second time
    await page.getByLabel("Team").selectOption(String(f.other.id));
    await answer(page, "Yes");
    await expect(page).toHaveURL(new RegExp(`team=${f.other.id}$`));
    await page.waitForTimeout(500);
    await expect(leaveDialog(page)).toHaveCount(0);
    await expect(page.getByTestId("epics-empty")).toBeVisible(); // other team, panel closed
    const saved = (await (await page.request.get(`/api/epics?team_id=${f.team.id}`)).json())[0];
    expect([saved.id, saved.title]).toEqual([epic.id, "Original"]);
  } finally {
    await cleanup(page, f);
  }
});

test("epic panel: leaving the page asks; Yes leaves without saving", async ({ page }) => {
  const f = await setup(page, "epicleave");
  try {
    await page.request.post("/api/epics", { data: { team_id: f.team.id, title: "Stays" } });
    await page.goto(`/epics?team=${f.team.id}`);
    await page.getByRole("button", { name: "Edit Stays" }).click();
    await page.getByLabel("Description (optional)").fill("typed but not saved");
    await page.getByRole("link", { name: "Board" }).click();
    await answer(page, "No");
    await expect(page.getByLabel("Description (optional)")).toHaveValue("typed but not saved");
    await page.getByRole("link", { name: "Board" }).click();
    await answer(page, "Yes");
    await expect(page).toHaveURL(/\/board/);
    const saved = (await (await page.request.get(`/api/epics?team_id=${f.team.id}`)).json())[0];
    expect(saved.description).toBeNull();
  } finally {
    await cleanup(page, f);
  }
});

test("team rename: Yes leaves and keeps the old name", async ({ page }) => {
  const f = await setup(page, "teamrename");
  try {
    await page.goto("/teams");
    await page.getByRole("button", { name: `Edit ${f.team.name}` }).click();
    await page.getByRole("textbox", { name: "Team name" }).fill("Not saved name");
    await page.getByRole("link", { name: "Board" }).click();
    await answer(page, "Yes");
    await expect(page).toHaveURL(/\/board/);
    const names = (await (await page.request.get("/api/teams")).json()).map((t: { name: string }) => t.name);
    expect(names).toContain(f.team.name);
    expect(names).not.toContain("Not saved name");
  } finally {
    await cleanup(page, f);
  }
});

test("create-team dialog: browser Back asks; No keeps the name, Yes creates nothing", async ({ page }) => {
  const f = await setup(page, "teamcreate");
  const name = `Typed only ${suffix()}`;
  try {
    await page.goto("/board");
    await page.getByRole("link", { name: "Teams" }).click(); // in-app history entry for Back
    await page.getByRole("button", { name: "+ Create team" }).click();
    await page.getByRole("dialog").getByLabel("Team name").fill(name);

    await page.goBack();
    await answer(page, "No");
    await expect(page).toHaveURL(/\/teams$/);
    await expect(page.getByRole("dialog").getByLabel("Team name")).toHaveValue(name);

    await page.goBack();
    await answer(page, "Yes");
    await expect(page).toHaveURL(/\/board/);
    const names = (await (await page.request.get("/api/teams")).json()).map((t: { name: string }) => t.name);
    expect(names).not.toContain(name);
  } finally {
    await cleanup(page, f);
  }
});

test("comment draft and comment edit: No keeps the text, Yes leaves without saving", async ({ page }) => {
  const f = await setup(page, "commentleave");
  try {
    const t = await (await page.request.post("/api/tickets", { data: { team_id: f.team.id, type: "bug", title: "T", body: "B" } })).json();
    await page.request.post(`/api/tickets/${t.id}/comments`, { data: { body: "Original comment" } });
    const back = () => page.getByRole("link", { name: `← Back to ${f.team.name}` }).click();

    // Unposted draft
    await page.goto(`/tickets/${t.id}`);
    await page.getByLabel("Add comment").fill("Draft, not posted");
    await back();
    await answer(page, "No");
    await expect(page.getByLabel("Add comment")).toHaveValue("Draft, not posted");
    await back();
    await answer(page, "Yes");
    await expect(page).toHaveURL(new RegExp(`/board\\?team=${f.team.id}$`));

    // Unsaved edit of an existing comment
    await page.goto(`/tickets/${t.id}`);
    await page.getByRole("button", { name: "Edit comment" }).click();
    await page.getByRole("textbox", { name: "Edit comment" }).fill("Edited, not saved");
    await back();
    await answer(page, "Yes");
    await expect(page).toHaveURL(new RegExp(`/board\\?team=${f.team.id}$`));

    const bodies = (await (await page.request.get(`/api/tickets/${t.id}/comments`)).json()).map((c: { body: string }) => c.body);
    expect(bodies).toEqual(["Original comment"]);
  } finally {
    await cleanup(page, f);
  }
});

test("reload with unsaved edits shows the browser's prompt; staying keeps the edits", async ({ page }) => {
  const f = await setup(page, "reload");
  try {
    const t = await (await page.request.post("/api/tickets", { data: { team_id: f.team.id, type: "fix", title: "Saved title", body: "B" } })).json();
    await page.goto(`/tickets/${t.id}`);
    await page.getByLabel("Title").fill("Unsaved title");

    // Stay: dismiss the browser's beforeunload prompt
    const seen: string[] = [];
    page.once("dialog", async (d) => {
      seen.push(d.type());
      await d.dismiss();
    });
    await page.reload({ timeout: 3000 }).catch(() => {}); // reload is cancelled, so it never completes
    expect(seen).toEqual(["beforeunload"]);
    await expect(page.getByLabel("Title")).toHaveValue("Unsaved title");

    // Leave: accept the prompt → page reloads with the saved value
    page.once("dialog", (d) => d.accept());
    await page.reload();
    await expect(page.getByLabel("Title")).toHaveValue("Saved title");

    // Nothing unsaved → no prompt at all
    let prompted = false;
    page.once("dialog", async (d) => {
      prompted = true;
      await d.accept();
    });
    await page.reload();
    expect(prompted).toBe(false);
  } finally {
    page.removeAllListeners("dialog");
    await cleanup(page, f);
  }
});
