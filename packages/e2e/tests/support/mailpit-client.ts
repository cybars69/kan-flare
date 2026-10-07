/**
 * Reads email sent by the app under test. The app sends through the Cloudflare
 * Email Service binding; `wrangler dev` simulates it locally by logging each
 * message (From/To/Subject) with the path of a file holding its HTML. The
 * e2e web server tees wrangler's output to WRANGLER_LOG (see
 * playwright.config.ts), and this module parses that log.
 *
 * The exported names are kept from the Mailpit client this replaced, so the
 * specs did not have to change.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WRANGLER_LOG = join(tmpdir(), "kan-e2e-wrangler.log");

interface SentMessage {
  to: string;
  htmlPath?: string;
}

/** Log offset of the last clearMailpitInbox(); older messages are ignored. */
let inboxStart = 0;

const ANSI = /\u001b\[[0-9;]*m/g;

function readLog(): string {
  try {
    return readFileSync(WRANGLER_LOG, "utf8").replace(ANSI, "");
  } catch {
    return "";
  }
}

function sentMessages(): SentMessage[] {
  const blocks = readLog()
    .slice(inboxStart)
    .split("send_email binding called with MessageBuilder:")
    .slice(1);
  return blocks.map((block) => ({
    to: /^To: (.*)$/m.exec(block)?.[1]?.trim().toLowerCase() ?? "",
    htmlPath: /^HTML: (.*)$/m.exec(block)?.[1]?.trim(),
  }));
}

const messagesTo = (email: string) =>
  sentMessages().filter((message) => message.to.includes(email.toLowerCase()));

async function waitForMessageHtml(email: string): Promise<string> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const latest = messagesTo(email).at(-1);
    if (latest?.htmlPath) {
      return readFileSync(latest.htmlPath, "utf8");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No email arrived for ${email} within 15s`);
}

export async function getMagicLinkUrl(email: string): Promise<string> {
  const html = await waitForMessageHtml(email);
  const match = /href="([^"]*\/magic-link\/verify[^"]*)"/.exec(html);

  if (!match?.[1]) {
    throw new Error(`Could not find a magic-link URL in the email to ${email}`);
  }

  return match[1].replace(/&amp;/g, "&");
}

export function clearMailpitInbox() {
  inboxStart = readLog().length;
  return Promise.resolve();
}

export function getMailpitMessageCount(email: string): Promise<number> {
  return Promise.resolve(messagesTo(email).length);
}

export async function waitForMailpitMessageCount(
  email: string,
  expectedCount: number,
) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const count = await getMailpitMessageCount(email);
    if (count === expectedCount) return;
    if (count > expectedCount) {
      throw new Error(
        `Expected ${expectedCount} messages for ${email}, but found ${count}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Expected ${expectedCount} messages for ${email} within 15s`);
}

export async function expectMailpitMessageCountToRemain(
  email: string,
  expectedCount: number,
  durationMs = 1_500,
) {
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    const count = await getMailpitMessageCount(email);
    if (count !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} messages for ${email}, but found ${count}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
