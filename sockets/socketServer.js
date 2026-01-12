// sockets/socketServer.js - CRITICAL FIX: Missing io.on
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { pool } from '../databaseconfig.js';

let io;
const connectedUsers = new Map();
const videoRooms = new Map();

// Enhanced authentication middleware
async function authenticateSocket(socket, next) {
  try {
    console.log(`[Socket Auth] Starting authentication for socket: ${socket.id}`);
    
    const token = socket.handshake.auth.token;
    if (!token || token === 'null' || token === 'undefined') {
      console.error('[Socket Auth] No token provided');
      return next(new Error('Authentication token required'));
    }

    if (!process.env.DB_JWT_SECRET) {
      console.error('[Socket Auth] JWT_SECRET not configured');
      return next(new Error('Server configuration error'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.DB_JWT_SECRET);
    } catch (jwtError) {
      console.error(`[Socket Auth] JWT verification failed: ${jwtError.message}`);
      return next(new Error('Invalid or expired token'));
    }
    
    console.log(`[Socket Auth] JWT decoded successfully: ${JSON.stringify({ id: decoded.id, role: decoded.role })}`);
    
    const userId = decoded.id;
    
    // Fetch user details with proper role detection
    let userInfo = null;
    
    const [doctorResult] = await pool.execute(
      'SELECT id, name, email FROM docinfo WHERE id = ?',
      [userId]
    );

    if (doctorResult.length > 0) {
      const doctor = doctorResult[0];
      userInfo = {
        id: doctor.id,
        name: doctor.name,
        email: doctor.email,
        role: 'doctor'
      };
      console.log(`[Socket Auth] Found doctor: ${userInfo.name} (${userInfo.id})`);
    } else {
      const [userResult] = await pool.execute(
        'SELECT id, Name as name, Email as email FROM users WHERE id = ?',
        [userId]
      );

      if (userResult.length === 0) {
        console.error(`[Socket Auth] User not found in database: ${userId}`);
        return next(new Error('User not found'));
      }

      const user = userResult[0];
      userInfo = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'client'
      };
      console.log(`[Socket Auth] Found client: ${userInfo.name} (${userInfo.id})`);
    }

    socket.userId = userInfo.id;
    socket.userInfo = userInfo;
    socket.decoded = userInfo;

    console.log(`[Socket Auth] Authentication successful for ${userInfo.name} (${userInfo.role})`);
    next();
  } catch (error) {
    console.error(`[Socket Auth] Authentication error: ${error.message}`);
    return next(new Error('Authentication failed: ' + error.message));
  }
}

// ✅ FIXED: Simplified connection tracking
function updateUserConnection(userId, socketId, userInfo, status) {
  const numericUserId = parseInt(userId);
  console.log(`[Socket] 🔄 Updating connection for user ${numericUserId} (${userInfo.name}): ${status}`);
  
  if (status === 'online') {
    connectedUsers.set(numericUserId, {
      socketId,
      userInfo,
      lastPing: Date.now(),
      connectedAt: new Date()
    });
    
    console.log(`[Socket] ✅ User ${numericUserId} added to connectedUsers`);
    console.log(`[Socket] 📊 Total connected users: ${connectedUsers.size}`);
    console.log(`[Socket] 👥 Connected user IDs: [${Array.from(connectedUsers.keys()).join(', ')}]`);
  } else {
    if (connectedUsers.has(numericUserId)) {
      connectedUsers.delete(numericUserId);
      console.log(`[Socket] ❌ User ${numericUserId} removed from connectedUsers`);
      console.log(`[Socket] 📊 Total connected users: ${connectedUsers.size}`);
    }
  }
}

function isUserOnline(userId) {
  try {
    const numericUserId = parseInt(userId);
    const user = connectedUsers.get(numericUserId);
    
    if (!user) {
      console.log(`[Socket] User ${numericUserId} not found in connectedUsers`);
      return false;
    }
    
    if (!io) {
      console.warn('[Socket] IO not initialized');
      return false;
    }
    
    const socket = io.sockets.sockets.get(user.socketId);
    const isConnected = socket && socket.connected;
    const recentPing = Date.now() - user.lastPing < 120000;
    
    if (isConnected && recentPing) {
      return true;
    } else {
      console.log(`[Socket] Cleaning up stale connection for user ${numericUserId}`);
      connectedUsers.delete(numericUserId);
      return false;
    }
    
  } catch (error) {
    console.error(`[Socket] Error checking user ${userId} online status:`, error);
    return false;
  }
}

function emitToUser(userId, event, data) {
  try {
    const numericUserId = parseInt(userId);
    console.log(`[Socket] 📤 Attempting to emit "${event}" to user ${numericUserId}`);
    
    const user = connectedUsers.get(numericUserId);
    if (!user) {
      console.log(`[Socket] ❌ User ${numericUserId} not found in connectedUsers`);
      console.log(`[Socket] Current online users: [${Array.from(connectedUsers.keys()).join(', ')}]`);
      return false;
    }
    
    if (!io) {
      console.error('[Socket] IO not initialized');
      return false;
    }
    
    const socket = io.sockets.sockets.get(user.socketId);
    if (!socket || !socket.connected) {
      console.log(`[Socket] ❌ Socket not connected for user ${numericUserId}`);
      connectedUsers.delete(numericUserId);
      return false;
    }
    
    console.log(`[Socket] ✅ Emitting "${event}" to ${user.userInfo.name} (${numericUserId}) on socket ${user.socketId}`);
    socket.emit(event, data);
    return true;
    
  } catch (error) {
    console.error(`[Socket] ❌ Error emitting to user ${userId}:`, error);
    return false;
  }
}

function getOnlineUsers() {
  const onlineUsers = [];
  for (const [userId, user] of connectedUsers.entries()) {
    if (isUserOnline(userId)) {
      onlineUsers.push({
        id: userId,
        name: user.userInfo.name,
        role: user.userInfo.role,
        socketId: user.socketId,
        lastPing: user.lastPing,
        connectedAt: user.connectedAt
      });
    }
  }
  return onlineUsers;
}

// ✅ CRITICAL FIX: Initialize socket server
export const initializeSocketServer = (ioInstance) => {
  if (io) {
    console.log('[Socket] ⚠️ Socket server already initialized');
    return io;
  }

  io = ioInstance;
  console.log('[Socket] 🚀 Initializing socket server...');

  io.use(authenticateSocket);

  // ✅ CRITICAL FIX: THIS WAS THE BUG - Missing "io.on"
  io.on('connection', async (socket) => {
    console.log(`[Socket] 🟢 NEW CONNECTION: ${socket.userInfo.name} (ID: ${socket.userInfo.id}, Socket: ${socket.id})`);
    
    // ✅ CRITICAL: Update connectedUsers IMMEDIATELY
    updateUserConnection(socket.userId, socket.id, socket.userInfo, 'online');
    
    // Update database
    try {
      await pool.execute(
        `INSERT INTO user_connections (user_id, socket_id, role, last_seen, status)
         VALUES (?, ?, ?, NOW(), 'online')
         ON DUPLICATE KEY UPDATE
         socket_id = VALUES(socket_id),
         last_seen = NOW(),
         status = 'online'`,
        [socket.userId, socket.id, socket.userInfo.role]
      );
      console.log(`[Socket] ✅ Database updated for user ${socket.userId}`);
    } catch (dbError) {
      console.error(`[Socket] ❌ Database update failed:`, dbError);
    }

    // Ping handler
    socket.on('ping', (timestamp, callback) => {
      const user = connectedUsers.get(parseInt(socket.userId));
      if (user) {
        user.lastPing = Date.now();
      }
      
      pool.execute(
        'UPDATE user_connections SET last_seen = NOW() WHERE user_id = ?',
        [socket.userId]
      ).catch(console.error);
      
      if (callback && typeof callback === 'function') {
        callback(timestamp);
      }
    });

    // Call response handler
    socket.on('respond-to-call', async (data) => {
      try {
        console.log(`[Socket] Call response from ${socket.userInfo.name}:`, data);
        
        const { callId, response, roomId } = data;
        
        if (!callId || !response) {
          socket.emit('call-error', { error: 'Invalid call response data' });
          return;
        }
        
        const [callInfo] = await pool.execute(
          'SELECT * FROM active_calls WHERE id = ? AND receiver_id = ? AND status = "pending"',
          [callId, socket.userId]
        );

        if (callInfo.length === 0) {
          socket.emit('call-error', { error: 'Call not found or already handled' });
          return;
        }

        const call = callInfo[0];
        
        if (response === 'accepted') {
          await pool.execute(
            'UPDATE active_calls SET status = "active", accepted_at = NOW() WHERE id = ?',
            [callId]
          );

          await pool.execute(
            'INSERT INTO call_history (room_id, caller_id, receiver_id, call_status, start_time) VALUES (?, ?, ?, "active", NOW())',
            [call.room_id, call.caller_id, call.receiver_id]
          );

          const notifySuccess = emitToUser(call.caller_id, 'call-accepted', { 
            roomId: call.room_id, 
            callId,
            receiver: {
              id: socket.userId,
              name: socket.userInfo.name,
              role: socket.userInfo.role
            }
          });
          
          if (notifySuccess) {
            socket.emit('call-accepted', { roomId: call.room_id, callId });
            console.log(`[Socket] ✅ Call ${callId} accepted successfully`);
          } else {
            console.error(`[Socket] ❌ Failed to notify caller of acceptance`);
            socket.emit('call-error', { error: 'Failed to notify caller' });
          }
          
        } else if (response === 'rejected') {
          await pool.execute(
            'UPDATE active_calls SET status = "rejected", rejected_at = NOW() WHERE id = ?',
            [callId]
          );

          await pool.execute(
            'INSERT INTO call_history (room_id, caller_id, receiver_id, call_status, start_time, end_time) VALUES (?, ?, ?, "rejected", NOW(), NOW())',
            [call.room_id, call.caller_id, call.receiver_id]
          );

          emitToUser(call.caller_id, 'call-rejected', { callId });
          console.log(`[Socket] Call ${callId} rejected`);
        }

      } catch (error) {
        console.error('[Socket] Error handling call response:', error);
        socket.emit('call-error', { error: 'Failed to process call response' });
      }
    });

    // Video room handlers
    socket.on('join-video-room', (data) => {
      try {
        const { roomId } = data;
        
        if (!roomId) {
          socket.emit('room-error', { error: 'Room ID is required' });
          return;
        }
        
        console.log(`[VideoRoom] User ${socket.userInfo.name} joining room ${roomId}`);
        
        if (!videoRooms.has(roomId)) {
          videoRooms.set(roomId, new Map());
        }
        
        const room = videoRooms.get(roomId);
        room.set(socket.userId, {
          socketId: socket.id,
          userName: socket.userInfo.name,
          userRole: socket.userInfo.role,
          userId: socket.userId,
          joinedAt: new Date()
        });
        
        const participants = Array.from(room.values());
        console.log(`[VideoRoom] Room ${roomId} now has ${participants.length} participants`);
        
        // Notify other participants
        participants.forEach(participant => {
          if (participant.userId !== socket.userId) {
            emitToUser(participant.userId, 'user-joined-room', {
              userId: socket.userId,
              userName: socket.userInfo.name,
              userRole: socket.userInfo.role,
              socketId: socket.id,
              roomId
            });
          }
        });
        
        const otherParticipants = participants.filter(p => p.userId !== socket.userId);
        socket.emit('room-users', otherParticipants);
        
      } catch (error) {
        console.error('[VideoRoom] Error joining room:', error);
        socket.emit('room-error', { error: 'Failed to join room' });
      }
    });

    socket.on('leave-video-room', (data) => {
      try {
        const { roomId } = data;
        if (!roomId || !videoRooms.has(roomId)) return;
        
        const room = videoRooms.get(roomId);
        room.delete(socket.userId);
        
        const remainingParticipants = Array.from(room.values());
        
        if (room.size === 0) {
          videoRooms.delete(roomId);
        }
        
        remainingParticipants.forEach(participant => {
          emitToUser(participant.userId, 'user-left-room', {
            userId: socket.userId,
            userName: socket.userInfo.name,
            socketId: socket.id,
            roomId
          });
        });
        
      } catch (error) {
        console.error('[VideoRoom] Error leaving room:', error);
      }
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
      const { signal, targetSocketId } = data;
      if (!signal || !targetSocketId) return;
      
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket && targetSocket.connected) {
        targetSocket.emit('offer', {
          signal,
          fromSocketId: socket.id,
          fromUserId: socket.userId,
          userName: socket.userInfo.name,
          roomId: data.roomId
        });
      }
    });

    socket.on('answer', (data) => {
      const { signal, targetSocketId } = data;
      if (!signal || !targetSocketId) return;
      
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket && targetSocket.connected) {
        targetSocket.emit('answer', {
          signal,
          fromSocketId: socket.id,
          fromUserId: socket.userId,
          roomId: data.roomId
        });
      }
    });

    socket.on('ice-candidate', (data) => {
      const { candidate, targetSocketId } = data;
      if (!candidate || !targetSocketId) return;
      
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket && targetSocket.connected) {
        targetSocket.emit('ice-candidate', {
          candidate,
          fromSocketId: socket.id,
          fromUserId: socket.userId,
          roomId: data.roomId
        });
      }
    });

    // Disconnect handler
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] 🔴 User disconnected: ${socket.userInfo.name} (${socket.userId}) - ${reason}`);
      
      updateUserConnection(socket.userId, null, socket.userInfo, 'offline');
      
      // Clean up video rooms
      for (const [roomId, room] of videoRooms.entries()) {
        if (room.has(socket.userId)) {
          room.delete(socket.userId);
          
          const remainingParticipants = Array.from(room.values());
          remainingParticipants.forEach(participant => {
            emitToUser(participant.userId, 'user-left-room', {
              userId: socket.userId,
              userName: socket.userInfo.name,
              socketId: socket.id,
              roomId
            });
          });
          
          if (room.size === 0) {
            videoRooms.delete(roomId);
          }
        }
      }
      
      // Update database
      try {
        await pool.execute(
          'UPDATE user_connections SET status = "offline", last_seen = NOW() WHERE user_id = ?',
          [socket.userId]
        );
      } catch (error) {
        console.error('[Socket] Database update error on disconnect:', error);
      }
    });
  });

  console.log('[Socket] ✅ Socket server initialization complete');
  return io;
};

export { 
  emitToUser, 
  isUserOnline, 
  getOnlineUsers
};

// Stale connection cleanup
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [userId, user] of connectedUsers.entries()) {
    if (now - user.lastPing > 120000) {
      console.log(`[Socket] Cleaning stale connection for user ${userId}`);
      connectedUsers.delete(userId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[Socket] Cleaned ${cleaned} stale connections`);
  }
}, 30000);