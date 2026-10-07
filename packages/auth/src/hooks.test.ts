import { beforeEach, describe, expect, it, vi } from "vitest";

import * as memberRepo from "@kan/db/repository/member.repo";

import { createDatabaseHooks } from "./hooks";


vi.mock("@kan/db/repository/member.repo", () => ({
  getByEmailAndStatus: vi.fn(),
  getByPublicId: vi.fn(),
  acceptInvite: vi.fn(),
}));

vi.mock("@kan/db/repository/user.repo", () => ({
  update: vi.fn(),
}));

vi.mock("@kan/email", () => ({
  createSubscriber: vi.fn(),
  triggerSubscriberWorkflow: vi.fn(),
}));

vi.mock("@kan/shared/storage", () => ({
  generateAvatarUrl: vi.fn(() => Promise.resolve(null)),
  isStorageConfigured: vi.fn(() => false),
  putObject: vi.fn(),
}));

/**
 * Sets the environment variables hooks.ts reads from a lookup function, in
 * the style of the old next-runtime-env mock.
 */
const ENV_KEYS = ["NEXT_PUBLIC_DISABLE_SIGN_UP"];
const mockEnv = {
  mockImplementation(lookup: (key: string) => string | undefined) {
    for (const key of ENV_KEYS) {
      const value = lookup(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  },
  mockReturnValue(value: string | undefined) {
    mockEnv.mockImplementation(() => value);
  },
};
const mockGetByEmailAndStatus = memberRepo.getByEmailAndStatus as ReturnType<
  typeof vi.fn
>;

const db = {} as Parameters<typeof createDatabaseHooks>[0];

const fakeUser = {
  id: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  email: "test@example.com",
  emailVerified: false,
  name: "Test User",
};

describe("createDatabaseHooks", () => {
  const hooks = createDatabaseHooks(db);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("user.create.before", () => {
    it("allows sign-up when DISABLE_SIGN_UP is not set", async () => {
      mockEnv.mockReturnValue(undefined);

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).not.toHaveBeenCalled();
    });

    it("allows sign-up when DISABLE_SIGN_UP is false", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "false" : undefined,
      );

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).not.toHaveBeenCalled();
    });

    it("blocks sign-up when disabled and user has no pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      mockGetByEmailAndStatus.mockResolvedValue(undefined);

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(false);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "test@example.com",
        "invited",
      );
    });

    it("allows sign-up when disabled but user has a pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-1",
        email: "test@example.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "test@example.com",
        "invited",
      );
    });

    it("blocks sign-up when disabled and invitation exists but domain is not allowed", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      process.env.BETTER_AUTH_ALLOWED_DOMAINS = "acme.com";
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-1",
        email: "test@example.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(false);

      delete process.env.BETTER_AUTH_ALLOWED_DOMAINS;
    });

    // The user.create.before hook fires for ALL sign-up paths including
    // OIDC/social — verify invite bypass works regardless of auth method.
    it("allows OIDC/social sign-up when disabled but user has a pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      const oidcUser = {
        ...fakeUser,
        id: "user-oidc",
        email: "sso@corp.com",
        image: "https://provider.com/avatar.jpg",
      };
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-2",
        email: "sso@corp.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(oidcUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "sso@corp.com",
        "invited",
      );
    });

    it("blocks OIDC/social sign-up when disabled and user has no pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      const oidcUser = {
        ...fakeUser,
        id: "user-oidc",
        email: "random@external.com",
        image: "https://provider.com/avatar.jpg",
      };
      mockGetByEmailAndStatus.mockResolvedValue(undefined);

      const result = await hooks.user.create.before(oidcUser, {});
      expect(result).toBe(false);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "random@external.com",
        "invited",
      );
    });

    it("allows sign-up when disabled, invitation exists, and domain is allowed", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      process.env.BETTER_AUTH_ALLOWED_DOMAINS = "example.com";
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-1",
        email: "test@example.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);

      delete process.env.BETTER_AUTH_ALLOWED_DOMAINS;
    });
  });
});
