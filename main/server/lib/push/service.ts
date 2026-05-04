import { fromArrayBuffer } from "@hexagon/base64";
import { pushContact } from "../../config.ts";
import {
  ApplicationServer,
  PushMessageError,
  type PushSubscription as WebPushSubscription,
  Urgency,
} from "@negrel/webpush";
import type { PushSubscriptionPayload } from "./schemas.ts";
import {
  pushSubscriptionRepo,
  pushUserIndexRepoForUser,
} from "../../repositories.ts";
import { getSigningKey } from "../signing-key.ts";

const encoder = new TextEncoder();

export interface UserIndexValue {
  id: string;
}

const hashSubscriptionEndpoint = async (endpoint: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(endpoint),
  );
  return fromArrayBuffer(digest, true);
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
  keys: WebPushSubscription["keys"];
  createdAt: number;
  updatedAt: number;
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
    private readonly subscriptionRepo: typeof pushSubscriptionRepo,
    private readonly userIndexRepoForUser: typeof pushUserIndexRepoForUser,
    private readonly applicationServer: ApplicationServer,
    private readonly vapidPublicKey: string,
  ) {}

  static async create(): Promise<PushService> {
    const { keyPair, publicKey } = await getSigningKey();
    const applicationServer = await ApplicationServer.new({
      contactInformation: pushContact,
      vapidKeys: keyPair,
    });
    return new PushService(
      pushSubscriptionRepo,
      pushUserIndexRepoForUser,
      applicationServer,
      publicKey,
    );
  }

  getPublicKey(): string {
    return this.vapidPublicKey;
  }

  async upsertSubscription(
    userId: string,
    subscription: PushSubscriptionPayload,
    metadata: PushSubscriptionMetadata = {},
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

        if (info.reason === "VapidPkHashMismatch") {
          const updated = await this.recordSendError(
            subscriptionRecord,
            info.message,
          );
          subscriptionRecord = updated;
          warnings.push(
            "VAPID キーが変更されたため通知登録を削除しました。もう一度通知を有効化してください。",
          );
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
      urgency: Urgency.Low,
    });
  }
}

export const pushService = await PushService.create();
