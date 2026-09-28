import {type FC} from 'react';
import { useMqtt } from '../../context/useMqtt';
import { useChat } from '../../context/useChat';
import { Button } from '../ui/button';
import { Wifi, WifiOff, Settings } from 'lucide-react';

type Props =  {
    onToggleSettings: () => void;
    showSettings: boolean;
}

export const Header: FC<Props> = ({ onToggleSettings, showSettings }) => {
    const { status, brokerConfig, connect, disconnect } = useMqtt();
    const { outbox } = useChat();

    return (
        <header className="flex flex-wrap items-center justify-between gap-4 p-4 border-b bg-card text-card-foreground shadow-xs">
            <div className="flex items-center gap-3">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">MQTT Chat</h1>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {brokerConfig.host}:{brokerConfig.port}{brokerConfig.path}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {/* Connect / Disconnect button */}
                {status === 'connected' ? (
                    <Button variant="outline" size="sm" onClick={disconnect} className="gap-1.5 text-xs">
                        <WifiOff className="h-3.5 w-3.5 text-destructive" />
                        Odpojit
                    </Button>
                ) : (
                    <Button
                        variant="default"
                        size="sm"
                        onClick={connect}
                        disabled={status === 'connecting'}
                        className="gap-1.5 text-xs"
                    >
                        <Wifi className="h-3.5 w-3.5" />
                        Připojit
                    </Button>
                )}

                {/* Settings Toggle Button */}
                <Button
                    variant={showSettings ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={onToggleSettings}
                    title="Nastavení připojení a identity"
                    className="gap-1.5 text-xs"
                >
                    <Settings className="h-3.5 w-3.5" />
                    Nastavení
                </Button>
            </div>

            {/* Offline Outbox banner if pending messages exist */}
            {outbox.length > 0 && (
                <div className="w-full mt-1 flex items-center justify-between gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 rounded-lg text-xs">
                    <span>
                        <strong>Odpojený režim:</strong> Ve frontě čeká <strong>{outbox.length}</strong> {outbox.length === 1 ? 'zpráva' : outbox.length < 5 ? 'zprávy' : 'zpráv'} k odeslání po obnovení spojení.
                    </span>
                    {status === 'connected' && (
                        <span className="font-semibold text-emerald-600 animate-pulse">Odesílám...</span>
                    )}
                </div>
            )}
        </header>
    );
};
