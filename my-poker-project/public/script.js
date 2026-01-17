// แก้ไขการเชื่อมต่อสำหรับ Render
const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'], 
    upgrade: false
});

// เช็คว่าเชื่อมต่อได้จริงไหม (ดูใน Console)
socket.on('connect', () => {
    console.log("เชื่อมต่อ Server สำเร็จ! ID:", socket.id);
    alert("เชื่อมต่อ Server ได้แล้ว! เล่นได้เลย"); // เด้งเตือนให้รู้ว่าผ่าน
});

let myId = '';
let myName = '';
let currentRoom = '';
let isHost = false;
let currentBet = 0;

// === Socket Listeners ===

socket.on('connect', () => {
    myId = socket.id;
});

socket.on('room_created', (data) => {
    currentRoom = data.roomId;
    isHost = data.isHost;
    showScreen('lobby-screen');
    document.getElementById('display-room-id').innerText = currentRoom;
    if(isHost) document.getElementById('host-controls').classList.remove('hidden');
});

socket.on('room_joined', (data) => {
    currentRoom = data.roomId;
    isHost = data.isHost;
    showScreen('lobby-screen');
    document.getElementById('display-room-id').innerText = currentRoom;
    document.getElementById('waiting-msg').innerText = "รอ Dealer เริ่มเกม...";
});

socket.on('update_players', (players) => {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    const winnerSelect = document.getElementById('winner-select');
    winnerSelect.innerHTML = '';

    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name + (p.role === 'host' ? ' (Dealer)' : '');
        list.appendChild(li);

        // ใส่ใน Dropdown เลือกผู้ชนะ
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = p.name;
        winnerSelect.appendChild(opt);
    });
});

socket.on('game_started', (data) => {
    showScreen('game-screen');
    
    // แสดง Big Blind Animation
    const bbName = data.players.find(p => p.id === data.bigBlindId).name;
    const overlay = document.getElementById('big-blind-announce');
    document.getElementById('big-blind-name').innerText = bbName + " เป็น Big Blind!";
    overlay.classList.remove('hidden');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 3000);

    if(isHost) document.getElementById('dealer-end-controls').classList.remove('hidden');
    
    // Reset Board
    resetBoardUI();
});

socket.on('update_game_state', (data) => {
    document.getElementById('pot-amount').innerText = data.pot;
    
    // แสดงว่าใครทำอะไรล่าสุด
    // Highlight คนที่ถึงตาเล่น (data.currentTurn)
    const turnText = document.getElementById('turn-indicator');
    if (data.currentTurn === myId) {
        turnText.innerText = "ตาของคุณ!";
        turnText.style.color = "#2ecc71";
    } else {
        turnText.innerText = "รอผู้เล่นอื่น...";
        turnText.style.color = "#fff";
    }
});

socket.on('update_board', (cards) => {
    const slots = document.querySelectorAll('.card-slot');
    cards.forEach((card, index) => {
        if(card) {
            slots[index].innerText = card.rank + " " + card.suit;
            slots[index].className = 'card-slot ' + (['♥','♦'].includes(card.suit) ? 'red-suit' : 'black-suit');
        } else {
            slots[index].innerText = "?";
            slots[index].className = 'card-slot';
        }
    });
});

socket.on('game_over', (data) => {
    showScreen('payment-screen');
    document.getElementById('win-amount').innerText = data.pot;
    document.getElementById('winner-name-display').innerText = "ผู้เล่น ID: " + data.winnerId.substr(0,4); // จริงๆควรส่งชื่อมาด้วย

    if(myId === data.winnerId) {
        document.getElementById('winner-view').classList.remove('hidden');
        document.getElementById('loser-view').classList.add('hidden');
    } else {
        document.getElementById('winner-view').classList.add('hidden');
        document.getElementById('loser-view').classList.remove('hidden');
    }

    if(isHost) document.getElementById('reset-btn').classList.remove('hidden');
});

socket.on('reset_to_lobby', () => {
    showScreen('lobby-screen');
    document.getElementById('payment-screen').classList.add('hidden');
});


// === Functions ===

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function createRoom() {
    myName = document.getElementById('username').value;
    if(!myName) return alert("ใส่ชื่อก่อนครับ");
    socket.emit('create_room', { name: myName });
}

function joinRoom() {
    myName = document.getElementById('username').value;
    const roomCode = document.getElementById('room-code-input').value;
    if(!myName || !roomCode) return alert("ใส่ชื่อและเลขห้องครับ");
    socket.emit('join_room', { name: myName, roomId: roomCode });
}

function startGame() {
    socket.emit('start_game', currentRoom);
}

// --- Game Controls ---
function selectChip(amount) {
    currentBet += amount;
    document.getElementById('selected-bet').innerText = "Bet: " + currentBet;
}

function submitAction(action) {
    let amount = 0;
    if (action === 'bet') {
        amount = currentBet;
    }
    
    socket.emit('place_bet', {
        roomId: currentRoom,
        amount: amount,
        action: action
    });

    // Reset local bet selection
    currentBet = 0;
    document.getElementById('selected-bet').innerText = "Bet: 0";
}

// --- Dealer Controls ---
let currentCardIndex = -1;

function dealerClickCard(index) {
    if(!isHost) return;
    currentCardIndex = index;
    document.getElementById('card-modal').classList.remove('hidden');
}

function confirmCard() {
    const rank = document.getElementById('card-rank').value;
    const suit = document.getElementById('card-suit').value;
    
    socket.emit('update_card', {
        roomId: currentRoom,
        cardIndex: currentCardIndex,
        cardData: { rank, suit }
    });
    
    closeModal('card-modal');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function openWinnerModal() {
    document.getElementById('winner-modal').classList.remove('hidden');
}

function confirmWinner() {
    const winnerId = document.getElementById('winner-select').value;
    socket.emit('end_game', { roomId: currentRoom, winnerId: winnerId });
    closeModal('winner-modal');
}

function resetGame() {
    socket.emit('reset_game', currentRoom);
}

function resetBoardUI() {
    document.querySelectorAll('.card-slot').forEach(c => {
        c.innerText = "?";
        c.className = "card-slot";
    });
    document.getElementById('pot-amount').innerText = "0";
}

// --- Payment ---
function generateQR() {
    const ppId = document.getElementById('pp-id').value;
    // ใช้ API สาธารณะสร้าง QR PromptPay (Format: https://promptpay.io/ID/AMOUNT)
    // หมายเหตุ: ยอดเงินตั้งเป็น 0 เพื่อให้คนสแกนใส่เองได้ หรือจะใส่ยอด pot ก็ได้ แต่ user บอก "เริ่มต้น 0 บาท"
    const url = `https://promptpay.io/${ppId}/0.png`; 
    
    document.getElementById('qr-display').innerHTML = `<img src="${url}" width="200">`;
    
    // (Optional) ส่ง URL นี้ไปให้คนอื่นเห็นด้วยก็ได้ ถ้าต้องการ
}
