// Socket.IO wrapper tuned for flaky mobile networks (Nigeria):
//  - aggressive reconnection, but we back off lightly
//  - reconnectionDelay growing so server isn't hammered
//  - expose connect state + a stable reference
import { io } from 'socket.io-client';

export function createSocket(url) {
  return io(url || '/', {
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 10000,
  });
}