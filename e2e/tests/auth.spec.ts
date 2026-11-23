import { expect, test } from "@playwright/test";
import { uniqueEmail, verificationLinkFor } from "./helpers";

const PASSWORD = "e2e-password-1";

// DoD-1 / §3: sign up → email via SMTP (Mailpit) → verify → log in → log out
test("sign up, verify by email, log in and log out", async ({ page, request }) => {
  const email = uniqueEmail("signup");

  await page.goto("/signup");
  await page.getByLabel("Email").fill(`  ${email.toUpperCase()}  `); // §3.1 trimmed + case-insensitive
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByTestId("signup-success")).toContainText(email);

  // §3.5 unverified account cannot log in
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("Please verify your email before logging in.");

  // §3.4 / §3.6 verify via the emailed link → login screen offered
  const link = await verificationLinkFor(request, email);
  await page.goto(link);
  await expect(page.getByTestId("verify-success")).toContainText("Email verified");
  await page.getByRole("link", { name: "Continue to login" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // §3.6 single-use: opening the link again fails
  await page.goto(link);
  await expect(page.getByTestId("verify-error")).toContainText("already been used");

  // §3.2 log in (email typed with different case)
  await page.goto("/login");
  await page.getByLabel("Email").fill(email.toUpperCase());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.getByTestId("user-menu")).toContainText(email);

  // §11.2 session survives a refresh
  await page.reload();
  await expect(page.getByTestId("board-placeholder")).toBeVisible();

  // §3.2 log out via the user menu (§15)
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // §3.8 protected screen redirects to login after logout
  await page.goto("/board");
  await expect(page).toHaveURL(/\/login$/);
});

// §3.7 / §10.3: resend from the login screen; the earlier link stops working
test("resend from login invalidates the old link", async ({ page, request }) => {
  const email = uniqueEmail("resend");
  const r = await request.post("/api/auth/signup", { data: { email, password: PASSWORD } });
  expect(r.status()).toBe(201);
  const oldLink = await verificationLinkFor(request, email, 1);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Resend email" }).click();
  await expect(page.getByTestId("resend-status")).toContainText("new verification email has been sent");

  const newLink = await verificationLinkFor(request, email, 2);
  expect(newLink).not.toBe(oldLink);

  await page.goto(oldLink);
  await expect(page.getByTestId("verify-error")).toContainText("invalid or has been replaced");

  await page.goto(newLink);
  await expect(page.getByTestId("verify-success")).toBeVisible();
});

// §3.3 / §3.1 client + server validation messages
test("sign-up validation: short password, mismatch, duplicate email", async ({ page, request }) => {
  const email = uniqueEmail("dup");
  await request.post("/api/auth/signup", { data: { email, password: PASSWORD } });

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("different");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByLabel("Email").fill(` ${email.toUpperCase()} `);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
});

// §3.8 API endpoints require authentication
test("protected API returns 401 without a session", async ({ request }) => {
  const r = await request.get("/api/auth/me");
  expect(r.status()).toBe(401);
  expect((await r.json()).code).toBe("unauthenticated");
});
