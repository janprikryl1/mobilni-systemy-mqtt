import {createContext, useEffect, useRef, useState, useCallback, type ReactNode, type FC} from 'react';
import Paho from 'paho-mqtt';
import type { ConnectionStatus, BrokerConfig, UserPresence } from '../types/chat';
import { DEFAULT_BROKER_CONFIG, DEFAULT_LOGIN, TOPICS } from '../constants/mqtt';
import { storageService } from '../services/storageService';
import { parseTopic } from '../services/messageParser';

export type MqttContextType = {
    status: ConnectionStatus;
    username: string;
    brokerConfig: BrokerConfig;
    usersPresence: Record<string, UserPresence>;
    lastError: string | null;
    connect: () => void;
    disconnect: () => void;
    setUsername: (name: string) => void;
    setBrokerConfig: (config: BrokerConfig) => void;
    publishMessage: (topic: string, payload: string, retained?: boolean) => boolean;
    registerMessageListener: (listener: (topic: string, payload: string) => void) => () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const MqttContext = createContext<MqttContextType | null>(null);

export const MqttProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const clientRef = useRef<Paho.Client | null>(null);
    const messageListenersRef = useRef<Set<(topic: string, payload: string) => void>>(new Set());

    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [lastError, setLastError] = useState<string | null>(null);
    const [username, setUsernameState] = useState<string>(() => storageService.getUsername(DEFAULT_LOGIN));
    const [brokerConfig, setBrokerConfigState] = useState<BrokerConfig>(() =>
        storageService.getBrokerConfig(DEFAULT_BROKER_CONFIG)
    );
    const [usersPresence, setUsersPresence] = useState<Record<string, UserPresence>>({});

    const setUsername = useCallback((newName: string) => {
        const trimmed = newName.trim();
        setUsernameState(trimmed);
        storageService.saveUsername(trimmed);
    }, []);

    const setBrokerConfig = useCallback((newConfig: BrokerConfig) => {
        setBrokerConfigState(newConfig);
        storageService.saveBrokerConfig(newConfig);
    }, []);

    const registerMessageListener = useCallback((listener: (topic: string, payload: string) => void) => {
        messageListenersRef.current.add(listener);
        return () => {
            messageListenersRef.current.delete(listener);
        };
    }, []);

    const publishMessage = useCallback((topic: string, payload: string, retained = false): boolean => {
        const client = clientRef.current;
        if (!client || !client.isConnected()) {
            return false;
        }
        try {
            const pahoMsg = new Paho.Message(payload);
            pahoMsg.destinationName = topic;
            pahoMsg.retained = retained;
            pahoMsg.qos = 1;
            client.send(pahoMsg);
            return true;
        } catch (err) {
            console.error('[MQTT] Publish failed:', err);
            return false;
        }
    }, []);

    const disconnect = useCallback(() => {
        const client = clientRef.current;
        if (client && client.isConnected()) {
            // Send retained 'offline' status before disconnecting cleanly
            const currentName = username || 'guest';
            try {
                const statusMsg = new Paho.Message('offline');
                statusMsg.destinationName = TOPICS.statusUser(currentName);
                statusMsg.retained = true;
                client.send(statusMsg);
            } catch (e) {
                console.error('[MQTT] Failed to send offline status on disconnect:', e);
            }
            client.disconnect();
        }
        setStatus('disconnected');
    }, [username]);

    const connect = useCallback(() => {
        if (clientRef.current?.isConnected()) {
            return;
        }

        setStatus('connecting');
        setLastError(null);

        const currentName = username.trim() || 'guest';
        const clientId = currentName;

        const client = new Paho.Client(
            brokerConfig.host,
            brokerConfig.port,
            brokerConfig.path,
            clientId
        );

        client.onConnectionLost = (responseObject) => {
            console.warn('[MQTT] Connection lost:', responseObject.errorMessage);
            setStatus('disconnected');
            if (responseObject.errorCode !== 0) {
                setLastError(responseObject.errorMessage);
            }
        };

        client.onMessageArrived = (message: Paho.Message) => {
            const topic = message.destinationName;
            const payload = message.payloadString;

            // Handle presence status messages (/mschat/status/<user>)
            const topicInfo = parseTopic(topic);
            if (topicInfo.isStatus && topicInfo.sender) {
                const rawStatus = payload.trim().toLowerCase();
                const userStatus = rawStatus.includes('offline') ? 'offline' : 'online';
                setUsersPresence((prev) => ({
                    ...prev,
                    [topicInfo.sender]: {
                        username: topicInfo.sender,
                        status: userStatus,
                        lastSeen: Date.now(),
                    },
                }));
            }

            // Notify all registered chat listeners
            messageListenersRef.current.forEach((listener) => {
                try {
                    listener(topic, payload);
                } catch (err) {
                    console.error('[MQTT] Listener error:', err);
                }
            });
        };

        clientRef.current = client;

        // Configure LWT (Last Will and Testament)
        const willMsg = new Paho.Message('offline');
        willMsg.destinationName = TOPICS.statusUser(currentName);
        willMsg.retained = true;
        willMsg.qos = 1;

        const connectOptions: Paho.ConnectionOptions = {
            cleanSession: false,
            useSSL: brokerConfig.useSsl ?? false,
            timeout: 10,
            keepAliveInterval: 30,
            willMessage: willMsg,
            onSuccess: () => {
                console.log(`[MQTT] Connected to ${brokerConfig.host}:${brokerConfig.port}${brokerConfig.path}`);
                setStatus('connected');
                setLastError(null);

                // Publish retained 'online' status
                const onlineMsg = new Paho.Message('online');
                onlineMsg.destinationName = TOPICS.statusUser(currentName);
                onlineMsg.retained = true;
                client.send(onlineMsg);

                // Subscribe to public chat
                client.subscribe(TOPICS.PUBLIC_ALL);

                // Subscribe to status updates
                client.subscribe(TOPICS.STATUS_ALL);

                // Subscribe to personal private messages
                client.subscribe(TOPICS.privateSubUser(currentName));
            },
            onFailure: (err) => {
                console.error('[MQTT] Connection failed:', err.errorMessage);
                setStatus('disconnected');
                setLastError(err.errorMessage);
            },
        };

        if (brokerConfig.username) {
            connectOptions.userName = brokerConfig.username;
            connectOptions.password = brokerConfig.password || '';
        }

        client.connect(connectOptions);
    }, [brokerConfig, username]);

    // Auto-connect on startup or credentials change
    useEffect(() => {
        connect();
        return () => {
            if (clientRef.current?.isConnected()) {
                clientRef.current.disconnect();
            }
        };
    }, [connect]);

    return (
        <MqttContext.Provider
            value={{
                status,
                username,
                brokerConfig,
                usersPresence,
                lastError,
                connect,
                disconnect,
                setUsername,
                setBrokerConfig,
                publishMessage,
                registerMessageListener,
            }}
        >
            {children}
        </MqttContext.Provider>
    );
};
