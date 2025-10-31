import { useEffect, useRef, useState } from 'react';

interface WebSocketMessage {
    data: string;
}

export const useWebSocket = (url: string) => {
    const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const ws = new WebSocket(`ws://${window.location.host}${url}`);
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
        };

        ws.onclose = () => {
            setIsConnected(false);
        };

        ws.onmessage = (event) => {
            setLastMessage(event);
        };

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [url]);

    return { lastMessage, isConnected };
};