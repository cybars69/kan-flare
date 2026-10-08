import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { authClient } from "@kan/auth/client";

import Button from "~/components/Button";
import { PageHead } from "~/components/PageHead";
import PatternedBackground from "~/components/PatternedBackground";

interface PublicClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
}

type ConsentResponse = { url?: string; redirect_uri?: string } | null;

const hostOf = (uri: string | undefined) => {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
};

/**
 * Shown when an app (an MCP client such as Claude, or any OAuth client) asks
 * to connect to kan-flare. Reached from the OAuth server with a signed query;
 * the oauthProviderClient fetch plugin sends that query with the decision.
 */
export default function ConsentView() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const scopes = (searchParams.get("scope") ?? "").split(" ").filter(Boolean);

  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const [client, setClient] = useState<PublicClient | null>(null);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    void authClient
      .$fetch<PublicClient>("/oauth2/public-client", {
        method: "GET",
        query: { client_id: clientId },
      })
      .then(({ data }) => setClient(data ?? { client_id: clientId }));
  }, [clientId]);

  const decide = async (accept: boolean) => {
    setPending(accept ? "allow" : "deny");
    setError(null);
    const { data, error: consentError } =
      await authClient.$fetch<ConsentResponse>("/oauth2/consent", {
        method: "POST",
        body: { accept },
      });
    const next = data?.url ?? data?.redirect_uri;
    if (consentError || !next) {
      setPending(null);
      setError(
        t`This request has expired or isn't valid. Start connecting again from the app.`,
      );
      return;
    }
    window.location.assign(next);
  };

  const appName =
    client?.client_name ?? hostOf(client?.client_uri) ?? t`An app`;
  const appHost = hostOf(client?.client_uri);
  const permissions = [
    t`Read and change your boards, lists, cards and comments, as you`,
    ...(scopes.some((s) => s === "profile" || s === "email")
      ? [t`See your name and email address`]
      : []),
    ...(scopes.includes("offline_access")
      ? [t`Stay connected until you disconnect it`]
      : []),
  ];

  return (
    <>
      <PageHead title={t`Connect an app | kan-flare`} />
      <main className="h-screen bg-light-100 pt-20 dark:bg-dark-50 sm:pt-0">
        <div className="justify-top flex h-full flex-col items-center px-4 sm:justify-center">
          <div className="z-10 flex w-full flex-col items-center">
            <Link href="/">
              <h1 className="mb-6 text-lg font-bold tracking-tight text-light-1000 dark:text-dark-1000">
                kan-flare
              </h1>
            </Link>
            <div className="w-full rounded-lg border border-light-500 bg-light-300 px-6 py-8 dark:border-dark-400 dark:bg-dark-200 sm:max-w-md lg:px-10">
              {!clientId ? (
                <p className="text-sm text-light-1000 dark:text-dark-1000">
                  {t`This request has expired or isn't valid. Start connecting again from the app.`}
                </p>
              ) : (
                <>
                  <div className="mb-6 flex items-center gap-3">
                    {client?.logo_uri ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={client.logo_uri}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-md object-contain"
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-light-500 text-lg font-semibold text-light-1000 dark:bg-dark-400 dark:text-dark-1000">
                        {appName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-light-1000 dark:text-dark-1000">
                        <Trans>{appName} wants to connect</Trans>
                      </h2>
                      {appHost && (
                        <p className="truncate text-xs text-light-900 dark:text-dark-900">
                          {appHost}
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="mb-2 text-sm text-light-1000 dark:text-dark-1000">
                    {session?.user.email ? (
                      <Trans>
                        It will be able to, as {session.user.email}:
                      </Trans>
                    ) : (
                      t`It will be able to:`
                    )}
                  </p>
                  <ul className="mb-6 list-disc space-y-1 pl-5 text-sm text-light-1000 dark:text-dark-1000">
                    {permissions.map((permission) => (
                      <li key={permission}>{permission}</li>
                    ))}
                  </ul>

                  {error && (
                    <p
                      role="alert"
                      className="mb-4 text-sm text-red-600 dark:text-red-400"
                    >
                      {error}
                    </p>
                  )}

                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      fullWidth
                      disabled={pending !== null || isSessionPending}
                      isLoading={pending === "deny"}
                      onClick={() => void decide(false)}
                    >
                      {t`Deny`}
                    </Button>
                    <Button
                      fullWidth
                      disabled={pending !== null || isSessionPending}
                      isLoading={pending === "allow"}
                      onClick={() => void decide(true)}
                    >
                      {t`Allow`}
                    </Button>
                  </div>

                  <p className="mt-6 text-xs text-light-900 dark:text-dark-900">
                    {t`Only allow apps you trust. You can disconnect it at any time under Settings → API → Connected apps.`}
                  </p>
                </>
              )}
            </div>
          </div>
          <PatternedBackground />
        </div>
      </main>
    </>
  );
}
