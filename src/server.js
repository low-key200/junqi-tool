const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { createRoom, getRoomById, deleteRoom } = require('./roomManager');
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
            if (challenger.status === 'challenging') {
                challenger.status = 'available';
                target.status = 'available';
                socket.emit('challenge-timeout');
                io.to(targetId).emit('challenge-timeout');
                broadcastUserList();
            }
        }, 30000);
        
        broadcastUserList();
    });

    socket.on('accept-challenge', (challengerId) => {
        const challenger = users.get(challengerId);
        const accepter = users.get(socket.id);

        if (!challenger || !accepter) {
            socket.emit('error', 'Invalid challenge');
            return;
        }

        if (challenger.status !== 'challenging' || accepter.status !== 'challenged') {
            socket.emit('error', 'Invalid game state');
            return;
        }

        challenger.status = 'in-game';
        accepter.status = 'in-game';

        const room = createRoom(challengerId, socket.id);

        // 通知对战玩家
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

        // 通知观战玩家
        socket.broadcast.except([challengerId, socket.id]).emit('game-status-update', {
            status: 'watching',
            player1: challenger.nickname,
            player2: accepter.nickname
        });

        broadcastUserList();
    });

    socket.on('reject-challenge', (challengerId) => {
        const challenger = users.get(challengerId);
        const rejecter = users.get(socket.id);

        if (challenger) challenger.status = 'available';
        if (rejecter) rejecter.status = 'available';

        io.to(challengerId).emit('challenge-rejected', {
            by: rejecter ? rejecter.nickname : 'unknown player'
        });

        broadcastUserList();
    });

    socket.on('piece-selected', (data) => {
        const room = getRoomById(data.roomId);
        if (!room || !data.piece) return;

        if (!room.isValidPlayer(socket.id)) {
            socket.emit('error', 'Not a valid player in this room');
            return;
        }

        room.setPiece(socket.id, data.piece);
        
        if (room.bothPlayersSelected()) {
            const results = comparepieces(room.getPieces());
            room.status = 'finished';
            room.results = results;

            const names = room.getPlayerNames(users);

            // 通知对战玩家
            io.to(room.player1).emit('game-status-update', {
                status: 'result',
                isPlayer: true,
                yourStatus: results.player1Status,
                opponent: names.player2Name,
                piece: room.getPieces().player2Piece
            });

            io.to(room.player2).emit('game-status-update', {
                status: 'result',
                isPlayer: true,
                yourStatus: results.player2Status,
                opponent: names.player1Name,
                piece: room.getPieces().player1Piece
            });

            // 通知观战玩家
            socket.broadcast.except([room.player1, room.player2]).emit('game-status-update', {
                status: 'result',
                isPlayer: false,
                player1: names.player1Name,
                player2: names.player2Name,
                player1Status: results.player1Status,
                player2Status: results.player2Status,
                player1Piece: room.getPieces().player1Piece,
                player2Piece: room.getPieces().player2Piece
            });
        }
    });

    socket.on('reset-game', (roomId) => {
        const room = getRoomById(roomId);
        if (!room) return;

        if (!room.isValidPlayer(socket.id)) {
            socket.emit('error', 'Not a valid player in this room');
            return;
        }

        if (room.confirmReset(socket.id)) {
            const player1 = users.get(room.player1);
            const player2 = users.get(room.player2);
            
            if (player1) player1.status = 'available';
            if (player2) player2.status = 'available';

            io.emit('game-status-update', {
                status: 'reset'
            });

            deleteRoom(roomId);
            broadcastUserList();
        }
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user && user.status === 'in-game') {
            // 处理游戏中断线
            handleGameDisconnect(socket.id);
        }
        users.delete(socket.id);
        broadcastUserList();
    });

    socket.on('pong', () => {
        const user = users.get(socket.id);
        if (user) {
            user.lastPong = Date.now();
        }
    });
});

function handleGameDisconnect(socketId) {
    // 查找包含该玩家的房间
    for (const [roomId, room] of rooms) {
        if (room.hasPlayer(socketId)) {
            const opponent = room.getOpponent(socketId);
            if (opponent) {
                const opponentUser = users.get(opponent);
                if (opponentUser) {
                    opponentUser.status = 'available';
                    io.to(opponent).emit('game-status-update', {
                        status: 'opponent-disconnected'
                    });
                }
            }
            deleteRoom(roomId);
            break;
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

// 心跳检测
setInterval(() => {
    io.emit('ping');
    const now = Date.now();
    for (const [socketId, user] of users.entries()) {
        if (now - user.lastPong > 35000) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                socket.disconnect(true);
            }
            users.delete(socketId);
        }
    }
}, 5000);

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
