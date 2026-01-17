// แก้ไขการเชื่อมต่อสำหรับ Render
const socket = io(window.location.origin, {
    transports: ['websocket', 'polling'], 
    upgrade: false
});

let myId = '';
let myRole = '';
let currentRoom = '';
let currentBet = 0; // เงินที่เลือกจะเพิ่ม (Raise)
let myRoundBet = 0; // เงินที่เราลงไปแล้วในรอบนี้

socket.on('connect', () => {
    myId = socket.id;
    console.log("Connected:", myId);
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
        li.innerText = p.name + (p.role === 'dealer' ? ' (Dealer)' : '');
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
    showBigBlindAlert(bbName);
    updateTurnUI(data.turnIndex, data.players);
});

socket.on('update_game_state', (data) => {
    // อัปเดตยอด Pot
    document.getElementById('pot-amount').innerText = data.pot;
    
    // แจ้งเตือนข้อความการกระทำ
    if(data.lastActionMsg) {
        document.getElementById('action-log').innerText = data.lastActionMsg;
        const log = document.getElementById('action-log');
        log.style.transform = "scale(1.1)";
        setTimeout(() => log.style.transform = "scale(1)", 200);
    }

    // --- Logic ปุ่ม "ตาม" (Call) ---
    if(myRole === 'player') {
        // หาข้อมูลตัวเองจาก playersData ที่ส่งมา
        const me = data.playersData.find(p => p.id === myId);
        if (me) {
            myRoundBet = me.roundBet; // อัปเดตยอดเงินที่ลงไปแล้วจริงๆ จาก Server
        }

        const highestBet = data.highestBet;
        const diff = highestBet - myRoundBet;

        const btnCheck = document.getElementById('btn-check');
        const btnCall = document.getElementById('btn-call');
        const callAmountDisplay = document.getElementById('call-amount-display');

        if (diff > 0) {
            // ถ้ามีคนลงมากกว่าเรา -> ต้อง "ตาม" (Call)
            btnCheck.classList.add('hidden');
            btnCall.classList.remove('hidden');
            callAmountDisplay.innerText = `(${diff})`;
        } else {
            // ถ้าไม่มีใครลงมากกว่า -> "ผ่าน" (Check) ได้
            btnCheck.classList.remove('hidden');
            btnCall.classList.add('hidden');
        }
    }

    // --- แจ้งเตือน Dealer (ให้เปิดไพ่) ---
    if (myRole === 'dealer' && data.dealerAlert) {
        const alertBox = document.getElementById('dealer-alert-box');
        alertBox.classList.remove('hidden');
        // ซ่อนอัตโนมัติหลัง 5 วิ
        setTimeout(() => alertBox.classList.add('hidden'), 5000);
    }

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
    // บังคับโชว์หน้า Payment ทันที
    showScreen('payment-screen');
    
    // ซ่อน Game Screen เพื่อไม่ให้สับสน
    document.getElementById('game-screen').classList.add('hidden');

    const winAmountSpan = document.getElementById('win-amount');
    const winnerNameSpan = document.getElementById('winner-name-display');
    const winnerView = document.getElementById('winner-view');
    const loserView = document.getElementById('loser-view');
    const resetBtn = document.getElementById('reset-btn');

    // แสดงยอดเงิน
    winAmountSpan.innerText = data.pot;

    if(myId === data.winnerId) {
        // ถ้าเราชนะ
        winnerView.classList.remove('hidden');
        loserView.classList.add('hidden');
    } else {
        // ถ้าเราแพ้ (ต้องหาชื่อผู้ชนะมาแสดง)
        // เนื่องจาก data.winnerId เป็น ID เราต้องหาชื่อ (แต่ server ส่งมาแค่ ID ในรอบนี้ เพื่อความง่ายจะแสดง ID หรือต้องแก้ Server ให้ส่งชื่อมาด้วย)
        // **แก้ไขด่วน:** ให้แสดงแค่ "ผู้เล่นอื่นชนะ" หรือ ID ไปก่อน
        winnerNameSpan.innerText = "ผู้เล่นอื่น (ID: " + data.winnerId.substr(0,4) + ")"; 
        
        winnerView.classList.add('hidden');
        loserView.classList.remove('hidden');
    }

    // ปุ่ม Reset ให้เฉพาะ Dealer เห็น
    if(isHost()) {
        resetBtn.classList.remove('hidden');
    } else {
        resetBtn.classList.add('hidden');
    }
});

socket.on('reset_to_lobby', () => {
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
        controls.classList.remove('disabled-controls');
    } else {
        turnText.innerText = "🔴 รอเพื่อนเล่น...";
        turnText.style.color = "#e74c3c";
        controls.classList.add('disabled-controls');
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
    document.getElementById('selected-bet').innerText = "ยอดที่เพิ่ม: " + currentBet;
}

function submitAction(action) {
    let amount = 0;
    
    // ถ้า Raise (ลงเพิ่ม) ให้ใช้ยอด currentBet
    if(action === 'bet') {
        if(currentBet === 0) return alert("กรุณาเลือกชิปก่อนลงเงินเพิ่ม");
        amount = currentBet;
    }
    
    // ถ้า Call (ตาม) ระบบ Server จะคำนวณส่วนต่างเอง เราส่งแค่ action
    // ถ้า Check / Fold ไม่ต้องส่ง amount

    socket.emit('place_bet', { roomId: currentRoom, amount, action });
    
    currentBet = 0;
    document.getElementById('selected-bet').innerText = "ยอดที่เพิ่ม: 0";
}

let currentCardIndex = -1;
function dealerClickCard(index) {
    if(myRole !== 'dealer') return;
    currentCardIndex = index;
    document.getElementById('card-modal').classList.remove('hidden');
    // ซ่อนแจ้งเตือน (ถ้ามี)
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
function resetBoardUI() {
    document.getElementById('pot-amount').innerText = "0";
    document.querySelectorAll('.card-slot').forEach(s => { s.innerText = "?"; s.className = "card-slot"; });
    document.getElementById('dealer-alert-box').classList.add('hidden');
}
function generateQR() {
    const ppId = document.getElementById('pp-id').value;
    const amount = document.getElementById('win-amount').innerText; // ดึงยอดเงินจริง
    const url = `https://promptpay.io/${ppId}/${amount}.png`; // สร้าง QR ตามยอดเงินจริง
    
    document.getElementById('qr-display').innerHTML = `<img src="${url}" width="200" style="border:5px solid white; border-radius:10px;">`;
}
