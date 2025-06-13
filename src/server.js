const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
// Update your import statement:
const { createRoom, getRoomById, deleteRoom, rooms } = require('./roomManager'); // <--- ADD 'rooms' HERE
const { comparepieces } = require('./gameLogic');

app.use(express.static('public'));

const users = new Map();

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('login', (nickname) => {
        if (!nickname || nickname.trim().length === 0) {
            socket.emit('error', 'Invalid nickname');
            return;
        }
        
        users.set(socket.id, {
            nickname: nickname.trim(),
            status: 'available',
            lastPong: Date.now()
        });
        broadcastUserList();
    });

    socket.on('challenge', (targetId) => {
        const challenger = users.get(socket.id);
        const target = users.get(targetId);
        
        if (!challenger || !target) {
            socket.emit('error', 'Invalid player');
            return;
        }

        if (challenger.status !== 'available' || target.status !== 'available') {
            socket.emit('error', 'Player not available');
            return;
        }

        challenger.status = 'challenging';
        target.status = 'challenged';
        
        io.to(targetId).emit('challenge-received', {
            from: challenger.nickname,
            challengerId: socket.id
        });

        setTimeout(() => {
            const currentChallenger = users.get(socket.id); // Re-fetch in case state changed
            const currentTarget = users.get(targetId);
            if (currentChallenger && currentChallenger.status === 'challenging') {
                currentChallenger.status = 'available';
                if (currentTarget) currentTarget.status = 'available';
                socket.emit('challenge-timeout');
                io.to(targetId).emit('challenge-timeout'); // Also inform target
                broadcastUserList();
            }
        }, 30000); // 30 seconds
        
        broadcastUserList();
    });

    socket.on('accept-challenge', (challengerId) => {
        const challenger = users.get(challengerId);
        const accepter = users.get(socket.id);

        if (!challenger || !accepter) {
            // It's possible one disconnected before acceptance
            if (challenger) challenger.status = 'available';
            if (accepter) accepter.status = 'available';
            broadcastUserList();
            socket.emit('error', 'Invalid challenge, one player may have disconnected.');
            return;
        }

        // Check statuses again, as timeout might have occurred
        if (challenger.status !== 'challenging' || accepter.status !== 'challenged') {
            // Restore statuses if they were valid before this check
            if (challenger.status === 'challenging') challenger.status = 'available';
            if (accepter.status === 'challenged') accepter.status = 'available';
            broadcastUserList();
            socket.emit('error', 'Challenge is no longer valid (e.g., timed out or status changed).');
            return;
        }

        challenger.status = 'in-game';
        accepter.status = 'in-game';

        const room = createRoom(challengerId, socket.id);

        io.to(challengerId).emit('game-status-update', {
            status: 'playing',
            isPlayer: true,
            opponent: accepter.nickname,
            roomId: room.id
        });
        
        io.to(socket.id).emit('game-status-update', {
            status: 'playing',
            isPlayer: true,
            opponent: challenger.nickname,
            roomId: room.id
        });

        // Notify spectators more robustly
        const spectatorSockets = Array.from(io.sockets.sockets.keys()).filter(id => id !== challengerId && id !== socket.id);
        spectatorSockets.forEach(spectatorId => {
            io.to(spectatorId).emit('game-status-update', {
                status: 'watching',
                player1: challenger.nickname,
                player2: accepter.nickname,
                roomId: room.id // Spectators might also want room ID
            });
        });
        
        broadcastUserList();
    });

    socket.on('reject-challenge', (challengerId) => {
        const challenger = users.get(challengerId);
        const rejecter = users.get(socket.id);

        if (challenger && challenger.status === 'challenging') { // Only change if still challenging
             challenger.status = 'available';
        }
        if (rejecter && rejecter.status === 'challenged') { // Only change if still challenged
            rejecter.status = 'available';
        }

        io.to(challengerId).emit('challenge-rejected', {
            by: rejecter ? rejecter.nickname : 'Unknown Player'
        });

        broadcastUserList();
    });

    socket.on('piece-selected', (data) => {
        const room = getRoomById(data.roomId);
        if (!room || !data.piece || room.status === 'finished') { // Prevent selection if room finished
            socket.emit('error', 'Room not found, invalid piece, or game already finished.');
            return;
        }

        if (!room.isValidPlayer(socket.id)) {
            socket.emit('error', 'Not a valid player in this room');
            return;
        }
        
        // Prevent selecting piece if already selected by this player
        if (room.pieces.has(socket.id)) {
            socket.emit('error', 'You have already selected a piece.');
            return;
        }

        room.setPiece(socket.id, data.piece);
        
        // Notify opponent that you've selected (optional, for better UX)
        const opponentId = room.getOpponent(socket.id);
        if (opponentId && io.sockets.sockets.get(opponentId)) {
            io.to(opponentId).emit('game-message', `${users.get(socket.id)?.nickname} has selected a piece.`);
        }


        if (room.bothPlayersSelected()) {
            const results = comparepieces(room.getPieces());
            room.status = 'finished';
            room.results = results;

            const names = room.getPlayerNames(users);

            io.to(room.player1).emit('game-status-update', {
                status: 'result',
                isPlayer: true,
                yourStatus: results.player1Status,
                opponent: names.player2Name,
                opponentStatus: results.player2Status,
                roomId: room.id
            });

            io.to(room.player2).emit('game-status-update', {
                status: 'result',
                isPlayer: true,
                yourStatus: results.player2Status,
                opponent: names.player1Name,
                opponentStatus: results.player1Status,
                roomId: room.id
            });

            // Notify spectators of the result
            const spectatorSockets = Array.from(io.sockets.sockets.keys()).filter(id => id !== room.player1 && id !== room.player2);
            spectatorSockets.forEach(spectatorId => {
                io.to(spectatorId).emit('game-status-update', {
                    status: 'result',
                    isPlayer: false,
                    player1: names.player1Name,
                    player2: names.player2Name,
                    player1Status: results.player1Status,
                    player2Status: results.player2Status,
                    roomId: room.id
                });
            });
        }
    });

    socket.on('reset-game', (roomId) => {
        const room = getRoomById(roomId);
        if (!room) {
            socket.emit('error', 'Room not found for reset.');
            return;
        }

        if (room.status !== 'finished') { // Only allow reset if game is finished
            socket.emit('error', 'Game is not finished yet.');
            return;
        }

        if (!room.isValidPlayer(socket.id)) {
            socket.emit('error', 'Not a valid player in this room');
            return;
        }

        if (room.confirmReset(socket.id)) {
            const player1User = users.get(room.player1);
            const player2User = users.get(room.player2);
            
            if (player1User) player1User.status = 'available';
            if (player2User) player2User.status = 'available';

            // Emit reset to all clients, including spectators, so they clear their game state
            io.emit('game-status-update', { // Use io.emit to notify everyone
                status: 'reset',
                roomId: roomId // Send roomId so clients can specifically reset relevant game views
            });
            
            // It's important to also clear the client-side 'currentRoom' for the players involved.
            // The generic 'reset' event might not be enough if they were in multiple potential games.
            // The 'game-status-update' with status 'reset' should prompt clients to clear `currentRoom`.

            deleteRoom(roomId);
            broadcastUserList();
        } else {
            // Notify the other player that a reset has been requested
            const opponentId = room.getOpponent(socket.id);
            if (opponentId && io.sockets.sockets.get(opponentId)) {
                io.to(opponentId).emit('game-message', `${users.get(socket.id)?.nickname} wants to reset the game. Click Reset if you agree.`);
            }
            socket.emit('game-message', 'Waiting for opponent to confirm reset...');
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id, users.get(socket.id)?.nickname);
        handleGameDisconnect(socket.id); // This should now work
        users.delete(socket.id);
        broadcastUserList();
        console.log('Users remaining:', Array.from(users.values()).map(u => u.nickname));
    });

    socket.on('pong', () => {
        const user = users.get(socket.id);
        if (user) {
            user.lastPong = Date.now();
        }
    });
});

function handleGameDisconnect(socketId) {
    // Iterate over a copy of room IDs if modifying 'rooms' map during iteration,
    // or ensure 'deleteRoom' doesn't cause issues. Direct iteration is often fine for Maps.
    for (const [roomId, room] of rooms.entries()) { // .entries() is good practice
        if (room.hasPlayer(socketId)) {
            console.log(`Player ${socketId} was in room ${roomId}. Cleaning up.`);
            const opponentId = room.getOpponent(socketId);
            
            if (opponentId) {
                const opponentUser = users.get(opponentId);
                if (opponentUser) {
                    opponentUser.status = 'available'; // Make opponent available
                    // Notify opponent
                    io.to(opponentId).emit('game-status-update', {
                        status: 'opponent-disconnected',
                        roomId: roomId // Send roomId so client knows which game ended
                    });
                    console.log(`Notified opponent ${opponentId} about disconnect in room ${roomId}.`);
                }
            }
            // Notify any spectators that the game in this room has ended due to disconnect
            const spectatorSockets = Array.from(io.sockets.sockets.keys()).filter(id => id !== room.player1 && id !== room.player2);
            spectatorSockets.forEach(spectatorId => {
                // Check if this spectator was actually watching *this* game, might need more specific tracking
                // For now, a general reset or a specific message for this room
                io.to(spectatorId).emit('game-status-update', {
                    status: 'reset', // or a new status like 'game-aborted'
                    roomId: roomId,
                    reason: `Game ended due to player disconnect.`
                });
            });

            deleteRoom(roomId);
            console.log(`Room ${roomId} deleted due to player disconnect.`);
            broadcastUserList(); // Update user list as opponent is now available
            break; // Player can only be in one room at a time as per this logic
        }
    }
}

function broadcastUserList() {
    const playersList = Array.from(users.entries()).map(([id, user]) => ({
        id,
        nickname: user.nickname,
        status: user.status
    }));
    io.emit('players-list', playersList);
}

// Ping/Pong for dead connection detection
setInterval(() => {
    const now = Date.now();
    io.sockets.sockets.forEach((socket) => { // Iterate over connected sockets
        const user = users.get(socket.id);
        if (user) {
            if (now - user.lastPong > 35000) { // 35 seconds timeout
                console.log(`PONG timeout for ${socket.id} (${user.nickname}). Disconnecting.`);
                socket.disconnect(true); // This will trigger the 'disconnect' event for this socket
            } else {
                socket.emit('ping'); // Send ping only if not about to be disconnected
            }
        } else if (socket.connected) { // User not in 'users' map but socket connected (e.g. before login)
             if (now - (socket.lastPongTimestamp || socket.handshake.time) > 60000) { // Longer timeout for pre-login
                console.log(`Pre-login PONG timeout for ${socket.id}. Disconnecting.`);
                socket.disconnect(true);
             } else {
                socket.emit('ping');
                // Initialize lastPongTimestamp on first ping for pre-login sockets
                if (!socket.lastPongTimestamp) socket.lastPongTimestamp = now;
             }
        }
    });
    // The loop for deleting users from the 'users' map if socket is gone is implicitly handled
    // by the socket's 'disconnect' event which calls users.delete(socket.id).
}, 15000); // Ping every 15 seconds


const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

