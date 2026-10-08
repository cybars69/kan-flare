import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useEffect, useState } from "react";

import Button from "~/components/Button";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

const hostOf = (uri: string | null) => {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
};

/**
 * Apps connected through kan-flare's OAuth sign-in (MCP clients such as
 * Claude, and other OAuth apps), with a way to disconnect each one.
 */
export default function ConnectedAppList() {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { dateLocale } = useLocalisation();
  const { data: apps, isLoading } = api.connectedApp.list.useQuery();
  // Disconnecting takes two clicks: the first arms the button.
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  const disconnect = api.connectedApp.disconnect.useMutation({
    onSuccess: async () => {
      setArmed(null);
      await utils.connectedApp.list.invalidate();
      showPopup({
        header: t`App disconnected`,
        message: t`It can no longer access your account.`,
        icon: "success",
      });
    },
    onError: () =>
      showPopup({
        header: t`Couldn't disconnect the app`,
        message: t`Please try again.`,
        icon: "error",
      }),
  });

  if (isLoading) {
    return (
      <div className="h-16 animate-pulse rounded-lg bg-light-200 dark:bg-dark-200" />
    );
  }

  if (!apps?.length) {
    return (
      <p className="text-sm text-neutral-500 dark:text-dark-900">
        {t`No apps are connected. When an app such as Claude asks to connect, you'll approve it here in kan-flare.`}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-light-600 overflow-hidden rounded-lg bg-light-50 shadow ring-1 ring-black ring-opacity-5 dark:divide-dark-600 dark:bg-dark-100">
      {apps.map((app) => {
        const host = hostOf(app.uri);
        const name = app.name ?? host ?? t`Unnamed app`;
        const isArmed = armed === app.clientId;
        return (
          <li
            key={app.clientId}
            className="flex items-center gap-3 px-4 py-3 sm:px-6"
          >
            {app.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={app.icon}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 rounded-md object-contain"
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-light-300 text-sm font-semibold text-light-1000 dark:bg-dark-300 dark:text-dark-1000">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-dark-1000">
                {name}
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-dark-900">
                {[
                  host,
                  app.connectedAt
                    ? t`Connected ${format(app.connectedAt, "d MMM yyyy", { locale: dateLocale })}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button
              variant={isArmed ? "danger" : "secondary"}
              isLoading={disconnect.isPending && isArmed}
              disabled={disconnect.isPending}
              onClick={() =>
                isArmed
                  ? disconnect.mutate({ clientId: app.clientId })
                  : setArmed(app.clientId)
              }
              aria-label={
                isArmed
                  ? t`Confirm disconnecting ${name}`
                  : t`Disconnect ${name}`
              }
            >
              {isArmed ? t`Confirm` : t`Disconnect`}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
