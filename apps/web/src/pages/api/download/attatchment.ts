import type { NextApiRequest, NextApiResponse } from "next";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { withRateLimit } from "@kan/api/utils/rateLimit";

/**
 * Forces an attachment download. Attachment URLs point at the R2 file route
 * (/api/files/attachments/...), so this only adds `download=<filename>` and
 * redirects; the file route checks the signature.
 */
export default withRateLimit(
  { points: 100, duration: 60 },
  withApiLogging((req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const { url, filename } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "url parameter is required" });
    }

    let target: URL;
    try {
      target = new URL(url, "http://localhost");
    } catch {
      return res.status(400).json({ message: "Invalid URL" });
    }

    if (!target.pathname.startsWith("/api/files/attachments/")) {
      return res.status(403).json({ message: "URL not allowed" });
    }

    // On Workers the encoded `&` inside `url` arrives decoded, so the signed
    // URL's own parameters show up as top-level ones. Put them back.
    for (const param of ["exp", "sig", "method"]) {
      const value = req.query[param];
      if (typeof value === "string" && !target.searchParams.has(param)) {
        target.searchParams.set(param, value);
      }
    }

    target.searchParams.set(
      "download",
      typeof filename === "string" ? filename : "attachment",
    );

    return res.redirect(302, `${target.pathname}${target.search}`);
  }),
);
