import type { BrokerConfig } from '../types/chat';

export const DEFAULT_BROKER_CONFIG: BrokerConfig = {
    host: import.meta.env.VITE_MQTT_HOST || 'pcfeib425t.vsb.cz',
    port: Number(import.meta.env.VITE_MQTT_PORT) || 9999,
    path: import.meta.env.VITE_MQTT_PATH ?? '/ws',
    username: import.meta.env.VITE_MQTT_USERNAME || 'mobilni',
    password: import.meta.env.VITE_MQTT_PASSWORD || 'Systemy',
    useSsl: false,
};

export const DEFAULT_LOGIN = 'pri0207';

export const TOPICS = {
    ALL_TREE: '/mschat/#',
    PUBLIC_ALL: '/mschat/all/#',
    STATUS_ALL: '/mschat/status/#',

    publicUser: (senderId: string) => `/mschat/all/${senderId}`,
    publicAnon: '/mschat/all/anon',
    statusUser: (userId: string) => `/mschat/status/${userId}`,
    privateSubUser: (recipientId: string) => `/mschat/user/${recipientId}/#`,
    privateSendUser: (recipientId: string, senderId: string) => `/mschat/user/${recipientId}/${senderId}`,
} as const;

export const STORAGE_KEYS = {
    MESSAGES: 'mschat_cached_messages',
    OUTBOX: 'mschat_offline_outbox',
    USERNAME: 'mschat_user_login',
    BROKER_CONFIG: 'mschat_broker_config',
} as const;
