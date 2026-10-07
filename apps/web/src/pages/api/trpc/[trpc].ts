import type { NextApiRequest, NextApiResponse } from "next";
import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter } from "@kan/api/root";
import { createTRPCContext } from "@kan/api/trpc-context";
import { withRateLimit } from "@kan/api/utils/rateLimit";

import { env } from "~/env";

const nextApiHandler = createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError:
    env.NODE_ENV === "development"
      ? ({ path, error }) => {
          console.error(
            `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
          );
        }
      : undefined,
});

export default withRateLimit(
  { points: 100, duration: 60 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // tRPC only applies its error status (401/403/400…) when statusCode is
    // still 200. OpenNext's response object starts without one, so set it,
    // or every tRPC error reaches the client as 200.
    res.statusCode = 200;
    const result = await nextApiHandler(req, res);
    return result;
  },
);
