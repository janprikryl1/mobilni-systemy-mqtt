import {type FC, type FormEvent, useState} from 'react';
import { useMqtt } from '../../context/useMqtt';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { Check, ShieldAlert } from 'lucide-react';

export const ConnectionBar: FC = () => {
    const { username, setUsername, brokerConfig, setBrokerConfig, connect, disconnect, lastError } = useMqtt();
    const [localHost, setLocalHost] = useState(brokerConfig.host);
    const [localPort, setLocalPort] = useState(String(brokerConfig.port));
    const [localPath, setLocalPath] = useState(brokerConfig.path);
    const [localUsername, setLocalUsername] = useState(username);
    const [localMqttUser, setLocalMqttUser] = useState(brokerConfig.username || '');
    const [localMqttPass, setLocalMqttPass] = useState(brokerConfig.password || '');
    const [savedNotice, setSavedNotice] = useState(false);

    const handleSave = (e: FormEvent) => {
        e.preventDefault();
        setUsername(localUsername);
        setBrokerConfig({
            ...brokerConfig,
            host: localHost.trim(),
            port: Number(localPort) || 9999,
            path: localPath.trim(),
            username: localMqttUser.trim(),
            password: localMqttPass.trim(),
        });

        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2000);

        // Reconnect with new settings
        disconnect();
        setTimeout(() => connect(), 150);
    };

    return (
        <Card className="p-4 m-4 bg-card/60 backdrop-blur-sm border shadow-xs space-y-4">
            <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                    <div className="space-y-1.5 col-span-1 sm:col-span-2 md:col-span-2">
                        <Label htmlFor="cfg-host" className="text-xs font-semibold">Broker Host:</Label>
                        <Input
                            id="cfg-host"
                            value={localHost}
                            onChange={(e) => setLocalHost(e.target.value)}
                            placeholder="pcfeib425t.vsb.cz"
                            className="h-8 text-xs font-mono"
                        />
                    </div>

                    <div className="space-y-1.5 col-span-1 sm:col-span-1 md:col-span-1">
                        <Label htmlFor="cfg-port" className="text-xs font-semibold">Port:</Label>
                        <Input
                            id="cfg-port"
                            value={localPort}
                            onChange={(e) => setLocalPort(e.target.value)}
                            placeholder="9999"
                            className="h-8 text-xs font-mono"
                        />
                    </div>

                    <div className="space-y-1.5 col-span-1 sm:col-span-1 md:col-span-1">
                        <Label htmlFor="cfg-path" className="text-xs font-semibold">WS Path:</Label>
                        <Input
                            id="cfg-path"
                            value={localPath}
                            onChange={(e) => setLocalPath(e.target.value)}
                            placeholder="/ws"
                            className="h-8 text-xs font-mono"
                        />
                    </div>

                    <div className="space-y-1.5 col-span-1 sm:col-span-2 md:col-span-2">
                        <Label htmlFor="cfg-username" className="text-xs font-semibold">Uživatel (Identita):</Label>
                        <Input
                            id="cfg-username"
                            value={localUsername}
                            onChange={(e) => setLocalUsername(e.target.value)}
                            placeholder="např. pri0207"
                            className="h-8 text-xs font-mono"
                        />
                    </div>

                    <div className="space-y-1.5 col-span-1 sm:col-span-2 md:col-span-3">
                        <Label htmlFor="cfg-mqtt-user" className="text-xs font-semibold">MQTT Login:</Label>
                        <Input
                            id="cfg-mqtt-user"
                            value={localMqttUser}
                            onChange={(e) => setLocalMqttUser(e.target.value)}
                            placeholder="mobilni"
                            className="h-8 text-xs font-mono"
                        />
                    </div>

                    <div className="space-y-1.5 col-span-1 sm:col-span-2 md:col-span-3">
                        <Label htmlFor="cfg-mqtt-pass" className="text-xs font-semibold">MQTT Heslo:</Label>
                        <Input
                            id="cfg-mqtt-pass"
                            type="password"
                            value={localMqttPass}
                            onChange={(e) => setLocalMqttPass(e.target.value)}
                            placeholder="Systemy"
                            className="h-8 text-xs font-mono"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                    {lastError && (
                        <div className="flex items-center gap-1.5 text-xs text-destructive">
                            <ShieldAlert className="h-4 w-4" />
                            <span>Chyba: {lastError}</span>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        {savedNotice && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600">
                                <Check className="h-3.5 w-3.5" /> Uloženo
                            </span>
                        )}
                        <Button type="submit" size="sm" className="text-xs">Uložit a připojit</Button>
                    </div>
                </div>
            </form>
        </Card>
    );
};
