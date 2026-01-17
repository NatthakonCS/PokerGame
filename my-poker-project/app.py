from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

rooms = {}

@app.route('/')
def index():
    return app.send_static_file('index.html')

# --- Logic หาคนถัดไป (แก้ไขใหม่ให้แม่นยำขึ้น) ---
def get_next_turn(room, current_idx):
    players = room['players']
    count = len(players)
    if count == 0: return -1
    
    # เริ่มเช็คจากคนถัดไป
    check_idx = (current_idx + 1) % count
    
    # วนลูปจนกว่าจะเจอคนที่เล่นได้ (ไม่หมอบ และ ไม่ใช่ Dealer)
    # วนสูงสุดเท่าจำนวนคน เพื่อป้องกัน Loop ไม่รู้จบ
    for _ in range(count):
        p = players[check_idx]
        if p['status'] != 'folded' and p['role'] != 'dealer':
            return check_idx
        check_idx = (check_idx + 1) % count
            
    return -1 # กรณีไม่เหลือใครเล่นแล้ว

@socketio.on('create_room')
def create_room(data):
    room_id = str(random.randint(1000, 9999))
    rooms[room_id] = {
        'host': request.sid,
        'players': [],
        'pot': 0,
        'communityCards': [None]*5,
        'gameStatus': 'waiting',
        'turnIndex': -1,
        'bigBlindPlayer': None,
        'highestBet': 0,
        'actionsCount': 0
    }
    join_room(room_id)
    rooms[room_id]['players'].append({
        'id': request.sid,
        'name': data['name'],
        'role': 'dealer',
        'status': 'dealer_only', 
        'chip': 0,
        'roundBet': 0,
        'totalBet': 0
    })
    emit('room_created', {'roomId': room_id, 'isHost': True})
    socketio.emit('update_players', rooms[room_id]['players'], room=room_id)

@socketio.on('join_room')
def on_join(data):
    room_id = data['roomId']
    if room_id in rooms:
        join_room(room_id)
        rooms[room_id]['players'].append({
            'id': request.sid,
            'name': data['name'],
            'role': 'player',
            'status': 'active',
            'chip': 0,
            'roundBet': 0,
            'totalBet': 0
        })
        emit('room_joined', {'roomId': room_id, 'isHost': False})
        socketio.emit('update_players', rooms[room_id]['players'], room=room_id)
    else:
        emit('error_msg', 'ไม่พบห้องนี้')

# --- ฟีเจอร์เตะคน (Kick Player) ---
@socketio.on('kick_player')
def kick_player(data):
    room_id = data['roomId']
    target_id = data['targetId']
    
    if room_id in rooms:
        room = rooms[room_id]
        # ตรวจสอบว่าคนกดเตะคือ Host จริงไหม
        if request.sid != room['host']:
            return
        
        # หาชื่อคนโดนเตะ เพื่อแจ้งเตือน
        target_player = next((p for p in room['players'] if p['id'] == target_id), None)
        
        # ลบออกจาก List
        room['players'] = [p for p in room['players'] if p['id'] != target_id]
        
        # สั่งให้ Socket นั้นออกจากห้อง
        socketio.emit('kicked', room=target_id) # ส่ง event ไปหาคนโดนเตะเฉพาะตัว
        
        # อัปเดตรายชื่อให้คนในห้องเห็น
        socketio.emit('update_players', room['players'], room=room_id)

@socketio.on('start_game')
def start_game(room_id):
    if room_id not in rooms: return
    room = rooms[room_id]
    players = room['players']
    active_players = [p for p in players if p['role'] == 'player']
    
    if len(active_players) < 2: return 

    # รีเซ็ตค่าเริ่มต้น
    for p in players:
        if p['role'] == 'player':
            p['status'] = 'active'
            p['roundBet'] = 0
            p['totalBet'] = 0

    # สุ่ม Big Blind
    bb_player = random.choice(active_players)
    room['bigBlindPlayer'] = bb_player['id']
    
    # หา Index ของ Big Blind เพื่อเริ่มเล่นที่คนนี้
    bb_index = next((i for i, p in enumerate(players) if p['id'] == bb_player['id']), 0)
    
    room['turnIndex'] = bb_index
    room['gameStatus'] = 'playing'
    room['pot'] = 0
    room['highestBet'] = 0
    room['actionsCount'] = 0 
    room['communityCards'] = [None]*5
    
    socketio.emit('game_started', {
        'bigBlindId': room['bigBlindPlayer'],
        'players': room['players'],
        'turnIndex': room['turnIndex']
    }, room=room_id)

@socketio.on('place_bet')
def place_bet(data):
    room_id = data['roomId']
    if room_id not in rooms: return
    room = rooms[room_id]
    
    # ป้องกัน Index Out of Range
    if room['turnIndex'] >= len(room['players']):
        room['turnIndex'] = 0
        
    current_player = room['players'][room['turnIndex']]

    # Security Check: ใช่ตาของคนนี้จริงไหม?
    if request.sid != current_player['id']: return

    amount = int(data['amount'])
    action = data['action']
    msg = ""
    
    # --- Logic Action ---
    if action == 'fold':
        current_player['status'] = 'folded'
        msg = f"{current_player['name']} หมอบ (Fold) 🏳️"
    
    elif action == 'check':
        msg = f"{current_player['name']} ผ่าน (Check)"
    
    elif action == 'call':
        diff = room['highestBet'] - current_player['roundBet']
        if diff > 0:
            room['pot'] += diff
            current_player['roundBet'] += diff
            current_player['totalBet'] += diff
            amount = diff
        msg = f"{current_player['name']} ตาม (Call) {amount} 💰"

    elif action == 'bet':
        room['pot'] += amount
        current_player['roundBet'] += amount
        current_player['totalBet'] += amount
        
        # ถ้าลงมากกว่าสูงสุดเดิม ให้ update
        if current_player['roundBet'] > room['highestBet']:
            room['highestBet'] = current_player['roundBet']
        msg = f"{current_player['name']} ลงเพิ่ม {amount} 💰"

    # นับจำนวนคนเล่นในรอบ
    room['actionsCount'] += 1
    
    # หาคนถัดไปทันที
    next_idx = get_next_turn(room, room['turnIndex'])
    
    if next_idx != -1:
        room['turnIndex'] = next_idx
        next_id = room['players'][next_idx]['id']
    else:
        next_id = None # จบเกม หรือ เหลือคนเดียว

    # เช็คว่าควรเตือน Dealer ไหม
    dealer_alert = False
    active_players_count = len([p for p in room['players'] if p['role'] == 'player' and p['status'] != 'folded'])
    if room['actionsCount'] >= active_players_count:
        dealer_alert = True
        room['actionsCount'] = 0 

    socketio.emit('update_game_state', {
        'pot': room['pot'],
        'lastActionMsg': msg,
        'currentTurn': next_id, # ส่ง ID คนถัดไป เพื่อปลดล็อคปุ่ม
        'highestBet': room['highestBet'],
        'dealerAlert': dealer_alert,
        'playersData': room['players']
    }, room=room_id)

@socketio.on('update_card')
def update_card(data):
    room_id = data['roomId']
    if room_id in rooms:
        rooms[room_id]['communityCards'][data['cardIndex']] = data['cardData']
        socketio.emit('update_board', rooms[room_id]['communityCards'], room=room_id)

@socketio.on('end_game')
def end_game(data):
    room_id = data['roomId']
    if room_id in rooms:
        socketio.emit('game_over', {
            'winnerId': data['winnerId'],
            'pot': rooms[room_id]['pot'],
            'playersData': rooms[room_id]['players'] 
        }, room=room_id)

@socketio.on('reset_game')
def reset_game(room_id):
    if room_id in rooms:
        rooms[room_id]['pot'] = 0
        rooms[room_id]['highestBet'] = 0
        rooms[room_id]['actionsCount'] = 0
        rooms[room_id]['communityCards'] = [None]*5
        rooms[room_id]['gameStatus'] = 'waiting'
        socketio.emit('reset_to_lobby', room=room_id)

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)
