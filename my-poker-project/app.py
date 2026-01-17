from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
import random
import string

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# เก็บข้อมูลห้อง (ใช้ Dict ในหน่วยความจำ)
rooms = {}

# Route สำหรับหน้าเว็บ
@app.route('/')
def index():
    # ให้ชี้ไปที่ไฟล์ index.html ในโฟลเดอร์ public
    return app.send_static_file('index.html')

# === Socket Events ===

@socketio.on('connect')
def handle_connect():
    print(f'User connected: {request.sid}')

@socketio.on('create_room')
def create_room(data):
    room_id = str(random.randint(1000, 9999))
    rooms[room_id] = {
        'host': request.sid,
        'players': [],
        'pot': 0,
        'communityCards': [None]*5,
        'gameStatus': 'waiting',
        'turnIndex': 0,
        'bigBlindPlayer': None
    }
    join_room(room_id)
    # เพิ่ม Host
    rooms[room_id]['players'].append({
        'id': request.sid,
        'name': data['name'],
        'role': 'host',
        'chip': 0
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
    
    # สุ่ม Big Blind
    idx = random.randint(0, len(room['players']) - 1)
    room['bigBlindPlayer'] = room['players'][idx]['id']
    room['turnIndex'] = idx
    room['gameStatus'] = 'playing'
    room['pot'] = 0
    room['communityCards'] = [None]*5
    
    socketio.emit('game_started', {
        'bigBlindId': room['bigBlindPlayer'],
        'players': room['players']
    }, room=room_id)

@socketio.on('place_bet')
def place_bet(data):
    room_id = data['roomId']
    amount = int(data['amount'])
    action = data['action']
    
    if room_id not in rooms: return
    room = rooms[room_id]
    
    if amount > 0:
        room['pot'] += amount
        
    # วน Turn
    room['turnIndex'] = (room['turnIndex'] + 1) % len(room['players'])
    
    socketio.emit('update_game_state', {
        'pot': room['pot'],
        'lastAction': {'player': request.sid, 'action': action, 'amount': amount},
        'currentTurn': room['players'][room['turnIndex']]['id']
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
