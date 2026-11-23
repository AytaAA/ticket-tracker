import { APIRequestContext, expect, Locator, Page } from "@playwright/test";

export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Waits for the newest verification email to `to` in Mailpit and returns the /verify path from it. */
export async function verificationLinkFor(request: APIRequestContext, to: string, expectedCount = 1): Promise<string> {
  let messages: { ID: string }[] = [];
  await expect
    .poll(
      async () => {
        const r = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:"${to}"` } });
        messages = (await r.json()).messages ?? [];
        return messages.length;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(expectedCount);
  // Mailpit returns newest first
  const msg = await (await request.get(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json();
  const match = /https?:\/\/[^\s]+(\/verify\?token=[^\s]+)/.exec(msg.Text);
  expect(match, "verification link in email body").not.toBeNull();
  return match![1];
}

export const TEST_PASSWORD = "e2e-password-1";

/** Signs up + verifies a fresh user through the API and Mailpit, then logs the page's browser context in. */
export async function loginAsNewUser(page: Page, prefix = "user"): Promise<string> {
  const email = uniqueEmail(prefix);
  const signup = await page.request.post("/api/auth/signup", { data: { email, password: TEST_PASSWORD } });
  expect(signup.status()).toBe(201);
  const link = await verificationLinkFor(page.request, email);
  const token = new URL(link, "http://x").searchParams.get("token");
  expect((await page.request.post("/api/auth/verify", { data: { token } })).status()).toBe(200);
  expect((await page.request.post("/api/auth/login", { data: { email, password: TEST_PASSWORD } })).status()).toBe(200);
  return email;
}

/** Pointer drag in small steps so dnd-kit's PointerSensor (6px activation) picks it up. */
export async function dragTo(page: Page, card: Locator, column: Locator) {
  const from = (await card.boundingBox())!;
  const to = (await column.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
}
