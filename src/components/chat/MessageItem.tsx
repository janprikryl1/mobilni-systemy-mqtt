import {type FC} from 'react';
import type { ChatMessage } from '../../types/chat';
import { useMqtt } from '../../context/useMqtt';
import { cn } from '../../lib/utils';
import { Clock, Check, CheckCheck } from 'lucide-react';

type Props = {
    message: ChatMessage;
}

export const MessageItem: FC<Props> = ({ message }) => {
    const { username } = useMqtt();
    const isMe = message.sender === username;

    const formatTime = (ts: number) => {
        const date = new Date(ts);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div className={cn('flex flex-col my-2 max-w-[85%] sm:max-w-[75%]', isMe ? 'ml-auto items-end' : 'mr-auto items-start')}>
            <div className="flex items-center gap-1.5 px-1 mb-1 text-[11px] text-muted-foreground">
                <span className={cn('font-semibold', isMe ? 'text-primary' : 'text-foreground')}>
                    {isMe ? 'Vy' : message.sender}
                </span>
                <span>•</span>
                <span>{formatTime(message.timestamp)}</span>
            </div>

            {/* Bubble */}
            <div
                className={cn(
                    'px-3.5 py-2.5 rounded-2xl text-sm break-words shadow-2xs transition-colors',
                    isMe
                        ? 'bg-primary text-primary-foreground rounded-br-xs'
                        : 'bg-muted text-foreground border rounded-bl-xs',
                    message.status === 'pending' && 'opacity-70 border-dashed border-amber-400'
                )}
            >
                <div className="whitespace-pre-wrap">{message.text}</div>
            </div>

            <div className="flex items-center gap-2 px-1 mt-0.5 text-[10px] text-muted-foreground/80">
                {isMe && (
                    <div className="flex items-center gap-1 font-medium">
                        {message.status === 'pending' && (
                            <span className="flex items-center gap-0.5 text-amber-500">
                                <Clock className="h-3 w-3" /> Ve frontě
                            </span>
                        )}
                        {message.status === 'sent' && (
                            <span className="flex items-center gap-0.5 text-muted-foreground">
                                <Check className="h-3 w-3" /> Odesláno
                            </span>
                        )}
                        {message.status === 'delivered' && (
                            <span className="flex items-center gap-0.5 text-emerald-500">
                                <CheckCheck className="h-3 w-3" /> Doručeno
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
