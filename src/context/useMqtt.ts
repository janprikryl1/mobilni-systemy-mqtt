import { useContext } from 'react';
import { MqttContext, type MqttContextType } from './MqttContext';

export const useMqtt = (): MqttContextType => {
    const context = useContext(MqttContext);
    if (!context) {
        throw new Error('useMqtt must be used within an MqttProvider');
    }
    return context;
};
