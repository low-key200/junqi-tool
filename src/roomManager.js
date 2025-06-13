const rooms = new Map();

class Room {
    constructor(player1, player2) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.player1 = player1;
        this.player2 = player2;
        this.pieces = new Map();
        this.resetConfirmation = new Set();
        this.status = 'selecting';
        this.results = null;
        this.createdAt = Date.now();
    }

    setPiece(playerId, piece) {
        if (this.isValidPlayer(playerId)) {
            this.pieces.set(playerId, piece);
            return true;
        }
        return false;
    }

    getPieces() {
        return {
            player1Piece: this.pieces.get(this.player1),
            player2Piece: this.pieces.get(this.player2)
        };
    }

    bothPlayersSelected() {
        return this.pieces.has(this.player1) && this.pieces.has(this.player2);
    }

    confirmReset(playerId) {
        if (this.isValidPlayer(playerId)) {
            this.resetConfirmation.add(playerId);
            return this.resetConfirmation.size === 2;
        }
        return false;
    }

    reset() {
        this.pieces.clear();
        this.resetConfirmation.clear();
        this.status = 'selecting';
        this.results = null;
    }

    getPlayerNames(users) {
        return {
            player1Name: users.get(this.player1)?.nickname,
            player2Name: users.get(this.player2)?.nickname
        };
    }

    isValidPlayer(playerId) {
        return playerId === this.player1 || playerId === this.player2;
    }

    hasPlayer(playerId) {
        return this.isValidPlayer(playerId);
    }

    getOpponent(playerId) {
        if (playerId === this.player1) return this.player2;
        if (playerId === this.player2) return this.player1;
        return null;
    }
}

function createRoom(player1, player2) {
    const room = new Room(player1, player2);
    rooms.set(room.id, room);
    return room;
}

function getRoomById(roomId) {
    return rooms.get(roomId);
}

function deleteRoom(roomId) {
    rooms.delete(roomId);
}

// 清理超时房间
setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) { // .entries() is good practice for iterating Map
        if (now - room.createdAt > 3600000) { // 1小时后自动清理
            console.log(`Auto-deleting timeout room: ${roomId}`); // Optional: log deletion
            deleteRoom(roomId);
        }
    }
}, 300000); // 每5分钟检查一次

module.exports = {
    createRoom,
    getRoomById,
    deleteRoom,
    rooms // <--- ADD THIS LINE TO EXPORT THE rooms Map
};
