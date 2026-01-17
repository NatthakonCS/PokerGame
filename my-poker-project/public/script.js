// แก้ไขการเชื่อมต่อสำหรับ Render
const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'], 
    upgrade: false
});

let myId = '';
let myRole = ''; // 'player' หรือ 'dealer'
let currentRoom = '';
let currentBet = 0;

socket.on('connect', () => {
    myId = socket.id;
    console.log("Connected:", myId);
});

socket.on('room_created', (data) => {
    currentRoom = data.roomId;
    myRole = 'dealer'; // คนสร้างห้องเป็น Dealer
    showScreen('lobby-screen');
    document.getElementById('display-room-id').innerText = currentRoom;
    document.getElementById('host-controls').classList.remove('hidden');
});

socket.on('room_joined', (data) => {
    currentRoom = data.roomId;
    myRole = 'player'; // คน join เป็นคนเล่น
    showScreen('lobby-screen');
    document.getElementById('display-room-id').innerText = currentRoom;
});

socket.on('update_players', (players) => {
    const list = document.getElementById('player-list');
    const winnerSelect = document.getElementById('winner-select');
    list.innerHTML = '';
    winnerSelect.innerHTML = '';

    players.forEach(p => {
        // แสดงรายชื่อใน Lobby
        const li = document.createElement('li');
        li.innerText = p.name + (p.role === 'dealer' ? ' (Dealer)' : '');
        list.appendChild(li);

        // ใส่ชื่อใน list ผู้ชนะ (เฉพาะ Player)
        if(p.role === 'player') {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = p.name;
            winnerSelect.appendChild(opt);
        }
    });
});

socket.on('game_started', (data) => {
    showScreen('game-screen');
    resetBoardUI();

    // ตั้งค่าหน้าจอตาม Role
    if (myRole === 'dealer') {
        document.getElementById('player-controls').classList.add('hidden'); // Dealer ไม่เห็นปุ่มลงเงิน
        document.getElementById('dealer-controls').classList.remove('hidden'); // Dealer เห็นปุ่มจบเกม
    } else {
        document.getElementById('player-controls').classList.remove('hidden');
        document.getElementById('dealer-controls').classList.add('hidden');
    }

    // แจ้งเตือน Big Blind
    const bbName = data.players.find(p => p.id === data.bigBlindId)?.name || "Unknown";
    showBigBlindAlert(bbName);

    // อัปเดตสถานะเทิร์นครั้งแรก
    updateTurnUI(data.turnIndex, data.players);
});

socket.on('update_game_state', (data) => {
    document.getElementById('pot-amount').innerText = data.pot;
    
    // แสดงข้อความแจ้งเตือน (ใครทำอะไรล่าสุด)
    if(data.lastActionMsg) {
        document.getElementById('action-log').innerText = data.lastActionMsg;
        // Effect ตัวหนังสือเด้ง
        const log = document.getElementById('action-log');
        log.style.transform = "scale(1.1)";
        setTimeout(() => log.style.transform = "scale(1)", 200);
    }

    // อัปเดตว่าตาใคร
    // เราต้องขอรายชื่อ Player ล่าสุดเพื่อ mapping id แต่ในที่นี้เราใช้ id เช็คตรงๆ
    checkMyTurn(data.currentTurn);
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
    // (ส่วนแสดงชื่อผู้ชนะยังเหมือนเดิม)
    // ... logic payment เดิม ...
    if(isHost()) document.getElementById('reset-btn').classList.remove('hidden');
});

socket.on('reset_to_lobby', () => {
    // กลับไปหน้า Lobby เตรียมเริ่มใหม่
    // แต่เพื่อความง่าย ให้กลับไปหน้า Lobby เลย
    showScreen('lobby-screen');
    document.getElementById('payment-screen').classList.add('hidden');
});

// === Helper Functions ===

function checkMyTurn(currentTurnId) {
    const turnText = document.getElementById('turn-indicator');
    const controls = document.getElementById('player-controls');

    if (myRole === 'dealer') {
        turnText.innerText = "กำลังรอผู้เล่น...";
        return;
    }

    if (currentTurnId === myId) {
        turnText.innerText = "🟢 ตาของคุณ! (Your Turn)";
        turnText.style.color = "#2ecc71";
        controls.classList.remove('disabled-controls'); // ปลดล็อคปุ่ม
    } else {
        turnText.innerText = "🔴 รอเพื่อนเล่น...";
        turnText.style.color = "#e74c3c";
        controls.classList.add('disabled-controls'); // ล็อคปุ่ม
    }
}

function updateTurnUI(turnIndex, players) {
    if(turnIndex === -1) return;
    const turnId = players[turnIndex].id;
    checkMyTurn(turnId);
}

function showBigBlindAlert(name) {
    const el = document.getElementById('big-blind-announce');
    el.innerText = "Big Blind: " + name;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function isHost() { return myRole === 'dealer'; }

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// ... (Function เดิม: createRoom, joinRoom, dealerClickCard, etc. ยังคงเดิม) ...
// ให้ Copy Function เดิมที่เหลือมาใส่ต่อท้ายตรงนี้ได้เลยครับ 
// (เช่น createRoom, joinRoom, startGame, selectChip, submitAction, confirmCard, etc.)

function createRoom() {
    const name = document.getElementById('username').value;
    if(!name) return alert("ใส่ชื่อก่อนครับ");
    socket.emit('create_room', { name });
}

function joinRoom() {
    const name = document.getElementById('username').value;
    const roomId = document.getElementById('room-code-input').value;
    if(!name || !roomId) return alert("ใส่ข้อมูลให้ครบ");
    socket.emit('join_room', { name, roomId });
}

function startGame() { socket.emit('start_game', currentRoom); }

function selectChip(amt) {
    currentBet += amt;
    document.getElementById('selected-bet').innerText = "ยอดที่เลือก: " + currentBet;
}

function submitAction(action) {
    let amount = 0;
    if(action === 'bet') amount = currentBet;
    
    socket.emit('place_bet', { roomId: currentRoom, amount, action });
    
    currentBet = 0;
    document.getElementById('selected-bet').innerText = "ยอดที่เลือก: 0";
}

// Dealer Functions
let currentCardIndex = -1;
function dealerClickCard(index) {
    if(myRole !== 'dealer') return; // กันคนอื่นกด
    currentCardIndex = index;
    document.getElementById('card-modal').classList.remove('hidden');
}

function confirmCard() {
    const rank = document.getElementById('card-rank').value;
    const suit = document.getElementById('card-suit').value;
    socket.emit('update_card', { roomId: currentRoom, cardIndex: currentCardIndex, cardData: { rank, suit } });
    closeModal('card-modal');
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openWinnerModal() { document.getElementById('winner-modal').classList.remove('hidden'); }
function confirmWinner() {
    const winnerId = document.getElementById('winner-select').value;
    socket.emit('end_game', { roomId: currentRoom, winnerId });
    closeModal('winner-modal');
}
function resetGame() { socket.emit('reset_game', currentRoom); }
function resetBoardUI() {
    document.getElementById('pot-amount').innerText = "0";
    document.querySelectorAll('.card-slot').forEach(s => { s.innerText = "?"; s.className = "card-slot"; });
}
function generateQR() {
    // ใส่โค้ด generate QR เดิมที่นี่
    const ppId = document.getElementById('pp-id').value;
    const url = `https://promptpay.io/${ppId}/0.png`; 
    document.getElementById('qr-display').innerHTML = `<img src="${url}" width="200">`;
}
