CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `apiKey` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`userId` text NOT NULL,
	`refillInterval` integer,
	`refillAmount` integer,
	`lastRefillAt` integer,
	`enabled` integer,
	`rateLimitEnabled` integer,
	`rateLimitTimeWindow` integer,
	`rateLimitMax` integer,
	`requestCount` integer,
	`remaining` integer,
	`lastRequest` integer,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`permissions` text,
	`metadata` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `board` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`name` text(255) NOT NULL,
	`description` text,
	`slug` text(255) NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	`importId` integer,
	`workspaceId` integer NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`type` text DEFAULT 'regular' NOT NULL,
	`isArchived` integer DEFAULT false NOT NULL,
	`sourceBoardId` integer,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`importId`) REFERENCES `import`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_publicId_unique` ON `board` (`publicId`);--> statement-breakpoint
CREATE INDEX `board_is_archived_idx` ON `board` (`isArchived`);--> statement-breakpoint
CREATE INDEX `board_visibility_idx` ON `board` (`visibility`);--> statement-breakpoint
CREATE INDEX `board_type_idx` ON `board` (`type`);--> statement-breakpoint
CREATE INDEX `board_source_idx` ON `board` (`sourceBoardId`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_slug_per_workspace` ON `board` (`workspaceId`,`slug`) WHERE "board"."deletedAt" IS NULL;--> statement-breakpoint
CREATE TABLE `user_board_favorites` (
	`userId` text NOT NULL,
	`boardId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `boardId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`boardId`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_board_favorite_user_idx` ON `user_board_favorites` (`userId`);--> statement-breakpoint
CREATE INDEX `user_board_favorite_board_idx` ON `user_board_favorites` (`boardId`);--> statement-breakpoint
CREATE TABLE `card_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`type` text NOT NULL,
	`cardId` integer NOT NULL,
	`fromIndex` integer,
	`toIndex` integer,
	`fromListId` integer,
	`toListId` integer,
	`labelId` integer,
	`workspaceMemberId` integer,
	`fromTitle` text,
	`toTitle` text,
	`fromDescription` text,
	`toDescription` text,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`commentId` integer,
	`fromComment` text,
	`toComment` text,
	`fromDueDate` integer,
	`toDueDate` integer,
	`sourceBoardId` integer,
	`attachmentId` integer,
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fromListId`) REFERENCES `list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`toListId`) REFERENCES `list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`labelId`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceMemberId`) REFERENCES `workspace_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`commentId`) REFERENCES `card_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sourceBoardId`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attachmentId`) REFERENCES `card_attachment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_activity_publicId_unique` ON `card_activity` (`publicId`);--> statement-breakpoint
CREATE INDEX `card_activity_card_created_at_idx` ON `card_activity` (`cardId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `card_attachment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`cardId` integer NOT NULL,
	`filename` text(255) NOT NULL,
	`originalFilename` text(255) NOT NULL,
	`contentType` text(100) NOT NULL,
	`size` integer NOT NULL,
	`s3Key` text(500) NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_attachment_publicId_unique` ON `card_attachment` (`publicId`);--> statement-breakpoint
CREATE INDEX `card_attachment_card_created_at_idx` ON `card_attachment` (`cardId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `_card_workspace_members` (
	`cardId` integer NOT NULL,
	`workspaceMemberId` integer NOT NULL,
	PRIMARY KEY(`cardId`, `workspaceMemberId`),
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceMemberId`) REFERENCES `workspace_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `card` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`index` integer NOT NULL,
	`cardNumber` integer,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	`listId` integer NOT NULL,
	`importId` integer,
	`dueDate` integer,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`listId`) REFERENCES `list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`importId`) REFERENCES `import`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_publicId_unique` ON `card` (`publicId`);--> statement-breakpoint
CREATE INDEX `card_list_number_idx` ON `card` (`listId`,`cardNumber`);--> statement-breakpoint
CREATE TABLE `_card_labels` (
	`cardId` integer NOT NULL,
	`labelId` integer NOT NULL,
	PRIMARY KEY(`cardId`, `labelId`),
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`labelId`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `card_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`comment` text NOT NULL,
	`cardId` integer NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_comments_publicId_unique` ON `card_comments` (`publicId`);--> statement-breakpoint
CREATE INDEX `card_comments_card_id_idx` ON `card_comments` (`cardId`);--> statement-breakpoint
CREATE TABLE `card_checklist_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`title` text(500) NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`index` integer NOT NULL,
	`checklistId` integer NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	FOREIGN KEY (`checklistId`) REFERENCES `card_checklist`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_checklist_item_publicId_unique` ON `card_checklist_item` (`publicId`);--> statement-breakpoint
CREATE INDEX `card_checklist_item_checklist_index_idx` ON `card_checklist_item` (`checklistId`,`index`);--> statement-breakpoint
CREATE TABLE `card_checklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`name` text(255) NOT NULL,
	`index` integer NOT NULL,
	`cardId` integer NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_checklist_publicId_unique` ON `card_checklist` (`publicId`);--> statement-breakpoint
CREATE INDEX `card_checklist_card_index_idx` ON `card_checklist` (`cardId`,`index`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feedback` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`url` text NOT NULL,
	`reviewed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `import` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_publicId_unique` ON `import` (`publicId`);--> statement-breakpoint
CREATE TABLE `label` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`name` text(255) NOT NULL,
	`colourCode` text(12),
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`boardId` integer NOT NULL,
	`importId` integer,
	`deletedAt` integer,
	`deletedBy` text,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`boardId`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`importId`) REFERENCES `import`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_publicId_unique` ON `label` (`publicId`);--> statement-breakpoint
CREATE TABLE `list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`name` text(255) NOT NULL,
	`index` integer NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	`boardId` integer NOT NULL,
	`importId` integer,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`boardId`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`importId`) REFERENCES `import`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_publicId_unique` ON `list` (`publicId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(255),
	`email` text(255) NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text(255),
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`stripeCustomerId` text(255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `integration` (
	`provider` text(255) NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text(255),
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	PRIMARY KEY(`userId`, `provider`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_slug_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text(255) NOT NULL,
	`available` integer NOT NULL,
	`reserved` integer NOT NULL,
	`workspaceId` integer,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `workspace_slugs` (
	`slug` text(255) NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_slugs_slug_unique` ON `workspace_slugs` (`slug`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`email` text(255) NOT NULL,
	`userId` text,
	`workspaceId` integer NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	`role` text NOT NULL,
	`roleId` integer,
	`status` text DEFAULT 'invited' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`roleId`) REFERENCES `workspace_roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_publicId_unique` ON `workspace_members` (`publicId`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`name` text(255) NOT NULL,
	`description` text,
	`slug` text(255) NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`showEmailsToMembers` integer DEFAULT true NOT NULL,
	`weekStartDay` integer DEFAULT 1 NOT NULL,
	`cardPrefix` text(10) DEFAULT '' NOT NULL,
	`cardCounter` integer DEFAULT 0 NOT NULL,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	`deletedAt` integer,
	`deletedBy` text,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deletedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_publicId_unique` ON `workspace` (`publicId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_slug_unique` ON `workspace` (`slug`);--> statement-breakpoint
CREATE INDEX `workspace_card_prefix_idx` ON `workspace` (`cardPrefix`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan` text(255) NOT NULL,
	`referenceId` text(12),
	`stripeCustomerId` text(255),
	`stripeSubscriptionId` text(255),
	`status` text(255) NOT NULL,
	`periodStart` integer,
	`periodEnd` integer,
	`cancelAtPeriodEnd` integer,
	`seats` integer,
	`unlimitedSeats` integer DEFAULT false NOT NULL,
	`trialStart` integer,
	`trialEnd` integer,
	`partnerLicenseKey` text(255),
	`partnerTier` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`referenceId`) REFERENCES `workspace`(`publicId`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `workspace_invite_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`workspaceId` integer NOT NULL,
	`code` text(12) NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`createdBy` text,
	`updatedAt` integer,
	`updatedBy` text,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updatedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invite_links_publicId_unique` ON `workspace_invite_links` (`publicId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invite_links_code_unique` ON `workspace_invite_links` (`code`);--> statement-breakpoint
CREATE TABLE `workspace_member_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceMemberId` integer NOT NULL,
	`permission` text(64) NOT NULL,
	`granted` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_member_permission` ON `workspace_member_permissions` (`workspaceMemberId`,`permission`);--> statement-breakpoint
CREATE INDEX `permission_member_idx` ON `workspace_member_permissions` (`workspaceMemberId`);--> statement-breakpoint
CREATE TABLE `workspace_role_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceRoleId` integer NOT NULL,
	`permission` text(64) NOT NULL,
	`granted` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`workspaceRoleId`) REFERENCES `workspace_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_role_permission` ON `workspace_role_permissions` (`workspaceRoleId`,`permission`);--> statement-breakpoint
CREATE INDEX `role_permissions_role_idx` ON `workspace_role_permissions` (`workspaceRoleId`);--> statement-breakpoint
CREATE TABLE `workspace_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`workspaceId` integer NOT NULL,
	`name` text(64) NOT NULL,
	`description` text(255),
	`hierarchyLevel` integer NOT NULL,
	`isSystem` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_roles_publicId_unique` ON `workspace_roles` (`publicId`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_role_per_workspace` ON `workspace_roles` (`workspaceId`,`name`);--> statement-breakpoint
CREATE INDEX `workspace_roles_workspace_idx` ON `workspace_roles` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`type` text NOT NULL,
	`userId` text NOT NULL,
	`cardId` integer,
	`commentId` integer,
	`workspaceId` integer,
	`metadata` text,
	`readAt` integer,
	`createdAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cardId`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`commentId`) REFERENCES `card_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_publicId_unique` ON `notification` (`publicId`);--> statement-breakpoint
CREATE INDEX `notification_user_deleted_idx` ON `notification` (`userId`,`deletedAt`);--> statement-breakpoint
CREATE INDEX `notification_user_read_deleted_idx` ON `notification` (`userId`,`readAt`,`deletedAt`);--> statement-breakpoint
CREATE INDEX `notification_user_type_card_idx` ON `notification` (`userId`,`type`,`cardId`);--> statement-breakpoint
CREATE INDEX `notification_user_type_workspace_idx` ON `notification` (`userId`,`type`,`workspaceId`);--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `notification` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `workspace_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publicId` text(12) NOT NULL,
	`workspaceId` integer NOT NULL,
	`name` text(255) NOT NULL,
	`url` text(2048) NOT NULL,
	`secret` text,
	`events` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_webhooks_publicId_unique` ON `workspace_webhooks` (`publicId`);--> statement-breakpoint
CREATE INDEX `workspace_webhooks_workspace_idx` ON `workspace_webhooks` (`workspaceId`);