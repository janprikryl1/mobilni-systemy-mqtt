import { STORAGE_KEYS } from '../constants/mqtt';
import type { ChatMessage, BrokerConfig } from '../types/chat';

export const storageService = {
    getMessages: (): ChatMessage[] => {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.MESSAGES);
            return data ? JSON.parse(data) : [];
        } catch (err) {
            console.error('[Storage] Error loading cached messages:', err);
            return [];
        }
    },

    saveMessages: (messages: ChatMessage[]): void => {
        try {
            localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
        } catch (err) {
            console.error('[Storage] Error saving messages:', err);
        }
    },

    getOutbox: (): ChatMessage[] => {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.OUTBOX);
            return data ? JSON.parse(data) : [];
        } catch (err) {
            console.error('[Storage] Error loading outbox:', err);
            return [];
        }
    },

    saveOutbox: (outbox: ChatMessage[]): void => {
        try {
            localStorage.setItem(STORAGE_KEYS.OUTBOX, JSON.stringify(outbox));
        } catch (err) {
            console.error('[Storage] Error saving outbox:', err);
        }
    },

    getUsername: (defaultLogin: string): string => {
        return localStorage.getItem(STORAGE_KEYS.USERNAME) || defaultLogin;
    },

    saveUsername: (username: string): void => {
        localStorage.setItem(STORAGE_KEYS.USERNAME, username);
    },

    getBrokerConfig: (defaultConfig: BrokerConfig): BrokerConfig => {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.BROKER_CONFIG);
            return data ? { ...defaultConfig, ...JSON.parse(data) } : defaultConfig;
        } catch {
            return defaultConfig;
        }
    },

    saveBrokerConfig: (config: BrokerConfig): void => {
        try {
            localStorage.setItem(STORAGE_KEYS.BROKER_CONFIG, JSON.stringify(config));
        } catch (err) {
            console.error('[Storage] Error saving broker config:', err);
        }
    },

    clearHistory: (): void => {
        localStorage.removeItem(STORAGE_KEYS.MESSAGES);
        localStorage.removeItem(STORAGE_KEYS.OUTBOX);
    }
};
