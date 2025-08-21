// server.js
// Node.js + Express + Socket.IO signaling server for "ShareScreen — Meet Style"

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// --- Socket.IO setup (CORS open for dev; same-origin pe bhi chalega)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- Static files (serve index.html + assets from public folder)
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------
// In-memory room state
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { users: new Map(), sharerId: null });
  }
  return rooms.get(roomId);
}

function usersArray(room) {
  return Array.from(room.users.values());
}

function broadcastUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("users-update", usersArray(room));
}

function clearSharer(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.sharerId && room.users.has(room.sharerId)) {
    const u = room.users.get(room.sharerId);
    u.isSharing = false;
    room.users.set(room.sharerId, u);
  }
  room.sharerId = null;
}

// ---------------------------------------------
// Socket events
io.on("connection", (socket) => {
  socket.data.roomId = null;
  socket.data.name = null;

  socket.on("join-room", ({ roomId, userName }) => {
    if (!roomId) return;
    const room = getRoom(roomId);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = userName || "Anonymous";

    room.users.set(socket.id, {
      id: socket.id,
      name: socket.data.name,
      isSharing: false
    });

    socket.emit("room-joined", { users: usersArray(room) });

    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name: socket.data.name,
      isSharing: false
    });

    broadcastUsers(roomId);
  });

  socket.on("request-screen", (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.sharerId) {
      io.to(socket.id).emit("screen-response", { accept: false });
      return;
    }

    socket.to(roomId).emit("screen-request", { from: socket.id });
  });

  socket.on("screen-response", (data) => {
    const { to, accept } = data || {};
    const roomId = socket.data.roomId;
    if (!roomId || !to) return;
    const room = rooms.get(roomId);
    if (!room) return;

    io.to(to).emit("screen-response", { accept: !!accept });

    if (accept) {
      clearSharer(roomId);
      room.sharerId = socket.id;

      const sharer = room.users.get(socket.id);
      if (sharer) {
        sharer.isSharing = true;
        room.users.set(socket.id, sharer);
      }
      broadcastUsers(roomId);
    }
  });

  socket.on("offer", ({ to, sdp }) => {
    if (to && sdp) io.to(to).emit("offer", { from: socket.id, sdp });
  });


  
  socket.on("answer", ({ to, sdp }) => {
    if (to && sdp) io.to(to).emit("answer", { from: socket.id, sdp });
  });

  socket.on("candidate", ({ to, candidate }) => {
    if (to && candidate) io.to(to).emit("candidate", { from: socket.id, candidate });
  });

  socket.on("stop-sharing", (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.sharerId === socket.id) {
      clearSharer(roomId);
      io.to(roomId).emit("stopped");
      broadcastUsers(roomId);
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (room.sharerId === socket.id) {
      clearSharer(roomId);
      io.to(roomId).emit("stopped");
    }

    room.users.delete(socket.id);

    socket.to(roomId).emit("user-left", socket.id);
    broadcastUsers(roomId);

    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  });
});

// ---------------------------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
