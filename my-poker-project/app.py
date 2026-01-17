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

# Helper: หาคนเล่นคนถัดไป (ข้าม Dealer และ คนหมอบ)
def get_next_turn(room, current_idx):
    players = room['players']
    count = len(players)
    next_idx = (current_idx + 1) % count
    
    # วนลูปหาคนถัดไปที่สถานะ active และไม่ใช่ dealer
    # ป้องกัน Infinite loop ด้วยการเช็คว่าวนกลับมาที่เดิมไหม
    start_idx = next_idx
    while players[next_idx]['status'] == 'folded' or players[next_idx]['role'] == 'dealer':
        next_idx = (next_idx + 1) % count
        if next_idx == start_idx: # กรณีเหลือคนเดียว หรือไม่มีใครเล่นได้
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
        'bigBlindPlayer': None
    }
    join_room(room_id)
    # Host คือ Dealer (status: 'dealer_only') ไม่นับว่าเป็นผู้เล่นที่ลงเงินได้
    rooms[room_id]['players'].append({
        'id': request.sid,
        'name': data['name'],
        'role': 'dealer',
        'status': 'dealer_only', 
        'chip': 0
    })
    
    emit('room_created', {'roomId': room_id, 'isHost': True})
    socketio.emit('update_players', rooms[room_id]['players'], room=room_id)

@socketio.on('join_room')
def on_join(data):
    room_id = data['roomId']
    if room_id in rooms:
        join_room(room_id)
        # คน join คือ Player (status: 'active')
        rooms[room_id]['players'].append({
            'id': request.sid,
            'name': data['name'],
            'role': 'player',
            'status': 'active',
            'chip': 0
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
    
    if len(active_players) < 2:
        return # ต้องมีผู้เล่นอย่างน้อย 2 คน (ไม่รวม Dealer)

    # Reset Status ของผู้เล่นทุกคนให้เป็น active
    for p in players:
        if p['role'] == 'player':
            p['status'] = 'active'

    # สุ่ม Big Blind จากคนที่เป็น Player เท่านั้น
    bb_player = random.choice(active_players)
    room['bigBlindPlayer'] = bb_player['id']
    
    # หา Index ของ Big Blind ใน list หลัก
    bb_index = next((i for i, p in enumerate(players) if p['id'] == bb_player['id']), 0)
    
    room['turnIndex'] = bb_index
    room['gameStatus'] = 'playing'
    room['pot'] = 0
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

    # 1. เช็คว่าใช่ตาตัวเองจริงๆ ไหม (Server Validation)
    if request.sid != current_player['id']:
        return # ถ้าไม่ใช่ตาตัวเอง อย่าทำอะไร

    amount = int(data['amount'])
    action = data['action']
    
    # Update Pot
    if amount > 0:
        room['pot'] += amount

    # Handle Actions
    msg = ""
    if action == 'fold':
        current_player['status'] = 'folded'
        msg = f"{current_player['name']} หมอบแล้ว (Fold) 🏳️"
    elif action == 'check':
        msg = f"{current_player['name']} ผ่าน (Check)"
    elif action == 'bet':
        msg = f"{current_player['name']} ลงเงิน {amount} ชิป 💰"

    # หาตาคนถัดไป
    next_idx = get_next_turn(room, room['turnIndex'])
    if next_idx != -1:
        room['turnIndex'] = next_idx
        next_id = room['players'][next_idx]['id']
    else:
        # กรณีเหลือคนเดียวชนะเลย (อาจจะเพิ่ม logic นี้ทีหลัง)
        next_id = None

    socketio.emit('update_game_state', {
        'pot': room['pot'],
        'lastActionMsg': msg,
        'currentTurn': next_id
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
            'pot': rooms[room_id]['pot']
        }, room=room_id)

@socketio.on('reset_game')
def reset_game(room_id):
    if room_id in rooms:
        rooms[room_id]['pot'] = 0
        rooms[room_id]['communityCards'] = [None]*5
        rooms[room_id]['gameStatus'] = 'waiting'
        socketio.emit('reset_to_lobby', room=room_id)

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)
