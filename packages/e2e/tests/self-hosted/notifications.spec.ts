import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { MembersPage } from "../support/pages/members-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

function commentEditor(page: Page): Locator {
  return page
    .locator("div")
    .filter({
      has: page.getByRole("heading", { name: "Activity", exact: true }),
    })
    .last()
    .locator('.tiptap[contenteditable="true"]');
}

test(
  "a mention shows in the recipient's notification bell and opens the card",
  { tag: "@self-hosted" },
  async ({ page, browser }) => {
    test.setTimeout(90_000);

    const author = { ...createTestUser(), name: "Bell Author" };
    const recipient = { ...createTestUser(), name: "Bell Recipient" };
    const board = new BoardPage(page);

    await new AuthPage(page).signUp(author);
    await new SelfHostedOnboardingPage(page).createFirstWorkspace(
      "Bell Workspace",
    );
    await board.createBoard("Bell Board");
    await board.createList("To do");
    await board.createCard("Bell card");
    const boardUrl = page.url();

    const members = new MembersPage(page);
    await members.open();
    const inviteLink = await members.createInviteLink();

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await new AuthPage(recipientPage).signUp(recipient);
    await new SelfHostedOnboardingPage(recipientPage).createFirstWorkspace(
      "Bell Recipient Workspace",
    );
    await recipientPage.goto(inviteLink);
    await recipientPage.waitForURL(/\/boards\?workspacePublicId=/, {
      timeout: 20_000,
    });

    const bell = recipientPage.getByRole("button", {
      name: /^Notifications/,
    });
    await expect(bell).toHaveAccessibleName("Notifications");
    await bell.click();
    await expect(
      recipientPage.getByText("You're all caught up."),
    ).toBeVisible();
    await recipientPage.keyboard.press("Escape");

    // The author mentions the recipient on the card.
    await page.goto(boardUrl);
    await board.openCard("Bell card");
    const editor = commentEditor(page);
    await editor.click();
    await editor.pressSequentially("Over to you ");
    await editor.pressSequentially("@Recipient");
    await page
      .locator(".tippy-box")
      .locator("button")
      .filter({ hasText: recipient.name })
      .click();
    const added = waitForTrpcMutation(page, "card.addComment");
    await page
      .getByRole("button", { name: "Submit comment", exact: true })
      .click();
    await added;

    // The badge refreshes when the window regains focus or on reload.
    await recipientPage.reload();
    await expect(bell).toHaveAccessibleName("Notifications (1 unread)");

    await bell.click();
    const item = recipientPage.getByRole("link", {
      name: /Bell Author mentioned you on Bell card/,
    });
    await expect(item).toBeVisible();
    await expect(item).toContainText("Bell Board · Bell Workspace");

    const markedRead = waitForTrpcMutation(
      recipientPage,
      "notification.markRead",
    );
    await item.click();
    await recipientPage.waitForURL(/\/cards\/[A-Za-z0-9]{12}/);
    await markedRead;
    await expect(bell).toHaveAccessibleName("Notifications");

    // Still listed, now read; "Mark all as read" has nothing left to do.
    await bell.click();
    await expect(item).toBeVisible();
    await expect(
      recipientPage.getByRole("button", { name: "Mark all as read" }),
    ).toBeDisabled();

    await recipientContext.close();
  },
);
