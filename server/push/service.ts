import { fromArrayBuffer } from "@hexagon/base64";
import { pushContact } from "../config.ts";
import { Secret } from "../secret.ts";
import {
  ApplicationServer,
  exportApplicationServerKey,
  exportVapidKeys,
  generateVapidKeys,
  importVapidKeys,
  PushMessageError,
  type PushSubscription as WebPushSubscription,
  Urgency,
} from "@negrel/webpush";

const encoder = new TextEncoder();

const SUBSCRIPTION_KEY_PREFIX = ["push", "subscription"] as const;
const USER_INDEX_PREFIX = ["push", "user", "subscriptions"] as const;

const subscriptionKey = (
  id: string,
): Deno.KvKey => [...SUBSCRIPTION_KEY_PREFIX, id];

const userIndexKey = (
  userId: string,
  id: string,
): Deno.KvKey => [...USER_INDEX_PREFIX, userId, id];

const hashSubscriptionEndpoint = async (endpoint: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(endpoint),
  );
  return fromArrayBuffer(digest, true);
};

interface StoredVapidKeysRecord {
  keys: Awaited<ReturnType<typeof exportVapidKeys>>;
  createdAt: string;
  updatedAt: string;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
}

export interface PushSubscriptionMetadata {
  deviceName?: string;
  platform?: string | null;
  userAgent?: string;
  language?: string;
  timezone?: string;
  lastSuccessfulSendAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  lastUpdatedAt?: string;
}

export interface StoredPushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: WebPushSubscription["keys"];
  createdAt: string;
  updatedAt: string;
  metadata: PushSubscriptionMetadata;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
  urgency?: Urgency;
  ttl?: number;
  topic?: string;
}

export interface PushNotificationResult {
  subscription: StoredPushSubscription;
  removed?: boolean;
  warnings?: string[];
}

interface PushServiceErrorInfo {
  status: number;
  statusText: string;
  reason?: string;
  detail?: string;
  message: string;
}

export class PushService {
  private constructor(
    private readonly kv: Deno.Kv,
    private readonly applicationServer: ApplicationServer,
    private readonly vapidPublicKey: string,
  ) {}

  static async create(
    kv: Deno.Kv,
  ): Promise<PushService> {
    const vapidSecret = await Secret<StoredVapidKeysRecord>(
      "push_vapid_keys",
      async () => {
        const generated = await generateVapidKeys({ extractable: true });
        const exported = await exportVapidKeys(generated);
        const now = new Date().toISOString();
        return {
          keys: exported,
          createdAt: now,
          updatedAt: now,
        };
      },
    );

    const storedVapidKeys = await vapidSecret.get();
    const vapidKeys = await importVapidKeys(storedVapidKeys.keys);

    const applicationServer = await ApplicationServer.new({
      contactInformation: pushContact,
      vapidKeys,
    });
    const vapidPublicKey = await exportApplicationServerKey(vapidKeys);
    return new PushService(kv, applicationServer, vapidPublicKey);
  }

  getPublicKey(): string {
    return this.vapidPublicKey;
  }

  private validateSubscriptionPayload(
    payload: PushSubscriptionPayload,
  ): PushSubscriptionPayload {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid subscription payload");
    }
    if (!payload.endpoint || typeof payload.endpoint !== "string") {
      throw new Error("Subscription endpoint is required");
    }
    const endpoint = payload.endpoint.trim();
    if (!endpoint.startsWith("https://")) {
      throw new Error("Subscription endpoint must be an HTTPS URL");
    }
    const { keys } = payload;
    if (!keys || typeof keys !== "object") {
      throw new Error("Subscription keys are required");
    }
    if (typeof keys.auth !== "string" || typeof keys.p256dh !== "string") {
      throw new Error("Subscription keys are invalid");
    }
    return {
      endpoint,
      expirationTime: typeof payload.expirationTime === "number"
        ? payload.expirationTime
        : null,
      keys: {
        auth: keys.auth,
        p256dh: keys.p256dh,
      },
    };
  }

  async upsertSubscription(
    userId: string,
    subscription: PushSubscriptionPayload,
    metadata: PushSubscriptionMetadata = {},
  ): Promise<StoredPushSubscription> {
    const normalized = this.validateSubscriptionPayload(subscription);
    const id = await hashSubscriptionEndpoint(normalized.endpoint);
    const existingEntry = await this.kv.get<StoredPushSubscription>(
      subscriptionKey(id),
    );
    const now = new Date().toISOString();
    const previous = existingEntry.value;

    const record: StoredPushSubscription = {
      id,
      userId,
      endpoint: normalized.endpoint,
      expirationTime: normalized.expirationTime,
      keys: normalized.keys,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      metadata: {
        ...(previous?.metadata ?? {}),
        ...metadata,
        lastUpdatedAt: now,
      },
    };

    const tx = this.kv.atomic();
    if (existingEntry.versionstamp) {
      tx.check(existingEntry);
    } else {
      tx.check({ key: subscriptionKey(id), versionstamp: null });
    }
    tx.set(subscriptionKey(id), record);
    tx.set(userIndexKey(userId, id), { id });
    const result = await tx.commit();
    if (!result.ok) {
      throw new Error("Failed to save push subscription");
    }

    if (previous && previous.userId !== userId) {
      await this.kv.delete(userIndexKey(previous.userId, id));
    }

    return record;
  }

  async listSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
    const subscriptions: StoredPushSubscription[] = [];
    const prefix = userIndexKey(userId, "").slice(0, -1) as Deno.KvKey;

    for await (const entry of this.kv.list<{ id: string }>({ prefix })) {
      const id = entry.value?.id;
      if (!id) {
        continue;
      }
      const subscriptionEntry = await this.kv.get<StoredPushSubscription>(
        subscriptionKey(id),
      );
      const value = subscriptionEntry.value;
      if (!value) {
        await this.kv.delete(entry.key);
        continue;
      }
      if (value.userId !== userId) {
        await this.kv.delete(entry.key);
        continue;
      }
      subscriptions.push(value);
    }

    return subscriptions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async deleteSubscription(
    userId: string,
    id: string,
  ): Promise<boolean> {
    const existing = await this.kv.get<StoredPushSubscription>(
      subscriptionKey(id),
    );
    if (!existing.value || existing.value.userId !== userId) {
      return false;
    }
    const tx = this.kv.atomic()
      .check(existing)
      .delete(subscriptionKey(id))
      .delete(userIndexKey(userId, id));
    const result = await tx.commit();
    return result.ok;
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
    const existing = await this.kv.get<StoredPushSubscription>(
      subscriptionKey(id),
    );
    if (!existing.value || existing.value.userId !== userId) {
      throw new Error("Subscription not found");
    }
    const now = new Date().toISOString();
    const updated: StoredPushSubscription = {
      ...existing.value,
      updatedAt: now,
      metadata: {
        ...(existing.value.metadata ?? {}),
        ...metadata,
        lastUpdatedAt: now,
      },
    };
    const tx = this.kv.atomic()
      .check(existing)
      .set(subscriptionKey(id), updated);
    const result = await tx.commit();
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
    const now = new Date().toISOString();
    const updated: StoredPushSubscription = {
      ...subscription,
      metadata: {
        ...subscription.metadata,
        lastError: normalized,
        lastErrorAt: now,
      },
      updatedAt: now,
    };
    await this.kv.set(subscriptionKey(subscription.id), updated);
    return updated;
  }

  private async extractPushServiceError(
    error: PushMessageError,
  ): Promise<PushServiceErrorInfo> {
    const { response } = error;
    const status = response.status;
    const statusText = response.statusText;
    let reason: string | undefined;
    let detail: string | undefined;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = await response.clone().json();
        if (body && typeof body === "object") {
          const record = body as Record<string, unknown>;
          const maybeReason = record.reason;
          if (typeof maybeReason === "string" && maybeReason.trim()) {
            reason = maybeReason.trim();
          }
          const detailKeys = ["message", "detail", "error", "description"];
          for (const key of detailKeys) {
            const value = record[key];
            if (typeof value === "string" && value.trim()) {
              detail = value.trim();
              break;
            }
          }
        }
      } catch {
        // ignore JSON parse errors and fallback to text body
      }
    }

    if (!detail) {
      try {
        const text = await response.clone().text();
        if (text.trim()) {
          detail = text.trim();
        }
      } catch {
        // ignore body read errors
      }
    }

    const base = `Push service responded with ${status} ${statusText}` +
      (reason ? ` (${reason})` : "");
    const message = detail ? `${base}: ${detail}` : base;

    return {
      status,
      statusText,
      reason,
      detail,
      message,
    };
  }

  private async getSubscription(
    userId: string,
    id: string,
  ): Promise<StoredPushSubscription | null> {
    const entry = await this.kv.get<StoredPushSubscription>(
      subscriptionKey(id),
    );
    const value = entry.value;
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

    const subscriber = this.applicationServer.subscribe({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    });

    const messagePayload = {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      requireInteraction: payload.requireInteraction ?? false,
      data: {
        ...payload.data,
        url: payload.url,
        subscriptionId: id,
      },
      timestamp: new Date().toISOString(),
    };

    const warnings: string[] = [];
    let lastError: PushMessageError | null = null;
    let lastErrorInfo: PushServiceErrorInfo | null = null;
    let subscriptionRecord = subscription;
    let topicRejected = false;

    const topicsToTry = payload.topic !== undefined
      ? [payload.topic, undefined]
      : [undefined];

    for (const candidateTopic of topicsToTry) {
      try {
        await subscriber.pushTextMessage(JSON.stringify(messagePayload), {
          urgency: payload.urgency ?? Urgency.Normal,
          ttl: payload.ttl ?? 2419200,
          topic: candidateTopic,
        });
        if (topicRejected && candidateTopic === undefined) {
          warnings.push(
            "プッシュサービスに Topic ヘッダーを拒否されたため、省略して送信しました。",
          );
        }
        lastError = null;
        lastErrorInfo = null;
        break;
      } catch (error) {
        if (!(error instanceof PushMessageError)) {
          throw error;
        }

        const info = await this.extractPushServiceError(error);
        lastError = error;
        lastErrorInfo = info;

        if (error.isGone()) {
          const updated = await this.recordSendError(
            subscriptionRecord,
            info.message,
          );
          subscriptionRecord = updated;
          await this.deleteSubscription(userId, id);
          return {
            subscription: updated,
            removed: true,
            warnings,
          };
        }

        const canRetryWithoutTopic = payload.topic !== undefined &&
          candidateTopic !== undefined &&
          info.reason === "BadWebPushTopic";
        if (canRetryWithoutTopic) {
          topicRejected = true;
          continue;
        }

        break;
      }
    }

    if (lastError) {
      const message = lastErrorInfo?.message ?? lastError.toString();
      subscriptionRecord = await this.recordSendError(
        subscriptionRecord,
        message,
      );
      throw new Error(message);
    }

    const now = new Date().toISOString();
    const updatedSubscription: StoredPushSubscription = {
      ...subscriptionRecord,
      metadata: {
        ...subscriptionRecord.metadata,
        lastSuccessfulSendAt: now,
        lastError: undefined,
        lastErrorAt: undefined,
      },
      updatedAt: now,
    };
    await this.kv.set(subscriptionKey(id), updatedSubscription);
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
      urgency: Urgency.Low,
    });
  }
}
