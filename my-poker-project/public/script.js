const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'], 
    upgrade: false
});

let myId = '';
let myRole = '';
let currentRoom = '';
let currentBet = 0;
let myRoundBet = 0;

socket.on('connect', () => { myId = socket.id; });

// โดนเตะออกจากห้อง
socket.on('kicked', () => {
    alert("คุณถูกเชิญออกจากห้อง (Kicked)");
    location.reload(); // รีเฟรชหน้าเว็บ
});

socket.on('room_created', (data) => {
    currentRoom = data.roomId;
    myRole = 'dealer';
    showScreen('lobby-screen');
    document.getElementById('display-room-id').innerText = currentRoom;
    document.getElementById('host-controls').classList.remove('hidden');
});

socket.on('room_joined', (data) => {
    currentRoom = data.roomId;
    myRole = 'player';
    showScreen('lobby-screen');
    document.getElementById('display-room-id').innerText = currentRoom;
});

socket.on('update_players', (players) => {
    const list = document.getElementById('player-list');
    const winnerSelect = document.getElementById('winner-select');
    list.innerHTML = '';
    winnerSelect.innerHTML = '';

    players.forEach(p => {
        const li = document.createElement('li');
        li.style.padding = "5px 0";
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        
        let kickBtn = '';
        // ถ้าเราเป็น Dealer และคนนี้ไม่ใช่ Dealer -> โชว์ปุ่มเตะ
        if (myRole === 'dealer' && p.role !== 'dealer') {
            kickBtn = `<button onclick="kickPlayer('${p.id}')" style="background:#c0392b; border:none; color:white; padding:5px 10px; border-radius:5px; cursor:pointer; font-size:12px; margin-left:10px;">❌ เตะ</button>`;
        }

        li.innerHTML = `
            <span style="color:${p.role === 'dealer' ? '#f1c40f' : 'white'}">
                ${p.name} ${p.role === 'dealer' ? '👑' : ''}
            </span>
            ${kickBtn}
        `;
        list.appendChild(li);

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
    myRoundBet = 0;

    if (myRole === 'dealer') {
        document.getElementById('player-controls').classList.add('hidden');
        document.getElementById('dealer-controls').classList.remove('hidden');
    } else {
        document.getElementById('player-controls').classList.remove('hidden');
        document.getElementById('dealer-controls').classList.add('hidden');
    }

    const bbName = data.players.find(p => p.id === data.bigBlindId)?.name || "Unknown";
    const overlay = document.getElementById('big-blind-announce');
    document.getElementById('bb-name').innerText = bbName;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3000);

    // อัปเดตเทิร์นแรกทันที
    checkMyTurn(data.players[data.turnIndex].id);
});

socket.on('update_game_state', (data) => {
    document.getElementById('pot-amount').innerText = data.pot;
    
    if(data.lastActionMsg) {
        document.getElementById('action-log').innerText = data.lastActionMsg;
    }

    if(myRole === 'player') {
        const me = data.playersData.find(p => p.id === myId);
        if (me) myRoundBet = me.roundBet;

        const diff = data.highestBet - myRoundBet;
        const btnCheck = document.getElementById('btn-check');
        const btnCall = document.getElementById('btn-call');

        if (diff > 0) {
            btnCheck.classList.add('hidden');
            btnCall.classList.remove('hidden');
            btnCall.innerText = `ตาม (${diff})`;
        } else {
            btnCheck.classList.remove('hidden');
            btnCall.classList.add('hidden');
        }
    }

    if (myRole === 'dealer' && data.dealerAlert) {
        document.getElementById('dealer-alert-box').classList.remove('hidden');
        setTimeout(() => document.getElementById('dealer-alert-box').classList.add('hidden'), 5000);
    }

    // สำคัญ: รับค่า currentTurn มาเช็คเพื่อปลดล็อคปุ่ม
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
    document.getElementById('game-screen').classList.add('hidden');

    const winnerName = data.playersData.find(p => p.id === data.winnerId)?.name || "Unknown";
    document.getElementById('win-amount').innerText = data.pot;
    document.getElementById('winner-name-display').innerText = winnerName;

    if(myId === data.winnerId) {
        document.getElementById('winner-view').classList.remove('hidden');
        document.getElementById('loser-view').classList.add('hidden');
    } else {
        document.getElementById('winner-view').classList.add('hidden');
        document.getElementById('loser-view').classList.remove('hidden');
        const myData = data.playersData.find(p => p.id === myId);
        const lostAmount = myData ? myData.totalBet : 0;
        document.getElementById('my-loss-amount').innerText = lostAmount;
    }

    if(myRole === 'dealer') document.getElementById('reset-btn').classList.remove('hidden');
    else document.getElementById('reset-btn').classList.add('hidden');
});

socket.on('reset_to_lobby', () => {
    showScreen('lobby-screen');
    document.getElementById('payment-screen').classList.add('hidden');
    document.getElementById('qr-display').innerHTML = '';
    document.getElementById('pp-id').value = '';
});

// --- Functions ---

// ฟังก์ชันเตะคน
function kickPlayer(targetId) {
    if(confirm("ต้องการเตะผู้เล่นคนนี้ออกจากห้องหรือไม่?")) {
        socket.emit('kick_player', { roomId: currentRoom, targetId: targetId });
    }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function createRoom() {
    const name = document.getElementById('username').value;
    if(!name) return alert("กรุณาใส่ชื่อ");
    socket.emit('create_room', { name });
}

function joinRoom() {
    const name = document.getElementById('username').value;
    const roomId = document.getElementById('room-code-input').value;
    if(!name || !roomId) return alert("กรุณาใส่ข้อมูลให้ครบ");
    socket.emit('join_room', { name, roomId });
}

function startGame() { socket.emit('start_game', currentRoom); }

function selectChip(amt) {
    currentBet += amt;
    document.getElementById('selected-bet').innerText = "ยอดที่จะเพิ่ม: " + currentBet;
}

function submitAction(action) {
    let amount = 0;
    if(action === 'bet') {
        if(currentBet === 0) return alert("เลือกชิปก่อนครับ");
        amount = currentBet;
    }
    socket.emit('place_bet', { roomId: currentRoom, amount, action });
    currentBet = 0;
    document.getElementById('selected-bet').innerText = "ยอดที่จะเพิ่ม: 0";
}

let currentCardIndex = -1;
function dealerClickCard(index) {
    if(myRole !== 'dealer') return;
    currentCardIndex = index;
    document.getElementById('card-modal').classList.remove('hidden');
    document.getElementById('dealer-alert-box').classList.add('hidden');
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

function checkMyTurn(turnId) {
    const controls = document.getElementById('player-controls');
    const indicator = document.getElementById('turn-indicator');
    if(myRole === 'dealer') { indicator.innerText = "กำลังเล่น..."; return; }
    
    // ถ้า ID ตรงกับเรา -> ปลดล็อค
    if(turnId === myId) {
        controls.classList.remove('disabled');
        indicator.innerText = "🟢 ตาของคุณ!";
        indicator.style.color = "#2ecc71";
    } else {
        controls.classList.add('disabled');
        indicator.innerText = "🔴 รอเพื่อนเล่น...";
        indicator.style.color = "#e74c3c";
    }
}
function resetBoardUI() {
    document.getElementById('pot-amount').innerText = "0";
    document.querySelectorAll('.card-slot').forEach(s => { s.innerText = "?"; s.className = "card-slot"; });
}
function generateQR() {
    const ppId = document.getElementById('pp-id').value;
    if(!ppId) return alert("ใส่เบอร์ PromptPay ก่อนครับ");
    const url = `https://promptpay.io/${ppId}/0.png`; 
    document.getElementById('qr-display').innerHTML = 
        `<img src="${url}" width="200" style="border:5px solid white; border-radius:10px;">
         <p style="margin-top:5px; color:#f1c40f;">QR นี้เริ่มต้น 0.00 บาท<br>(ให้เพื่อนกรอกยอดเสียของตัวเอง)</p>`;
}
