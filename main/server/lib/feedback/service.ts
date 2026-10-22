/**
 * Bug reports and requests sent by end users from an RP's page.
 *
 * Reports arrive over the `cors:` layer, so the IdP knows who sent one (the
 * DPoP-bound user) and from which RP (the browser-set `Origin`) — neither is
 * taken from the request body. Each is stored, then announced to the IdP's
 * owners by Web Push. There is no page to browse them: they are read straight
 * out of D1 (see README).
 *
 * @module
 */

import type { KvRepo } from "@kbn/kv/types.ts";

export const FEEDBACK_KINDS = ["bug", "request", "other"] as const;
export type FeedbackKind = typeof FEEDBACK_KINDS[number];

export interface StoredFeedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  /** The signed-in user who sent it, from the DPoP session. */
  userId: string;
  /** The RP page's origin, from the browser-set `Origin` header. */
  origin?: string;
  /** The page the user was on, as the RP reported it. Informational only. */
  pageUrl?: string;
  createdAt: number;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  userId: string;
  origin?: string;
  pageUrl?: string;
}

export type SubmitResult =
  | { ok: true; feedback: StoredFeedback }
  | { ok: false; reason: "rate_limited" };

export interface FeedbackDeps {
  repo: KvRepo<StoredFeedback>;
  /** Counts a submission against the sender; false once they are over. */
  limiter: { tryAcquire(key: string): Promise<boolean> };
  /** Tells the owners. Its failures are logged, never surfaced to the sender. */
  notify: (feedback: StoredFeedback) => Promise<void>;
  now?: () => number;
}

export class FeedbackService {
  constructor(private readonly deps: FeedbackDeps) {}

  async submit(input: FeedbackInput): Promise<SubmitResult> {
    // Any signed-in user of any whitelisted RP can call this, so it is
    // bounded per user before anything is written.
    if (!await this.deps.limiter.tryAcquire(input.userId)) {
      return { ok: false, reason: "rate_limited" };
    }

    const id = this.deps.repo.genKey();
    const feedback: StoredFeedback = {
      id,
      kind: input.kind,
      message: input.message,
      userId: input.userId,
      createdAt: (this.deps.now ?? Date.now)(),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
    };
    const stored = await this.deps.repo.entry(id).update(() => feedback);
    // A fresh monotonic ULID cannot collide, so a lost write means storage
    // itself failed; the sender should hear about that, unlike a failed push.
    if (!stored.ok) throw new Error("Failed to store feedback");

    try {
      await this.deps.notify(feedback);
    } catch (error) {
      // The report is safe in storage; a push service hiccup must not turn
      // a successful submission into an error the user retries.
      console.error("feedback stored but owner notification failed", error);
    }
    return { ok: true, feedback };
  }
}

export interface OwnerSubscription {
  id: string;
  origin?: string;
}

export interface OwnerNotifierOptions {
  ownerIds: readonly string[];
  /** Whether a subscription was registered on the IdP itself. */
  isIdpSubscription: (origin: string | undefined) => boolean;
  listSubscriptions: (userId: string) => Promise<OwnerSubscription[]>;
  send: (
    userId: string,
    subscriptionId: string,
    feedback: StoredFeedback,
  ) => Promise<unknown>;
}

/**
 * Push the report to each owner's devices — but only the subscriptions they
 * registered on the IdP itself. An owner is also a user of RPs, and a
 * subscription registered on an RP's page is shown by that RP's service
 * worker: a report about some other RP would arrive under its name.
 */
export const ownerNotifier = (
  opts: OwnerNotifierOptions,
): (feedback: StoredFeedback) => Promise<void> =>
async (feedback) => {
  for (const ownerId of opts.ownerIds) {
    const subscriptions = (await opts.listSubscriptions(ownerId))
      .filter((s) => opts.isIdpSubscription(s.origin));
    // One dead device must not keep the others from hearing about it.
    await Promise.allSettled(
      subscriptions.map((s) => opts.send(ownerId, s.id, feedback)),
    );
  }
};

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "バグ報告",
  request: "要望",
  other: "その他",
};

/** The notification an owner sees. The full text stays in storage. */
export const notificationFor = (feedback: StoredFeedback) => {
  const from = hostOf(feedback.origin) ?? "IdP";
  const excerpt = feedback.message.length > 120
    ? feedback.message.slice(0, 120) + "…"
    : feedback.message;
  return {
    title: `フィードバック: ${KIND_LABEL[feedback.kind]}`,
    body: `${from} — ${excerpt}`,
  };
};

const hostOf = (origin: string | undefined): string | undefined => {
  if (!origin) return undefined;
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
};
