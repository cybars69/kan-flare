import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache yet: the app has no ISR pages. Add the R2 incremental
// cache here if that changes.
export default defineCloudflareConfig({});
