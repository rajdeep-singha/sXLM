import { PrismaClient } from "@prisma/client";
export declare class EventListenerService {
    private prisma;
    constructor(prisma: PrismaClient);
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    private pollContractEvents;
    /**
     * Decode a base64-encoded XDR ScVal string into a native JS value.
     */
    private decodeXdrValue;
    /**
     * Decode a topic entry (base64 XDR ScSymbol → string).
     */
    private decodeTopicEntry;
    private processEvent;
}
//# sourceMappingURL=index.d.ts.map