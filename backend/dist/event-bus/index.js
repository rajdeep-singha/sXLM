import { Redis } from "ioredis";
import { config } from "../config/index.js";
export var EventType;
(function (EventType) {
    EventType["STAKE_EXECUTED"] = "stake:executed";
    EventType["UNSTAKE_EXECUTED"] = "unstake:executed";
    EventType["VALIDATOR_DOWN"] = "validator:down";
    EventType["REWARD_UPDATED"] = "reward:updated";
    EventType["WITHDRAWAL_READY"] = "withdrawal:ready";
    EventType["REBALANCE_REQUIRED"] = "rebalance:required";
    EventType["SLASHING_APPLIED"] = "slashing:applied";
})(EventType || (EventType = {}));
function serializePayload(data) {
    return JSON.stringify(data, (_, value) => typeof value === "bigint" ? value.toString() : value);
}
function deserializePayload(raw) {
    return JSON.parse(raw);
}
export class EventBus {
    publisher;
    subscriber;
    handlers;
    isConnected;
    useRedis;
    constructor() {
        this.useRedis = config.redis.url.length > 0;
        this.publisher = this.useRedis
            ? new Redis(config.redis.url, {
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    const delay = Math.min(times * 200, 5000);
                    return delay;
                },
                lazyConnect: true,
            })
            : null;
        this.subscriber = this.useRedis
            ? new Redis(config.redis.url, {
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    const delay = Math.min(times * 200, 5000);
                    return delay;
                },
                lazyConnect: true,
            })
            : null;
        this.handlers = new Map();
        this.isConnected = false;
    }
    async connect() {
        if (this.isConnected)
            return;
        if (!this.useRedis) {
            this.isConnected = true;
            console.log("[EventBus] Using in-memory pub/sub");
            return;
        }
        if (!this.publisher || !this.subscriber) {
            throw new Error("[EventBus] Redis clients were not initialized.");
        }
        await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
        this.subscriber.on("message", (channel, message) => {
            const channelHandlers = this.handlers.get(channel);
            if (!channelHandlers)
                return;
            const data = deserializePayload(message);
            this.dispatch(channel, data);
        });
        this.isConnected = true;
        console.log("[EventBus] Connected to Redis pub/sub");
    }
    async publish(channel, data) {
        if (!this.isConnected) {
            throw new Error("[EventBus] Not connected. Call connect() first.");
        }
        if (!this.useRedis) {
            this.dispatch(channel, data);
            return this.handlers.get(channel)?.length ?? 0;
        }
        if (!this.publisher) {
            throw new Error("[EventBus] Redis publisher was not initialized.");
        }
        const serialized = serializePayload(data);
        const receivers = await this.publisher.publish(channel, serialized);
        console.log(`[EventBus] Published to ${channel} (${receivers} receivers)`);
        return receivers;
    }
    async subscribe(channel, callback) {
        if (!this.isConnected) {
            throw new Error("[EventBus] Not connected. Call connect() first.");
        }
        const existing = this.handlers.get(channel);
        if (existing) {
            existing.push(callback);
        }
        else {
            this.handlers.set(channel, [callback]);
            if (this.useRedis) {
                if (!this.subscriber) {
                    throw new Error("[EventBus] Redis subscriber was not initialized.");
                }
                await this.subscriber.subscribe(channel);
            }
        }
        console.log(`[EventBus] Subscribed to ${channel}`);
    }
    async unsubscribe(channel) {
        this.handlers.delete(channel);
        if (this.useRedis) {
            if (!this.subscriber) {
                throw new Error("[EventBus] Redis subscriber was not initialized.");
            }
            await this.subscriber.unsubscribe(channel);
        }
        console.log(`[EventBus] Unsubscribed from ${channel}`);
    }
    async disconnect() {
        if (!this.isConnected)
            return;
        this.handlers.clear();
        if (this.useRedis) {
            if (!this.subscriber || !this.publisher) {
                throw new Error("[EventBus] Redis clients were not initialized.");
            }
            await this.subscriber.quit();
            await this.publisher.quit();
        }
        this.isConnected = false;
        console.log("[EventBus] Disconnected");
    }
    dispatch(channel, data) {
        const channelHandlers = this.handlers.get(channel);
        if (!channelHandlers)
            return;
        for (const handler of channelHandlers) {
            try {
                const result = handler(data);
                if (result instanceof Promise) {
                    result.catch((err) => console.error(`[EventBus] Handler error on ${channel}:`, err));
                }
            }
            catch (err) {
                console.error(`[EventBus] Sync handler error on ${channel}:`, err);
            }
        }
    }
}
let eventBusInstance = null;
export function getEventBus() {
    if (!eventBusInstance) {
        eventBusInstance = new EventBus();
    }
    return eventBusInstance;
}
export async function initEventBus() {
    const bus = getEventBus();
    await bus.connect();
}
export async function shutdownEventBus() {
    if (eventBusInstance) {
        await eventBusInstance.disconnect();
        eventBusInstance = null;
    }
}
//# sourceMappingURL=index.js.map