// The indexer provider imports a Node-oriented named WebSocket export. In a
// browser build the platform WebSocket is the correct implementation.
export const WebSocket = globalThis.WebSocket;
export default WebSocket;
