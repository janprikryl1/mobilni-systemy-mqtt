import type { ChatMessage } from '../types/chat';

export type ParsedTopicInfo = {
    isPublic: boolean;
    isPrivate: boolean;
    isStatus: boolean;
    sender: string;
    recipient?: string;
}

export const parseTopic = (topic: string): ParsedTopicInfo => {
    const parts = topic.split('/').filter(Boolean); // removes empty strings

    // Expected shapes:
    // ['mschat', 'all', sender] -> public
    // ['mschat', 'user', recipient, sender] -> private
    // ['mschat', 'status', user] -> status

    if (parts[0] === 'mschat') {
        if (parts[1] === 'all') {
            return {
                isPublic: true,
                isPrivate: false,
                isStatus: false,
                sender: parts[2] || 'Anonymous',
            };
        }
        if (parts[1] === 'user') {
            return {
                isPublic: false,
                isPrivate: true,
                isStatus: false,
                recipient: parts[2],
                sender: parts[3] || 'Anonymous',
            };
        }
        if (parts[1] === 'status') {
            return {
                isPublic: false,
                isPrivate: false,
                isStatus: true,
                sender: parts[2] || 'Unknown',
            };
        }
    }

    return {
        isPublic: true,
        isPrivate: false,
        isStatus: false,
        sender: 'Unknown',
    };
}

export const parseIncomingMessage = (topic: string, rawPayload: string): ChatMessage => {
    const topicInfo = parseTopic(topic);
    const fallbackId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Try parsing JSON payload
    try {
        const json = JSON.parse(rawPayload);
        if (typeof json === 'object' && json !== null) {
            let ts = Number(json.timestamp) || Date.now();
            if (ts < 100_000_000_000) { // POSIX in seconds -> convert to ms
                ts = ts * 1000;
            }

            return {
                id: String(json.id || fallbackId),
                sender: json.sender || topicInfo.sender,
                recipient: json.recipient || topicInfo.recipient,
                text: String(json.text ?? rawPayload),
                timestamp: ts,
                topic,
                status: 'delivered',
                isPrivate: topicInfo.isPrivate,
            };
        }
    } catch {
        // Not a JSON payload, proceed to text format parser
    }

    // 2. Try parsing course format: "<POSIX_TIMESTAMP> <TEXT>" or "<POSIX_TIMESTAMP>\n<TEXT>"
    const textMatch = rawPayload.match(/^(\d{10,13})[\s\n]+([\s\S]*)$/);
    if (textMatch) {
        let ts = Number(textMatch[1]);
        if (ts < 100_000_000_000) {
            ts = ts * 1000; // seconds to ms
        }
        return {
            id: fallbackId,
            sender: topicInfo.sender,
            recipient: topicInfo.recipient,
            text: textMatch[2].trim(),
            timestamp: ts,
            topic,
            status: 'delivered',
            isPrivate: topicInfo.isPrivate,
        };
    }

    // 3. Fallback to raw payload string
    return {
        id: fallbackId,
        sender: topicInfo.sender,
        recipient: topicInfo.recipient,
        text: rawPayload,
        timestamp: Date.now(),
        topic,
        status: 'delivered',
        isPrivate: topicInfo.isPrivate,
    };
}

export const serializeOutgoingMessage = (msg: ChatMessage): string => {
    const posixSeconds = Math.floor(msg.timestamp / 1000);
    return `${posixSeconds}\n${msg.text}`;
}
