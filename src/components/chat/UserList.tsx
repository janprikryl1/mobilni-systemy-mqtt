import {type FC, type FormEvent, useState} from 'react';
import { useChat } from '../../context/useChat';
import { useMqtt } from '../../context/useMqtt';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { MessageSquare, Lock, Plus, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';

export const UserList: FC = () => {
    const { activeRecipient, setActiveRecipient, knownUsers } = useChat();
    const { usersPresence, username } = useMqtt();

    const [newRecipientInput, setNewRecipientInput] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);

    const handleAddUser = (e: FormEvent) => {
        e.preventDefault();
        const trimmed = newRecipientInput.trim();
        if (trimmed) {
            setActiveRecipient(trimmed);
            setNewRecipientInput('');
            setShowAddForm(false);
        }
    };

    return (
        <aside className="w-full md:w-64 border-r bg-muted/20 flex flex-col h-full">
            <div className="p-3 border-b space-y-1">
                <button
                    type="button"
                    onClick={() => setActiveRecipient(null)}
                    className={cn(
                        'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                        activeRecipient === null
                            ? 'bg-primary text-primary-foreground shadow-xs'
                            : 'hover:bg-muted text-foreground'
                    )}
                >
                    <div className="flex items-center gap-2.5 truncate">
                        <Globe className="h-4 w-4 shrink-0" />
                        <span className="truncate">Veřejný chat</span>
                    </div>
                    <span className="text-[10px] opacity-75 font-mono">/all</span>
                </button>
            </div>

            <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Přímé zprávy
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddForm((prev) => !prev)}
                    className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground"
                    title="Napsat novému uživateli"
                >
                    <Plus className="h-3.5 w-3.5" />
                </Button>
            </div>

            {showAddForm && (
                <form onSubmit={handleAddUser} className="p-2 mx-2 mb-2 bg-background rounded-lg border shadow-xs">
                    <div className="flex gap-1.5">
                        <Input
                            type="text"
                            value={newRecipientInput}
                            onChange={(e) => setNewRecipientInput(e.target.value)}
                            placeholder="login (pri0207)"
                            className="h-7 text-xs"
                            autoFocus
                        />
                        <Button type="submit" size="sm" className="h-7 px-2 text-xs">
                            Otevřít
                        </Button>
                    </div>
                </form>
            )}

            {/* User Presence List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {knownUsers.length === 0 ? (
                    <div className="p-3 text-center text-xs text-muted-foreground">
                        Žádní uživatelé
                    </div>
                ) : (
                    knownUsers.map((user) => {
                        const isSelected = activeRecipient === user;
                        const isSelf = user === username;
                        const presence = usersPresence[user];
                        const isOnline = isSelf ? true : presence?.status === 'online';

                        return (
                            <button
                                key={user}
                                type="button"
                                onClick={() => setActiveRecipient(user)}
                                className={cn(
                                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left group',
                                    isSelected
                                        ? 'bg-secondary text-secondary-foreground font-semibold shadow-2xs'
                                        : 'hover:bg-muted/70 text-foreground'
                                )}
                            >
                                <div className="flex items-center gap-2 truncate">
                                    {/* Presence status dot */}
                                    <span
                                        className={cn(
                                            'h-2 w-2 rounded-full shrink-0 transition-all',
                                            isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                                        )}
                                        title={isOnline ? 'Online' : 'Offline'}
                                    />
                                    <span className="truncate">
                                        {user} {isSelf && <span className="text-xs text-muted-foreground font-normal">(Vy)</span>}
                                    </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                    <MessageSquare className="h-3 w-3" />
                                </span>
                            </button>
                        );
                    })
                )}
            </div>

            {/* Current user footer badge */}
            <div className="p-3 border-t bg-muted/40 text-xs flex items-center justify-between">
                <span className="text-muted-foreground">Přihlášen jako:</span>
                <span className="font-mono font-semibold truncate max-w-[120px]">{username || 'Anonym'}</span>
            </div>
        </aside>
    );
};
