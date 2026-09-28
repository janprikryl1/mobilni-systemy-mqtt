import {createContext, useEffect, useState, useCallback, useMemo, type ReactNode, type FC} from 'react';
import type { ChatMessage } from '../types/chat';
import { TOPICS } from '../constants/mqtt';
import { storageService } from '../services/storageService';
import { parseIncomingMessage, serializeOutgoingMessage, parseTopic } from '../services/messageParser';
import { useMqtt } from './useMqtt';

export type ChatContextType = {
    messages: ChatMessage[];
    filteredMessages: ChatMessage[];
    outbox: ChatMessage[];
    activeRecipient: string | null; // null = public chat (/mschat/all)
    setActiveRecipient: (recipient: string | null) => void;
    sendMessage: (text: string, customRecipient?: string | null) => void;
    clearHistory: () => void;
    flushOutbox: () => void;
    knownUsers: string[];
}

// eslint-disable-next-line react-refresh/only-export-components
export const ChatContext = createContext<ChatContextType | null>(null);

export const ChatProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const { status, username, publishMessage, registerMessageListener, usersPresence } = useMqtt();
    const [messages, setMessages] = useState<ChatMessage[]>(() => storageService.getMessages());
    const [outbox, setOutbox] = useState<ChatMessage[]>(() => storageService.getOutbox());
    const [activeRecipient, setActiveRecipient] = useState<string | null>(null);

    useEffect(() => {
        storageService.saveMessages(messages);
    }, [messages]);

    useEffect(() => {
        storageService.saveOutbox(outbox);
    }, [outbox]);

    // Extract all known users from presence, messages, and outbox
    const knownUsers = useMemo(() => {
        const usersSet = new Set<string>();

        // Include current user
        if (username) {
            usersSet.add(username);
        }

        // From presence
        Object.keys(usersPresence).forEach((u) => {
            if (u) usersSet.add(u);
        });

        // From messages
        messages.forEach((msg) => {
            if (msg.sender && msg.sender !== 'Anonymous') {
                usersSet.add(msg.sender);
            }
            if (msg.recipient) {
                usersSet.add(msg.recipient);
            }
        });

        return Array.from(usersSet).sort();
    }, [usersPresence, messages, username]);

    // Flush offline outbox messages
    const flushOutbox = useCallback(() => {
        if (status !== 'connected' || outbox.length === 0) return;

        console.log(`[Offline Cache] Flushing ${outbox.length} pending message(s)...`);

        const sentIds: string[] = [];

        outbox.forEach((msg) => {
            const payload = serializeOutgoingMessage(msg);
            const success = publishMessage(msg.topic, payload);
            if (success) {
                sentIds.push(msg.id);
            }
        });

        if (sentIds.length > 0) {
            setOutbox((prev) => prev.filter((msg) => !sentIds.includes(msg.id)));
            setMessages((prev) =>
                prev.map((msg) => (sentIds.includes(msg.id) ? { ...msg, status: 'sent' } : msg))
            );
        }
    }, [status, outbox, publishMessage]);

    // Automatically flush outbox when connection is established
    useEffect(() => {
        if (status === 'connected' && outbox.length > 0) {
            const timer = setTimeout(() => {
                flushOutbox();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [status, outbox.length, flushOutbox]);

    // Listen for incoming MQTT messages
    useEffect(() => {
        const unsubscribe = registerMessageListener((topic, payload) => {
            const topicInfo = parseTopic(topic);

            // Ignore status topic messages here as MqttContext already processes them
            if (topicInfo.isStatus) return;

            const newMsg = parseIncomingMessage(topic, payload);

            setMessages((prev) => {
                const existingIndex = prev.findIndex(
                    (m) =>
                        m.id === newMsg.id ||
                        (Math.floor(m.timestamp / 1000) === Math.floor(newMsg.timestamp / 1000) &&
                            m.sender === newMsg.sender &&
                            m.text === newMsg.text)
                );

                if (existingIndex >= 0) {
                    // Update status to delivered if already in list
                    const updated = [...prev];
                    updated[existingIndex] = { ...updated[existingIndex], status: 'delivered' };
                    return updated;
                }

                return [...prev, newMsg];
            });
        });

        return unsubscribe;
    }, [registerMessageListener]);

    // Send message (public or private)
    const sendMessage = useCallback(
        (text: string, customRecipient?: string | null) => {
            const targetRecipient = customRecipient !== undefined ? customRecipient : activeRecipient;
            const isPrivate = Boolean(targetRecipient);
            const currentSender = username || 'Anonymous';

            let topic: string;
            if (isPrivate && targetRecipient) {
                topic = TOPICS.privateSendUser(targetRecipient, currentSender);
            } else {
                topic = currentSender ? TOPICS.publicUser(currentSender) : TOPICS.publicAnon;
            }

            const newMsg: ChatMessage = {
                id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                sender: currentSender,
                recipient: targetRecipient || undefined,
                text: text.trim(),
                timestamp: Date.now(),
                topic,
                status: 'pending',
                isPrivate,
            };

            const payload = serializeOutgoingMessage(newMsg);

            if (status === 'connected') {
                const success = publishMessage(topic, payload);
                if (success) {
                    newMsg.status = 'sent';
                } else {
                    setOutbox((prev) => [...prev, newMsg]);
                }
            } else {
                console.log('[Offline Mode] Message added to offline outbox.');
                setOutbox((prev) => [...prev, newMsg]);
            }

            setMessages((prev) => [...prev, newMsg]);
        },
        [activeRecipient, username, status, publishMessage]
    );

    const clearHistory = useCallback(() => {
        if (window.confirm('Opravdu chcete vymazat historii zpráv a offline frontu z mezipaměti?')) {
            storageService.clearHistory();
            setMessages([]);
            setOutbox([]);
        }
    }, []);

    // Filter messages for current conversation tab (Public vs Private)
    const filteredMessages = useMemo(() => {
        if (!activeRecipient) {
            // Public chat: show messages where isPrivate is false
            return messages.filter((m) => !m.isPrivate);
        } else {
            // Private chat with activeRecipient: show messages exchanged between current user and activeRecipient
            return messages.filter(
                (m) =>
                    m.isPrivate &&
                    ((m.sender === activeRecipient && (!m.recipient || m.recipient === username)) ||
                        (m.sender === username && m.recipient === activeRecipient))
            );
        }
    }, [messages, activeRecipient, username]);

    return (
        <ChatContext.Provider
            value={{
                messages,
                filteredMessages,
                outbox,
                activeRecipient,
                setActiveRecipient,
                sendMessage,
                clearHistory,
                flushOutbox,
                knownUsers,
            }}
        >
            {children}
        </ChatContext.Provider>
    );
};
