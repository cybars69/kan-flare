import Link from "next/link";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { formatDistanceToNowStrict } from "date-fns";
import { useEffect, useRef } from "react";
import { HiOutlineBell } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { RouterOutputs } from "@kan/api";

import type { PushStatus } from "~/hooks/usePushNotifications";
import { useLocalisation } from "~/hooks/useLocalisation";
import { useIsMobile } from "~/hooks/useMediaQuery";
import {
  setAppBadge,
  usePushNotifications,
} from "~/hooks/usePushNotifications";
import { api } from "~/utils/api";

type Notification = RouterOutputs["notification"]["list"]["items"][number];

const PAGE_SIZE = 20;
// The badge polls only while the tab is visible (React Query pauses
// intervals in the background) and refetches when the window regains focus.
const UNREAD_POLL_MS = 60_000;

interface NotificationBellProps {
  isCollapsed?: boolean;
  onCloseSideNav?: () => void;
}

export default function NotificationBell({
  isCollapsed = false,
  onCloseSideNav,
}: NotificationBellProps) {
  const { data: unread } = api.notification.unreadCount.useQuery(undefined, {
    refetchInterval: UNREAD_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const count = unread?.count ?? 0;
  const badge = count > 99 ? "99+" : String(count);

  // Mounted on every page, so this also registers the service worker and
  // re-syncs the device's push subscription.
  const push = usePushNotifications();

  // Keep the installed app's icon badge in step with the unread count.
  useEffect(() => {
    if (unread) setAppBadge(unread.count);
  }, [unread]);

  return (
    <Popover className="relative w-full">
      {({ open, close }) => (
        <>
          <PopoverButton
            className="flex w-full items-center rounded-md p-1.5 text-sm text-neutral-900 hover:bg-light-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-light-600 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000"
            title={isCollapsed ? t`Notifications` : undefined}
            aria-label={
              count > 0 ? t`Notifications (${badge} unread)` : t`Notifications`
            }
          >
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
              <HiOutlineBell size={18} />
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                  {badge}
                </span>
              )}
            </span>
            <span
              className={twMerge("mx-2 truncate", isCollapsed && "md:hidden")}
            >
              {t`Notifications`}
            </span>
          </PopoverButton>

          {open && (
            <PopoverPanel
              static
              className={twMerge(
                "absolute bottom-[40px] left-0 z-20 flex max-h-[min(30rem,70vh)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-light-600 bg-light-50 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-dark-600 dark:bg-dark-300",
              )}
            >
              <NotificationList
                onNavigate={() => {
                  close();
                  onCloseSideNav?.();
                }}
              />
              {push.ready && <PushFooter push={push} />}
            </PopoverPanel>
          )}
        </>
      )}
    </Popover>
  );
}

function NotificationList({ onNavigate }: { onNavigate: () => void }) {
  const utils = api.useUtils();
  const { dateLocale } = useLocalisation();
  const isMobile = useIsMobile();

  const query = api.notification.list.useInfiniteQuery(
    { limit: PAGE_SIZE },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      // Opening the panel shows the cached pages at once and refreshes them
      // in the background.
      staleTime: 0,
    },
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  // Optimistically mark notifications read in every cached page and the
  // badge, then reconcile with the server.
  const applyRead = (publicIds: string[] | "all") => {
    const now = new Date();
    let changed = 0;
    utils.notification.list.setInfiniteData({ limit: PAGE_SIZE }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => {
                if (
                  item.readAt ||
                  (publicIds !== "all" && !publicIds.includes(item.publicId))
                )
                  return item;
                changed++;
                return { ...item, readAt: now };
              }),
            })),
          }
        : data,
    );
    utils.notification.unreadCount.setData(undefined, (data) =>
      data
        ? { count: publicIds === "all" ? 0 : Math.max(0, data.count - changed) }
        : data,
    );
  };

  const reconcile = () => {
    void utils.notification.unreadCount.invalidate();
    void utils.notification.list.invalidate();
  };

  const markRead = api.notification.markRead.useMutation({
    onMutate: async ({ publicIds }) => {
      await utils.notification.unreadCount.cancel();
      applyRead(publicIds);
    },
    onError: reconcile,
    onSettled: () => void utils.notification.unreadCount.invalidate(),
  });
  const markAllRead = api.notification.markAllRead.useMutation({
    onMutate: async () => {
      await utils.notification.unreadCount.cancel();
      applyRead("all");
    },
    onError: reconcile,
    onSettled: () => void utils.notification.unreadCount.invalidate(),
  });

  // Load the next page when the end of the list scrolls into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root: scrollRef.current, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const hasUnread = items.some((item) => !item.readAt);

  return (
    <>
      <div className="flex items-center justify-between border-b border-light-300 px-3 py-2 dark:border-dark-400">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-dark-1000">
          {t`Notifications`}
        </h2>
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={!hasUnread}
          className="rounded px-2 py-1 text-xs text-light-900 hover:bg-light-200 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-dark-900 dark:hover:bg-dark-400"
        >
          {t`Mark all as read`}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {query.isPending ? (
          <ul aria-busy="true" className="p-1">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex gap-3 px-3 py-2.5">
                <div className="h-2 w-2 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-light-200 dark:bg-dark-400" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-light-200 dark:bg-dark-400" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-light-900 dark:text-dark-900">
            <p>{t`Couldn't load notifications.`}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded px-2 py-1 underline hover:bg-light-200 dark:hover:bg-dark-400"
            >
              {t`Try again`}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-light-900 dark:text-dark-900">
            <HiOutlineBell size={22} />
            <p>{t`You're all caught up.`}</p>
          </div>
        ) : (
          <ul className="p-1">
            {items.map((item) => (
              <NotificationItem
                key={item.publicId}
                item={item}
                time={formatDistanceToNowStrict(item.createdAt, {
                  addSuffix: true,
                  locale: dateLocale,
                })}
                prefetchOnHover={!isMobile}
                onOpen={() => {
                  if (!item.readAt)
                    markRead.mutate({ publicIds: [item.publicId] });
                  onNavigate();
                }}
              />
            ))}
            <li ref={sentinelRef} aria-hidden="true" />
            {isFetchingNextPage && (
              <li className="px-3 py-2 text-center text-xs text-light-900 dark:text-dark-900">
                {t`Loading…`}
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}

function describe(item: Notification): string {
  // Names can be empty strings, so fall through on any falsy value.
  const actor = [item.actorName, item.actorEmail].find(Boolean) ?? t`Someone`;
  const workspace = item.workspaceName ?? "";
  switch (item.type) {
    case "mention":
      return item.cardTitle
        ? t`${actor} mentioned you on ${item.cardTitle}`
        : t`${actor} mentioned you`;
    case "workspace.member.added":
      return t`You were added to ${workspace}`;
    case "workspace.member.removed":
      return t`You were removed from ${workspace}`;
    case "workspace.role.changed":
      return t`Your role in ${workspace} changed`;
  }
}

function NotificationItem({
  item,
  time,
  prefetchOnHover,
  onOpen,
}: {
  item: Notification;
  time: string;
  prefetchOnHover: boolean;
  onOpen: () => void;
}) {
  const unread = !item.readAt;
  const context = [item.boardName, item.workspaceName]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span
        aria-hidden="true"
        className={twMerge(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-blue-500" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={twMerge(
            "line-clamp-2 text-xs text-neutral-900 dark:text-dark-1000",
            unread && "font-medium",
          )}
        >
          {describe(item)}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-light-900 dark:text-dark-900">
          {context ? `${context} · ${time}` : time}
        </span>
      </span>
      {unread && <span className="sr-only">{t`Unread`}</span>}
    </>
  );

  const className =
    "flex w-full gap-3 rounded-[5px] px-3 py-2.5 text-left hover:bg-light-200 focus:outline-none focus-visible:bg-light-200 dark:hover:bg-dark-400 dark:focus-visible:bg-dark-400";

  return (
    <li>
      {item.cardPublicId ? (
        <Link
          href={`/cards/${item.cardPublicId}`}
          prefetch={prefetchOnHover ? undefined : false}
          onClick={onOpen}
          className={className}
        >
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={className}>
          {body}
        </button>
      )}
    </li>
  );
}

const PUSH_HINTS: Partial<Record<PushStatus, () => string>> = {
  "not-installed": () =>
    t`Install kan-flare as an app to get push notifications on this device.`,
  unsupported: () =>
    t`Install kan-flare as an app to get push notifications on this device.`,
  denied: () =>
    t`Notifications are blocked. Allow them for kan-flare in your device settings.`,
};

function PushFooter({
  push,
}: {
  push: ReturnType<typeof usePushNotifications>;
}) {
  const { status, busy, error } = push;
  if (status === "unconfigured") return null;

  const hint = PUSH_HINTS[status]?.();
  const on = status === "on";

  return (
    <div className="border-t border-light-300 px-3 py-2 text-xs text-light-900 dark:border-dark-400 dark:text-dark-900">
      {hint ? (
        <p>{hint}</p>
      ) : (
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-neutral-900 dark:text-dark-1000">
            {t`Push notifications on this device`}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={t`Push notifications on this device`}
            disabled={busy}
            onClick={() => void (on ? push.disable() : push.enable())}
            className={twMerge(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              on ? "bg-blue-500" : "bg-light-400 dark:bg-dark-500",
            )}
          >
            <span
              className={twMerge(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                on ? "translate-x-[18px]" : "translate-x-0.5",
              )}
            />
          </button>
        </label>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-500">
          {t`Couldn't turn on push notifications. Try again.`}
        </p>
      )}
    </div>
  );
}
