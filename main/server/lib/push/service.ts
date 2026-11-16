import { pushContact } from "../../config.ts";
import {
  createPushSender,
  type PushSender,
  type PushSubscriptionData,
  type PushUrgency,
} from "@remix-kbn/web-push/server";
import type { PushSubscriptionPayload } from "./schemas.ts";
import {
  pushRateLimitRepo,
  pushSubscriptionRepo,
  pushUserIndexRepoForUser,
} from "../../repositories.ts";
import { getSigningKey } from "../signing-key.ts";
import { PushRateLimiter } from "./rate-limit.ts";

const encoder = new TextEncoder();

export interface UserIndexValue {
  id: string;
}

const hashSubscriptionEndpoint = async (endpoint: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(endpoint),
  );
  return new Uint8Array(digest).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
};

export interface PushSubscriptionMetadata {
  deviceName?: string;
  platform?: string | null;
  userAgent?: string;
  language?: string;
  timezone?: string;
  lastSuccessfulSendAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastUpdatedAt?: number;
}

export interface StoredPushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  expirationTime: number | null | undefined;
  keys: PushSubscriptionData["keys"];
  createdAt: number;
  updatedAt: number;
  metadata: PushSubscriptionMetadata;
  /** Origin the subscription was registered from (the RP frontend's `Origin`
   * header). Used to scope RP-server sends to their own domain. */
  origin?: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  /** Notification badge image (Web Notifications API `badge`). */
  badge?: string;
  /** App-icon badge count (App Badging API `setAppBadge`). `0` clears it. */
  badgeCount?: number;
  tag?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
  urgency?: PushUrgency;
  ttl?: number;
  topic?: string;
}

export interface PushNotificationResult {
  subscription: StoredPushSubscription;
  removed?: boolean;
  warnings?: string[];
  /** True when the send was skipped because the subscription's rate limit
   * for the current window was already reached. */
  throttled?: boolean;
}

export class PushService {
  private constructor(
    private readonly subscriptionRepo: typeof pushSubscriptionRepo,
    private readonly userIndexRepoForUser: typeof pushUserIndexRepoForUser,
    private readonly sender: PushSender,
    private readonly vapidPublicKey: string,
    private readonly rateLimiter: PushRateLimiter,
  ) {}

  static async create(): Promise<PushService> {
    const { keyPair, publicKey } = await getSigningKey();
    const sender = await createPushSender({
      vapidKeys: keyPair,
      contact: pushContact,
    });
    return new PushService(
      pushSubscriptionRepo,
      pushUserIndexRepoForUser,
      sender,
      publicKey,
      new PushRateLimiter(pushRateLimitRepo),
    );
  }

  getPublicKey(): string {
    return this.vapidPublicKey;
  }

  async upsertSubscription(
    userId: string,
    subscription: PushSubscriptionPayload,
    metadata: PushSubscriptionMetadata = {},
    origin?: string,
  ): Promise<StoredPushSubscription> {
    const id = await hashSubscriptionEndpoint(subscription.endpoint);
    const now = Date.now();

    let previousUserId: string | undefined;
    let record: StoredPushSubscription | undefined;
    const result = await this.subscriptionRepo.entry(id).update((current) => {
      previousUserId = current?.userId;
      record = {
        id,
        userId,
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: subscription.keys,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        metadata: {
          ...(current?.metadata ?? {}),
          ...metadata,
          lastUpdatedAt: now,
        },
        origin: origin ?? current?.origin,
      };
      return record;
    });
    if (!result.ok || !record) {
      throw new Error("Failed to save push subscription");
    }

    await this.userIndexRepoForUser(userId).entry(id).update(() => ({ id }));
    if (previousUserId && previousUserId !== userId) {
      await this.userIndexRepoForUser(previousUserId).entry(id).update(
        () => null,
      );
    }

    return record;
  }

  async listSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
    const subscriptions: StoredPushSubscription[] = [];
    const indexRepo = this.userIndexRepoForUser(userId);

    for await (const indexEntry of indexRepo) {
      const id = String(indexEntry.key);
      const value = await this.subscriptionRepo.entry(id).get();
      if (!value || value.userId !== userId) {
        await indexEntry.update(() => null);
        continue;
      }
      subscriptions.push(value);
    }

    return subscriptions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSubscription(
    userId: string,
    id: string,
  ): Promise<boolean> {
    const subEntry = this.subscriptionRepo.entry(id);
    const existing = await subEntry.get();
    if (!existing || existing.userId !== userId) {
      return false;
    }
    const result = await subEntry.update(() => null);
    if (!result.ok) {
      return false;
    }
    await this.userIndexRepoForUser(userId).entry(id).update(() => null);
    return true;
  }

  async updateSubscriptionMetadata(
    userId: string,
    id: string,
    metadata: PushSubscriptionMetadata,
  ): Promise<StoredPushSubscription> {
    if (!metadata || typeof metadata !== "object") {
      throw new Error("Metadata is required");
    }
    if (!Object.keys(metadata).length) {
      throw new Error("Metadata is required");
    }
    const subEntry = this.subscriptionRepo.entry(id);
    let updated: StoredPushSubscription | undefined;
    const result = await subEntry.update((current) => {
      if (!current || current.userId !== userId) {
        return current;
      }
      const now = Date.now();
      updated = {
        ...current,
        updatedAt: now,
        metadata: {
          ...(current.metadata ?? {}),
          ...metadata,
          lastUpdatedAt: now,
        },
      };
      return updated;
    });
    if (!updated) {
      throw new Error("Subscription not found");
    }
    if (!result.ok) {
      throw new Error("Failed to update subscription");
    }
    return updated;
  }

  private async recordSendError(
    subscription: StoredPushSubscription,
    message: string,
  ): Promise<StoredPushSubscription> {
    const normalized = message?.trim() || "Push service error";
    const now = Date.now();
    let updated: StoredPushSubscription = {
      ...subscription,
      metadata: {
        ...subscription.metadata,
        lastError: normalized,
        lastErrorAt: now,
      },
      updatedAt: now,
    };
    await this.subscriptionRepo.entry(subscription.id).update((current) => {
      const base = current ?? subscription;
      updated = {
        ...base,
        metadata: {
          ...base.metadata,
          lastError: normalized,
          lastErrorAt: now,
        },
        updatedAt: now,
      };
      return updated;
    });
    return updated;
  }

  private async getSubscription(
    userId: string,
    id: string,
  ): Promise<StoredPushSubscription | null> {
    const value = await this.subscriptionRepo.entry(id).get();
    if (!value || value.userId !== userId) {
      return null;
    }
    return value;
  }

  async sendNotification(
    userId: string,
    id: string,
    payload: PushNotificationPayload,
  ): Promise<PushNotificationResult> {
    const subscription = await this.getSubscription(userId, id);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    // Per-subscription flood guard: skip (don't fail) when this device has
    // already hit its limit for the current window.
    if (!(await this.rateLimiter.tryAcquire(id))) {
      return { subscription, throttled: true };
    }

    // Encryption, VAPID, reading the push service's answer and retrying without
    // a rejected Topic header are @remix-kbn/web-push's; recording the outcome
    // on the stored subscription, and the messages users see, are ours.
    const result = await this.sender.send(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        icon: payload.icon,
        badge: payload.badge,
        badgeCount: payload.badgeCount,
        tag: payload.tag,
        requireInteraction: payload.requireInteraction,
        data: { ...payload.data, subscriptionId: id },
      },
      {
        urgency: payload.urgency ?? "normal",
        ttl: payload.ttl ?? 2419200,
        topic: payload.topic,
      },
    );

    const warnings: string[] = [];
    if (result.topicDropped) {
      warnings.push(
        "プッシュサービスに Topic ヘッダーを拒否されたため、省略して送信しました。",
      );
    }
    let subscriptionRecord = subscription;

    if (!result.ok) {
      subscriptionRecord = await this.recordSendError(
        subscriptionRecord,
        result.error.message,
      );
      if (result.gone) {
        if (result.gone === "vapid-key-mismatch") {
          warnings.push(
            "VAPID キーが変更されたため通知登録を削除しました。もう一度通知を有効化してください。",
          );
        }
        await this.deleteSubscription(userId, id);
        return { subscription: subscriptionRecord, removed: true, warnings };
      }
      throw new Error(result.error.message);
    }

    const now = Date.now();
    let updatedSubscription: StoredPushSubscription = {
      ...subscriptionRecord,
      metadata: {
        ...subscriptionRecord.metadata,
        lastSuccessfulSendAt: now,
        lastError: undefined,
        lastErrorAt: undefined,
      },
      updatedAt: now,
    };
    await this.subscriptionRepo.entry(id).update((current) => {
      const base = current ?? subscriptionRecord;
      updatedSubscription = {
        ...base,
        metadata: {
          ...base.metadata,
          lastSuccessfulSendAt: now,
          lastError: undefined,
          lastErrorAt: undefined,
        },
        updatedAt: now,
      };
      return updatedSubscription;
    });
    return { subscription: updatedSubscription, warnings };
  }

  async sendTestNotification(
    userId: string,
    id: string,
  ): Promise<PushNotificationResult> {
    return await this.sendNotification(userId, id, {
      title: "kbn.one",
      body:
        "通知が届きました。スマートフォンでも受け取れることを確認できます。",
      url: "/me",
      tag: "push-test",
      urgency: "low",
    });
  }
}

let pushServicePromise: Promise<PushService> | undefined;

/**
 * The shared service, built on first use and reused after that.
 *
 * Deliberately not a module-scope `await`: building it reads the signing key,
 * and a Worker may not do I/O outside a request — deploying runs the
 * top-level scope to validate the Worker, and a read there fails it with
 * error 10021.
 */
export const getPushService = (): Promise<PushService> => {
  if (!pushServicePromise) pushServicePromise = PushService.create();
  return pushServicePromise;
};
