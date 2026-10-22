import { type } from "arktype";

/** Long enough for a stack trace, short enough not to be a storage vector. */
export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_PAGE_URL_MAX = 2000;

export const feedbackBodySchema = type({
  kind: '"bug" | "request" | "other"',
  message: `0 < string <= ${FEEDBACK_MESSAGE_MAX}`,
  "pageUrl?": `0 < string <= ${FEEDBACK_PAGE_URL_MAX}`,
});

export type FeedbackBody = typeof feedbackBodySchema.infer;
