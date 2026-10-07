import { getCloudflareContext } from "@opennextjs/cloudflare";
import { toPlainText } from "@react-email/render";
import { renderToStaticMarkup } from "react-dom/server";

import { createLogger } from "@kan/logger";

import JoinWorkspaceTemplate from "./templates/join-workspace";
import MagicLinkTemplate from "./templates/magic-link";
import MentionTemplate from "./templates/mention";
import ResetPasswordTemplate from "./templates/reset-password";

const log = createLogger("email");

// The doctype @react-email/render adds, for consistent rendering in mail clients.
const XHTML_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

type Templates = "MAGIC_LINK" | "JOIN_WORKSPACE" | "RESET_PASSWORD" | "MENTION";

const emailTemplates: Record<Templates, React.ComponentType<any>> = {
  MAGIC_LINK: MagicLinkTemplate,
  JOIN_WORKSPACE: JoinWorkspaceTemplate,
  RESET_PASSWORD: ResetPasswordTemplate,
  MENTION: MentionTemplate,
};

interface EmailAddress {
  email: string;
  name?: string;
}

/** The Cloudflare Email Service `send_email` binding (named EMAIL). */
interface SendEmailBinding {
  send(message: {
    from: string | EmailAddress;
    to: string | EmailAddress | (string | EmailAddress)[];
    subject: string;
    html?: string;
    text?: string;
  }): Promise<{ messageId: string }>;
}

const getEmailBinding = (): SendEmailBinding => {
  const { env } = getCloudflareContext() as unknown as {
    env: { EMAIL?: SendEmailBinding };
  };
  if (!env.EMAIL) {
    throw new Error(
      "No send_email binding named EMAIL. Check apps/web/wrangler.jsonc.",
    );
  }
  return env.EMAIL;
};

/** Accepts `address` or `Name <address>`, as EMAIL_FROM did for SMTP. */
export const parseAddress = (value: string): EmailAddress => {
  const match = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1]?.replace(/^"|"$/g, "");
  return name ? { email: match[2] ?? "", name } : { email: match[2] ?? "" };
};

export const sendEmail = async (
  to: string,
  subject: string,
  template: Templates,
  data: Record<string, string>,
) => {
  log.info({ to, subject, template }, "Sending email");
  const from = process.env.EMAIL_FROM;
  try {
    if (!from) throw new Error("EMAIL_FROM is not set");

    const EmailTemplate = emailTemplates[template];
    // Templates don't suspend, so the synchronous renderer is enough. It also
    // avoids @react-email/render's Workers build, which needs a React DOM
    // server API (renderToReadableStream) the bundled React 18 lacks.
    const markup = renderToStaticMarkup(<EmailTemplate {...data} />);
    const html = `${XHTML_DOCTYPE}${markup}`;
    const text = toPlainText(markup);

    const response = await getEmailBinding().send({
      from: parseAddress(from),
      to,
      subject,
      html,
      text,
    });

    log.info(
      { to, subject, template, messageId: response.messageId },
      "Email sent",
    );
    return response;
  } catch (error) {
    log.error(
      { err: error, to, from, subject, template },
      "Email sending failed",
    );
    throw error;
  }
};
