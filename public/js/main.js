const socket = io();
let currentRoom = null;

function login() {
    const nickname = document.getElementById('nickname').value;
    if (nickname.trim()) {
        socket.emit('login', nickname);
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
    } else {
        alert('请输入有效的昵称');
    }
}

socket.on('error', (message) => {
    alert(message);
});

socket.on('players-list', (players) => {
    const playersDiv = document.getElementById('players');
    playersDiv.innerHTML = '';
    players.forEach(player => {
        if (player.id !== socket.id) {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            let statusDisplay = '';
            switch(player.status) {
                case 'available':
                    statusDisplay = `<button onclick="challengePlayer('${player.id}')">挑战</button>`;
                    break;
                case 'in-game':
                    statusDisplay = '<span>(游戏中)</span>';
                    break;
                case 'challenging':
                case 'challenged':
                    statusDisplay = '<span>(等待确认)</span>';
                    break;
                default:
                    statusDisplay = `<span>(${player.status})</span>`;
            }
            playerDiv.innerHTML = `${player.nickname} ${statusDisplay}`;
            playersDiv.appendChild(playerDiv);
        }
    });
});

function challengePlayer(targetId) {
    socket.emit('challenge', targetId);
}

socket.on('challenge-received', (data) => {
    const accept = confirm(`${data.from}向您发起挑战，是否接受？`);
    if (accept) {
        socket.emit('accept-challenge', data.challengerId);
    } else {
        socket.emit('reject-challenge', data.challengerId);
    }
});

socket.on('challenge-rejected', (data) => {
    alert(`${data.by}拒绝了您的挑战`);
});

socket.on('challenge-timeout', () => {
    alert('挑战请求超时');
});

socket.on('game-status-update', (data) => {
    const gameArea = document.getElementById('game-area');
    const gameStatus = document.getElementById('game-status');
    const pieceSelection = document.getElementById('piece-selection');

    switch(data.status) {
        case 'watching':
            gameArea.style.display = 'block';
            pieceSelection.style.display = 'none';
            gameStatus.innerHTML = `正在观战: ${data.player1} vs ${data.player2}`;
            break;

        case 'playing':
            if (data.isPlayer) {
                currentRoom = data.roomId;
                gameArea.style.display = 'block';
                gameStatus.innerHTML = `正在与 ${data.opponent} 对决`;
                initializePieceSelection();
                pieceSelection.style.display = 'block';
            }
            break;

        case 'result':
            gameArea.style.display = 'block';
            pieceSelection.style.display = 'none';
            if (data.isPlayer) {
                gameStatus.innerHTML = `
                    <h4>对战结果</h4>
                    <p>您的状态: ${data.yourStatus}</p>
                    <p>对手选择: ${data.piece}</p>
                    <button onclick="resetGame()">重置</button>
                `;
            } else {
                gameStatus.innerHTML = `
                    <h4>对战结果</h4>
                    <p>${data.player1}: ${data.player1Status} (${data.player1Piece})</p>
                    <p>${data.player2}: ${data.player2Status} (${data.player2Piece})</p>
                    <p>等待玩家重置...</p>
                `;
            }
            break;

        case 'opponent-disconnected':
            alert('对手已断线，游戏结束');
            currentRoom = null;
            gameArea.style.display = 'none';
            pieceSelection.style.display = 'none';
            gameStatus.innerHTML = '';
            break;

        case 'reset':
            currentRoom = null;
            gameArea.style.display = 'none';
            pieceSelection.style.display = 'none';
            gameStatus.innerHTML = '';
            break;
    }
});

function initializePieceSelection() {
    const pieces = ['司令', '军长', '师长', '旅长', '团长', '营长', '连长', '排长', '工兵', '地雷', '炸弹'];
    const selectionDiv = document.getElementById('piece-selection');
    selectionDiv.innerHTML = '<h4>请选择您的棋子:</h4>';
    pieces.forEach(piece => {
        const button = document.createElement('button');
        button.className = 'piece-button';
        button.textContent = piece;
        button.onclick = () => selectPiece(piece);
        selectionDiv.appendChild(button);
    });
}

function selectPiece(piece) {
    if (!currentRoom) return;
    socket.emit('piece-selected', {
        roomId: currentRoom,
        piece: piece
    });
    document.getElementById('piece-selection').style.display = 'none';
    document.getElementById('game-status').innerHTML = '等待对手选择...';
}

function resetGame() {
    if (!currentRoom) return;
    socket.emit('reset-game', currentRoom);
}

// 心跳响应
socket.on('ping', () => {
    socket.emit('pong');
});

// 错误处理
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    alert('连接服务器失败，请刷新页面重试');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    alert('与服务器断开连接，请刷新页面重试');
});
