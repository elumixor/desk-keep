import { z } from "zod";
import { authed } from "~/lib/http/authed";
import { pressButton } from "~/lib/scripts/run";

/**
 * Presses one of the page's buttons: its script (or `code`, the editor's unsaved one) runs as the caller, with
 * `answers` to its questions so far, and what it said, opened, threw or asks is answered.
 */
export default authed(
  {
    body: {
      property: z.string().min(1).max(200),
      code: z.string().max(50_000).optional(),
      answers: z.array(z.string().max(2000)).max(50).optional(),
    },
  },
  ({ caller, router, body: { property, ...rest } }) => pressButton(caller, router.id, property, rest),
);
