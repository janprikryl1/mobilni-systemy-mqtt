export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered';

export type ChatMessage = {
    id: string;
    sender: string;
    recipient?: string;
    text: string;
    timestamp: number;
    topic: string;
    status: MessageDeliveryStatus;
    isPrivate?: boolean;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

export type UserPresence = {
    username: string;
    status: 'online' | 'offline';
    lastSeen: number;
}

export type BrokerConfig = {
    host: string;
    port: number;
    path: string;
    username?: string;
    password?: string;
    useSsl?: boolean;
}
