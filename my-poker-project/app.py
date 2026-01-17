from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
import random
import string

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

rooms = {}

@app.route('/')
def index():
    return app.send_static_file('index.html')

def get_next_turn(room, current_idx):
    players = room['players']
    count = len(players)
    if count == 0: return -1
    
    next_idx = (current_idx + 1) % count
    start_idx = next_idx
    
    # วนหาคนถัดไปที่ไม่ใช่ Dealer และยังไม่หมอบ
    while players[next_idx]['status'] == 'folded' or players[next_idx]['role'] == 'dealer':
        next_idx = (next_idx + 1) % count
        if next_idx == start_idx: 
            return -1 
            
    return next_idx

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
        'highestBet': 0,      # เก็บยอดเดิมพันสูงสุดในรอบ
        'actionsCount': 0     # นับจำนวนคนเล่นในรอบนี้
    }
    join_room(room_id)
    rooms[room_id]['players'].append({
        'id': request.sid,
        'name': data['name'],
        'role': 'dealer',
        'status': 'dealer_only', 
        'chip': 0,
        'roundBet': 0 # เงินที่ลงในรอบนี้
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
            'roundBet': 0
        })
        emit('room_joined', {'roomId': room_id, 'isHost': False})
        socketio.emit('update_players', rooms[room_id]['players'], room=room_id)
    else:
        emit('error_msg', 'ไม่พบห้องนี้')

@socketio.on('start_game')
def start_game(room_id):
    if room_id not in rooms: return
    room = rooms[room_id]
    
    players = room['players']
    active_players = [p for p in players if p['role'] == 'player']
    if len(active_players) < 2: return 

    for p in players:
        if p['role'] == 'player':
            p['status'] = 'active'
            p['roundBet'] = 0

    bb_player = random.choice(active_players)
    room['bigBlindPlayer'] = bb_player['id']
    bb_index = next((i for i, p in enumerate(players) if p['id'] == bb_player['id']), 0)
    
    room['turnIndex'] = bb_index
    room['gameStatus'] = 'playing'
    room['pot'] = 0
    room['highestBet'] = 0 # เริ่มต้นไม่มีใครลงเงิน
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
    current_player = room['players'][room['turnIndex']]

    if request.sid != current_player['id']: return

    amount = int(data['amount'])
    action = data['action']
    
    msg = ""
    
    # Logic การลงเงิน
    if action == 'fold':
        current_player['status'] = 'folded'
        msg = f"{current_player['name']} หมอบ (Fold) 🏳️"
    
    elif action == 'check':
        msg = f"{current_player['name']} ผ่าน (Check)"
    
    elif action == 'call':
        # "ตาม" คือต้องลงเงินเพิ่มให้เท่ากับ highestBet
        diff = room['highestBet'] - current_player['roundBet']
        if diff > 0:
            room['pot'] += diff
            current_player['roundBet'] += diff
            amount = diff # ส่งกลับไปบอกว่าลงจริงเท่าไหร่
        msg = f"{current_player['name']} ตาม (Call) {amount} 💰"

    elif action == 'bet':
        # ลงเงินเพิ่ม (Raise)
        room['pot'] += amount
        current_player['roundBet'] += amount
        
        # อัปเดตยอดสูงสุดของห้อง
        if current_player['roundBet'] > room['highestBet']:
            room['highestBet'] = current_player['roundBet']
            
        msg = f"{current_player['name']} ลงเงินเพิ่ม {amount} 💰"

    # นับจำนวนคนเล่น
    room['actionsCount'] += 1
    active_players_count = len([p for p in room['players'] if p['role'] == 'player' and p['status'] != 'folded'])

    # หาคนถัดไป
    next_idx = get_next_turn(room, room['turnIndex'])
    if next_idx != -1:
        room['turnIndex'] = next_idx
        next_id = room['players'][next_idx]['id']
    else:
        next_id = None

    # เช็คว่าควรเตือน Dealer ไหม (เล่นครบทุกคนในรอบ หรือ วนมาครบ)
    # Logic ง่ายๆ: ถ้านับจำนวนครั้งที่เล่น >= จำนวนคนเล่นที่เหลืออยู่ แสดงว่าน่าจะครบแล้ว
    dealer_alert = False
    if room['actionsCount'] >= active_players_count:
        dealer_alert = True
        room['actionsCount'] = 0 # รีเซ็ตนับรอบใหม่ (สำหรับการเปิดไพ่ใบต่อไป)

    socketio.emit('update_game_state', {
        'pot': room['pot'],
        'lastActionMsg': msg,
        'currentTurn': next_id,
        'highestBet': room['highestBet'], # ส่งค่าเดิมพันสูงสุดไปให้หน้าเว็บคำนวณปุ่ม "ตาม"
        'dealerAlert': dealer_alert,       # ส่งสัญญาณเตือน Dealer
        'playersData': room['players']     # ส่งข้อมูลผู้เล่น (เพื่อเช็คว่าใครลงไปเท่าไหร่แล้ว)
    }, room=room_id)

@socketio.on('update_card')
def update_card(data):
    room_id = data['roomId']
    if room_id in rooms:
        rooms[room_id]['communityCards'][data['cardIndex']] = data['cardData']
        # พอ Dealer เปิดไพ่ ให้รีเซ็ตยอดเดิมพันรอบใหม่ (optional: ตามกติกา Poker จริง)
        # แต่เอาแบบง่ายๆ คือแค่แสดงผล
        socketio.emit('update_board', rooms[room_id]['communityCards'], room=room_id)

@socketio.on('end_game')
def end_game(data):
    room_id = data['roomId']
    if room_id in rooms:
        socketio.emit('game_over', {
            'winnerId': data['winnerId'],
            'pot': rooms[room_id]['pot']
        }, room=room_id)

@socketio.on('reset_game')
def reset_game(room_id):
    if room_id in rooms:
        # Reset ค่าต่างๆ
        rooms[room_id]['pot'] = 0
        rooms[room_id]['highestBet'] = 0
        rooms[room_id]['actionsCount'] = 0
        rooms[room_id]['communityCards'] = [None]*5
        rooms[room_id]['gameStatus'] = 'waiting'
        socketio.emit('reset_to_lobby', room=room_id)

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)
