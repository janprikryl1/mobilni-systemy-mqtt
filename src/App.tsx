import {type FC, useState} from 'react';
import { MqttProvider } from './context/MqttContext';
import { ChatProvider } from './context/ChatContext';
import { Header } from './components/chat/Header';
import { ConnectionBar } from './components/chat/ConnectionBar';
import { UserList } from './components/chat/UserList';
import { MessageList } from './components/chat/MessageList';
import { MessageInput } from './components/chat/MessageInput';

export const App: FC = () => {
    const [showSettings, setShowSettings] = useState(true);

    return (
        <MqttProvider>
            <ChatProvider>
                <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
                    <Header
                        showSettings={showSettings}
                        onToggleSettings={() => setShowSettings((prev) => !prev)}
                    />
                    {showSettings && <ConnectionBar />}
                    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                        <UserList />
                        <main className="flex-1 flex flex-col h-full overflow-hidden">
                            <MessageList />
                            <MessageInput />
                        </main>
                    </div>
                </div>
            </ChatProvider>
        </MqttProvider>
    );
};
