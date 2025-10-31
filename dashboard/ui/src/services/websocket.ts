import { io, Socket } from 'socket.io-client';

export interface MetricData {
    jr_job_id: string;
    data: any;
    raw_line: string;
}

export interface WebSocketService {
    socket: Socket | null;
    connect: () => void;
    disconnect: () => void;
    subscribeToJob: (jobId: string) => void;
    unsubscribeFromJob: (jobId: string) => void;
    onMetricData: (callback: (data: MetricData) => void) => void;
    onConnect: (callback: () => void) => void;
    onDisconnect: (callback: () => void) => void;
    onStatus: (callback: (data: { msg: string }) => void) => void;
    isConnected: () => boolean;
}

class WebSocketServiceImpl implements WebSocketService {
    socket: Socket | null = null;

    connect() {
        if (this.socket?.connected) {
            return;
        }

        this.socket = io({
            transports: ['websocket', 'polling'],
            timeout: 5000,
        });

        this.socket.on('connect', () => {
            console.log('Connected to WebSocket server');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from WebSocket server');
        });

        this.socket.on('connect_error', (error: any) => {
            console.error('WebSocket connection error:', error);
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    subscribeToJob(jobId: string) {
        if (this.socket?.connected) {
            this.socket.emit('subscribe_job', { jr_job_id: jobId });
        }
    }

    unsubscribeFromJob(jobId: string) {
        if (this.socket?.connected) {
            this.socket.emit('unsubscribe_job', { jr_job_id: jobId });
        }
    }

    onMetricData(callback: (data: MetricData) => void) {
        if (this.socket) {
            this.socket.on('metric_data', callback);
        }
    }

    onConnect(callback: () => void) {
        if (this.socket) {
            this.socket.on('connect', callback);
        }
    }

    onDisconnect(callback: () => void) {
        if (this.socket) {
            this.socket.on('disconnect', callback);
        }
    }

    onStatus(callback: (data: { msg: string }) => void) {
        if (this.socket) {
            this.socket.on('status', callback);
        }
    }

    isConnected(): boolean {
        return this.socket?.connected || false;
    }
}

// Export a singleton instance
export const webSocketService = new WebSocketServiceImpl();