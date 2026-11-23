import { APIRequestContext, expect } from "@playwright/test";

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
