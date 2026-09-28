import {useState, type FormEvent, type FC} from 'react';
import { useChat } from '../../context/useChat';
import { useMqtt } from '../../context/useMqtt';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Send, Lock, Globe } from 'lucide-react';

export const MessageInput: FC = () => {
    const { sendMessage, activeRecipient } = useChat();
    const { status } = useMqtt();
    const [text, setText] = useState('');

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (!trimmed) return;

        sendMessage(trimmed, activeRecipient);
        setText('');
    };

    const isConnected = status === 'connected';

    return (
        <footer className="p-3 border-t bg-card text-card-foreground">
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Input
                            type="text"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={
                                !isConnected
                                    ? 'Odpojeno: zpráva se uloží do fronty (keše) a odešle po připojení...'
                                    : activeRecipient
                                    ? `Napsat privátní zprávu pro ${activeRecipient}...`
                                    : 'Napsat veřejnou zprávu (Enter pro odeslání)...'
                            }
                            className="pr-20 text-sm h-10"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-muted-foreground pointer-events-none">
                            {activeRecipient ? (
                                <span className="flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                                    <Lock className="h-3 w-3" /> Privátní
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded font-mono">
                                    <Globe className="h-3 w-3" /> /all
                                </span>
                            )}
                        </div>
                    </div>

                    <Button
                        type="submit"
                        disabled={!text.trim()}
                        className="h-10 px-4 gap-1.5 shrink-0"
                    >
                        <Send className="h-4 w-4" />
                        <span className="hidden sm:inline">Odeslat</span>
                    </Button>
                </div>

                {!isConnected && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 px-1">
                        <span>Jste v odpojeném režimu. Vaše zpráva bude bezpečně uložena v mezipaměti a odeslána automaticky.</span>
                    </div>
                )}
            </form>
        </footer>
    );
};
