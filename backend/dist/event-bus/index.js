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
    constructor() {
        this.publisher = new Redis(config.redis.url, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 200, 5000);
                return delay;
            },
            lazyConnect: true,
        });
        this.subscriber = new Redis(config.redis.url, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 200, 5000);
                return delay;
            },
            lazyConnect: true,
        });
        this.handlers = new Map();
        this.isConnected = false;
    }
    async connect() {
        if (this.isConnected)
            return;
        await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
        this.subscriber.on("message", (channel, message) => {
            const channelHandlers = this.handlers.get(channel);
            if (!channelHandlers)
                return;
            const data = deserializePayload(message);
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
        });
        this.isConnected = true;
        console.log("[EventBus] Connected to Redis pub/sub");
    }
    async publish(channel, data) {
        if (!this.isConnected) {
            throw new Error("[EventBus] Not connected. Call connect() first.");
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
            await this.subscriber.subscribe(channel);
        }
        console.log(`[EventBus] Subscribed to ${channel}`);
    }
    async unsubscribe(channel) {
        this.handlers.delete(channel);
        await this.subscriber.unsubscribe(channel);
        console.log(`[EventBus] Unsubscribed from ${channel}`);
    }
    async disconnect() {
        if (!this.isConnected)
            return;
        this.handlers.clear();
        await this.subscriber.quit();
        await this.publisher.quit();
        this.isConnected = false;
        console.log("[EventBus] Disconnected");
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