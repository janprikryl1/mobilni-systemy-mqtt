import {useRef, useEffect, type FC} from 'react';
import { useChat } from '../../context/useChat';
import { MessageItem } from './MessageItem';
import {Globe, Lock, MessageCircleDashed, Trash2} from 'lucide-react';
import {Button} from "../ui/button.tsx";

export const MessageList: FC = () => {
    const { filteredMessages, activeRecipient, clearHistory } = useChat();
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [filteredMessages]);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
            {/* Conversation Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-card/40 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                    {activeRecipient ? (
                        <>
                            <Lock className="h-3.5 w-3.5 text-amber-500" />
                            <span className="font-semibold text-foreground">Privátní konverzace s:</span>
                            <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground font-medium">
                                {activeRecipient}
                            </span>
                        </>
                    ) : (
                        <>
                            <Globe className="h-3.5 w-3.5 text-primary" />
                            <span className="font-semibold text-foreground">Veřejný kanál:</span>
                            <span className="font-mono bg-muted px-1.5 py-0.5 rounded">/mschat/all/#</span>
                        </>
                    )}
                </div>
                <div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearHistory}
                        title="Vymazat lokální mezipaměť zpráv"
                        className="text-muted-foreground hover:text-destructive"
                    >
                        <Trash2 />
                        {filteredMessages.length} {filteredMessages.length === 1 ? 'zpráva' : filteredMessages.length < 5 ? 'zprávy' : 'zpráv'}
                    </Button>
                </div>

            </div>

            {/* Scrollable messages container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {filteredMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                        <MessageCircleDashed className="h-12 w-12 stroke-[1.2] mb-3 text-muted-foreground/60" />
                        <p className="text-sm font-medium">Zatím žádné zprávy v této konverzaci.</p>
                        <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm">
                            {activeRecipient
                                ? `Napište první privátní zprávu pro uživatele ${activeRecipient}.`
                                : 'Napište první veřejnou zprávu. Zprávy se ukládají do localstorage.'}
                        </p>
                    </div>
                ) : (
                    filteredMessages.map((msg) => <MessageItem key={msg.id} message={msg} />)
                )}
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
};
