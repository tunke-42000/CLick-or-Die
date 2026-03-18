import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 3001 });

// map of roomId -> array of ws connections
const rooms = new Map();

wss.on("connection", (ws) => {
  ws.roomId = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "join") {
        const roomId = data.roomId?.toUpperCase();
        if (!roomId) return;
        
        let room = rooms.get(roomId);
        if (!room) {
          room = [];
          rooms.set(roomId, room);
        }

        if (room.length >= 2) {
          ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
          return;
        }

        room.push(ws);
        ws.roomId = roomId;

        if (room.length === 1) {
          ws.send(JSON.stringify({ type: "waiting" }));
        } else if (room.length === 2) {
          // Both joined, notify them
          room.forEach((playerWs) => {
            playerWs.send(JSON.stringify({ type: "matched" }));
          });
        }
      }

      if (data.type === "state_update" && ws.roomId) {
        const room = rooms.get(ws.roomId);
        if (room) {
          const opponent = room.find((p) => p !== ws);
          if (opponent && opponent.readyState === 1) {
            opponent.send(JSON.stringify({
              type: "opponent_update",
              payload: data.payload
            }));
          }
        }
      }

      if (data.type === "rematch" && ws.roomId) {
        const room = rooms.get(ws.roomId);
        if (room) {
          const opponent = room.find((p) => p !== ws);
          if (opponent && opponent.readyState === 1) {
            opponent.send(JSON.stringify({ type: "opponent_rematch" }));
          }
        }
      }
    } catch (err) {
      console.error("Failed to parse socket message", err);
    }
  });

  ws.on("close", () => {
    if (ws.roomId) {
      const room = rooms.get(ws.roomId);
      if (room) {
        const opponent = room.find((p) => p !== ws);
        if (opponent && opponent.readyState === 1) {
          opponent.send(JSON.stringify({ type: "opponent_disconnected" }));
        }
        
        const filteredRoom = room.filter(p => p !== ws);
        if (filteredRoom.length === 0) {
          rooms.delete(ws.roomId);
        } else {
          rooms.set(ws.roomId, filteredRoom);
        }
      }
    }
  });
});

console.log("WebSocket server running on ws://localhost:3001");
