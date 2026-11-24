import { expect, test } from "@playwright/test";
import { loginAsNewUser } from "./helpers";

// Fixes from the code + security review, 2026-11-24

test("Log out with unsaved edits asks first", async ({ page }) => {
  await loginAsNewUser(page, "logoutguard");
  const team = await (await page.request.post("/api/teams", { data: { name: `Logout ${Date.now()}` } })).json();
  const t = await (await page.request.post("/api/tickets", { data: { team_id: team.id, type: "bug", title: "T", body: "B" } })).json();
  try {
    await page.goto(`/tickets/${t.id}`);
    await page.getByLabel("Body").fill("B\nunsaved line");
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    const leave = page.getByRole("alertdialog", { name: "Leave without saving changes?" });
    await leave.getByRole("button", { name: "No", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${t.id}$`));
    await expect(page.getByLabel("Body")).toHaveValue("B\nunsaved line");
    expect((await page.request.get("/api/auth/me")).status()).toBe(200); // still logged in

    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await leave.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  } finally {
    await loginAsNewUser(page, "logoutclean");
    await page.request.delete(`/api/tickets/${t.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});

test("Enter on a focused board card opens the ticket", async ({ page }) => {
  await loginAsNewUser(page, "kbd");
  const team = await (await page.request.post("/api/teams", { data: { name: `Keyboard ${Date.now()}` } })).json();
  const t = await (await page.request.post("/api/tickets", { data: { team_id: team.id, type: "fix", title: "Open me", body: "B" } })).json();
  try {
    await page.goto(`/board?team=${team.id}`);
    await page.getByTestId(`card-${t.id}`).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tickets/${t.id}$`));
  } finally {
    await page.request.delete(`/api/tickets/${t.id}`);
    await page.request.delete(`/api/teams/${team.id}`);
  }
});

test("security headers are sent", async ({ request }) => {
  const r = await request.get("/");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["server"]).toBe("nginx"); // no version number
});

test("cross-origin state changes are refused", async ({ page }) => {
  await loginAsNewUser(page, "csrf");
  const r = await page.request.post("/api/teams", {
    data: { name: `CSRF ${Date.now()}` },
    headers: { Origin: "http://evil.localhost:3000" },
  });
  expect(r.status()).toBe(403);
});
