const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; 
const socketToRoom = {}; 

io.on('connection', (socket) => {
  socket.on('join-voice-room', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].push(socket.id);
    } else {
      rooms[roomId] = [socket.id];
    }
    socketToRoom[socket.id] = roomId;
    const otherUsers = rooms[roomId].filter(id => id !== socket.id);
    socket.emit('all-users-in-room', otherUsers);
  });

  socket.on('sending-signal', (payload) => {
    io.to(payload.userToSignal).emit('user-joined', {
      signal: payload.signal,
      callerID: payload.callerID
    });
  });

  socket.on('returning-signal', (payload) => {
    io.to(payload.callerID).emit('receiving-returned-signal', {
      signal: payload.signal,
      id: socket.id
    });
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      let room = rooms[roomId];
      if (room) {
        room = room.filter(id => id !== socket.id);
        rooms[roomId] = room;
        if (room.length === 0) delete rooms[roomId];
      }
      socket.broadcast.emit('user-left-room', socket.id);
    }
    delete socketToRoom[socket.id];
  });

  socket.on('leave-voice-room', () => {
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      let room = rooms[roomId];
      if (room) {
        room = room.filter(id => id !== socket.id);
        rooms[roomId] = room;
        if (room.length === 0) delete rooms[roomId];
      }
      socket.broadcast.emit('user-left-room', socket.id);
      delete socketToRoom[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
