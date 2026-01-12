// controllers/videoCallController.js - COMPLETE FIXED VERSION
import { pool } from '../databaseconfig.js';
import { v4 as uuidv4 } from 'uuid';

// Enhanced user status check
export const getUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const numericUserId = parseInt(userId);
    
    console.log(`[Status Check] Checking status for user: ${numericUserId}`);
    
    // Check database status
    const [dbResult] = await pool.execute(`
      SELECT 
        user_id,
        socket_id,
        status,
        last_seen,
        TIMESTAMPDIFF(SECOND, last_seen, NOW()) as seconds_ago
      FROM user_connections 
      WHERE user_id = ?
      ORDER BY last_seen DESC
      LIMIT 1
    `, [numericUserId]);
    
    // Check active socket connection
    let socketOnline = false;
    let socketInfo = null;
    
    try {
      const { isUserOnline, getOnlineUsers } = await import('../sockets/socketServer.js');
      socketOnline = isUserOnline(numericUserId);
      
      if (socketOnline) {
        const onlineUsers = getOnlineUsers();
        socketInfo = onlineUsers.find(u => u.id === numericUserId);
      }
      
      console.log(`[Status Check] Socket status for user ${numericUserId}:`, { 
        socketOnline, 
        hasSocketInfo: !!socketInfo 
      });
      
    } catch (error) {
      console.warn('Socket check not available:', error.message);
    }
    
    // Determine if user is truly online
    const dbOnline = dbResult.length > 0 && 
                    dbResult[0].status === 'online' && 
                    dbResult[0].seconds_ago < 60;
    
    // User is online if EITHER socket says online OR database says online (within last 60 seconds)
    const isOnline = socketOnline || dbOnline;
    
    console.log(`[Status Check] User ${numericUserId} final status:`, {
      isOnline,
      socketOnline,
      dbOnline,
      secondsAgo: dbResult[0]?.seconds_ago
    });
    
    // IMPORTANT: Return recommendation for debugging
    let recommendation = '';
    if (dbOnline && !socketOnline) {
      recommendation = 'DB shows online but socket is offline. User may have disconnected recently without proper cleanup.';
    } else if (!dbOnline && socketOnline) {
      recommendation = 'Socket shows online but DB is stale. Normal during active connection.';
    } else if (!isOnline) {
      recommendation = 'User is offline in both systems. Cannot receive calls.';
    } else {
      recommendation = 'User is properly online and can receive calls.';
    }
    
    res.json({
      success: true,
      userId: numericUserId,
      isOnline,
      socketOnline,
      dbOnline,
      database: dbResult[0] || null,
      socket: socketInfo ? { 
        id: socketInfo.id, 
        name: socketInfo.name,
        socketId: socketInfo.socketId,
        lastPing: socketInfo.lastPing
      } : null,
      recommendation,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting user status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get user status' 
    });
  }
};

// Update user connection status
export const updateUserStatus = async (req, res) => {
  try {
    const { userId, socketId, status, role } = req.body;
    
    if (!userId || !status) {
      return res.status(400).json({
        success: false,
        error: 'userId and status are required'
      });
    }
    
    if (status === 'online') {
      const query = `
        INSERT INTO user_connections (user_id, socket_id, role, last_seen, status)
        VALUES (?, ?, ?, NOW(), ?)
        ON DUPLICATE KEY UPDATE
        socket_id = VALUES(socket_id),
        last_seen = NOW(),
        status = VALUES(status),
        role = VALUES(role)
      `;
      
      await pool.execute(query, [userId, socketId || null, role || 'client', status]);
      console.log(`[Status Update] User ${userId} set to ${status}`);
    } else {
      const query = `
        UPDATE user_connections 
        SET status = ?, last_seen = NOW()
        WHERE user_id = ?
      `;
      
      await pool.execute(query, [status, userId]);
      console.log(`[Status Update] User ${userId} set to ${status}`);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ success: false, error: 'Failed to update user status' });
  }
};

// FIXED: Initiate call with comprehensive error handling
// controllers/videoCallController.js - FIXED initiateCallAPI function

export const initiateCallAPI = async (req, res) => {
  let callRecordId = null;
  
  try {
    const { receiverId, callType = 'video' } = req.body;
    const callerId = req.user.id;
    const callerName = req.user.name;
    
    console.log('[Call Initiation] Starting call:', { 
      callerId, 
      callerName, 
      receiverId,
      callerRole: req.user.role 
    });
    
    // Validate input
    if (!receiverId || !callerId) {
      return res.status(400).json({
        success: false,
        error: 'Caller ID and Receiver ID are required'
      });
    }
    
    if (callerId == receiverId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot call yourself'
      });
    }
    
    // ✅ CRITICAL FIX: More aggressive cleanup of stale calls
    console.log(`[Call Initiation] Checking for existing calls involving users ${callerId} and ${receiverId}`);
    
    const [existingCalls] = await pool.execute(
      `SELECT id, room_id, status, caller_id, receiver_id, 
              TIMESTAMPDIFF(SECOND, created_at, NOW()) as age_seconds
       FROM active_calls 
       WHERE (caller_id = ? OR receiver_id = ? OR caller_id = ? OR receiver_id = ?) 
       AND status IN ("pending", "active")`,
      [callerId, callerId, receiverId, receiverId]
    );
    
    if (existingCalls.length > 0) {
      console.log(`[Call Initiation] Found ${existingCalls.length} existing calls:`, existingCalls);
      
      let hasRecentCall = false;
      
      for (const call of existingCalls) {
        const ageSeconds = call.age_seconds;
        
        // ✅ FIX: Only keep calls younger than 45 seconds (call timeout period)
        if (ageSeconds < 45) {
          hasRecentCall = true;
          console.log(`[Call Initiation] Found recent call ${call.id} (${ageSeconds}s old) - blocking new call`);
        } else {
          // Auto-cleanup stale calls
          console.log(`[Call Initiation] Auto-cleaning stale call ${call.id} (${ageSeconds}s old)`);
          
          const newStatus = call.status === 'pending' ? 'timeout' : 'ended';
          
          await pool.execute(
            'UPDATE active_calls SET status = ?, ended_at = NOW() WHERE id = ?',
            [newStatus, call.id]
          );
          
          // Update or create call history
          const [historyExists] = await pool.execute(
            'SELECT id FROM call_history WHERE room_id = ?',
            [call.room_id]
          );
          
          if (historyExists.length > 0) {
            await pool.execute(
              `UPDATE call_history 
               SET call_status = ?, end_time = NOW(), duration = 0
               WHERE room_id = ? AND call_status IN ('active', 'pending')`,
              [newStatus, call.room_id]
            );
          } else {
            await pool.execute(
              `INSERT INTO call_history 
               (room_id, caller_id, receiver_id, call_status, start_time, end_time, duration)
               VALUES (?, ?, ?, ?, NOW(), NOW(), 0)`,
              [call.room_id, call.caller_id, call.receiver_id, newStatus]
            );
          }
        }
      }
      
      // If there's a recent call, block the new call
      if (hasRecentCall) {
        return res.status(400).json({
          success: false,
          error: 'A call is already in progress. Please wait a moment and try again.',
          code: 'CALL_IN_PROGRESS'
        });
      }
    }
    
    // Check receiver existence
    const [receiverCheck] = await pool.execute(
      'SELECT id, Name FROM users WHERE id = ?',
      [receiverId]
    );

    if (receiverCheck.length === 0) {
      return res.status(400).json({
        success: false, 
        error: 'Receiver not found'
      });
    }
    
    const receiverName = receiverCheck[0].Name;
    console.log(`[Call Initiation] Found receiver: ${receiverName} (ID: ${receiverId})`);
    
    // Check if receiver is online
    let receiverOnline = false;

    try {
      const { isUserOnline, emitToUser } = await import('../sockets/socketServer.js');
      receiverOnline = isUserOnline(parseInt(receiverId));
      
      console.log(`[Call Initiation] Receiver ${receiverId} socket status:`, receiverOnline);
      
      // Database fallback check
      if (!receiverOnline) {
        console.log(`[Call Initiation] Socket offline, checking database...`);
        
        const [dbCheck] = await pool.execute(
          `SELECT status, TIMESTAMPDIFF(SECOND, last_seen, NOW()) as seconds_ago 
           FROM user_connections 
           WHERE user_id = ? AND status = 'online'
           ORDER BY last_seen DESC LIMIT 1`,
          [receiverId]
        );
        
        if (dbCheck.length > 0 && dbCheck[0].seconds_ago < 30) {
          receiverOnline = true;
          console.log(`[Call Initiation] Database override: user was online ${dbCheck[0].seconds_ago}s ago`);
        } else {
          return res.status(400).json({
            success: false,
            error: `${receiverName} is not currently online. They need to be logged in to receive calls.`,
            code: 'USER_OFFLINE',
            details: {
              receiverId,
              receiverName,
              socketOnline: false,
              dbOnline: false,
              lastSeenSeconds: dbCheck[0]?.seconds_ago
            }
          });
        }
      }
      
      // ✅ Create call record BEFORE emitting
      const roomId = `call_${Date.now()}_${callerId}_${receiverId}`;
      
      const [result] = await pool.execute(
        'INSERT INTO active_calls (room_id, caller_id, receiver_id, status, created_at) VALUES (?, ?, ?, "pending", NOW())',
        [roomId, callerId, receiverId]
      );
      
      callRecordId = result.insertId;
      console.log(`[Call Initiation] Created call record ${callRecordId} in room ${roomId}`);
      
      const callData = {
        callId: callRecordId,
        roomId: roomId,
        caller: {
          id: callerId,
          name: callerName,
          role: req.user.role || 'doctor'
        },
        callType: callType,
        timestamp: new Date().toISOString()
      };
      
      console.log('[Call Initiation] Emitting call to receiver...');
      
      // ✅ Emit the call
      const emitSuccess = emitToUser(parseInt(receiverId), 'incoming-call', callData);
      
      if (!emitSuccess) {
        throw new Error(`Failed to deliver call to ${receiverName}. They may have just disconnected.`);
      }
      
      console.log(`[Call Initiation] ✅ Call emitted successfully to user ${receiverId}`);
      
      // ✅ Set timeout to auto-cleanup unanswered calls (45 seconds)
      setTimeout(async () => {
        try {
          const [stillPending] = await pool.execute(
            'SELECT status FROM active_calls WHERE id = ? AND status = "pending"',
            [callRecordId]
          );
          
          if (stillPending.length > 0) {
            console.log(`[Call Timeout] Call ${callRecordId} timed out after 45 seconds`);
            
            await pool.execute(
              'UPDATE active_calls SET status = "timeout", ended_at = NOW() WHERE id = ?',
              [callRecordId]
            );
            
            await pool.execute(
              `INSERT INTO call_history 
               (room_id, caller_id, receiver_id, call_status, start_time, end_time, duration)
               VALUES (?, ?, ?, 'timeout', NOW(), NOW(), 0)
               ON DUPLICATE KEY UPDATE call_status = 'timeout', end_time = NOW()`,
              [roomId, callerId, receiverId]
            );
            
            // Notify caller of timeout
            emitToUser(callerId, 'call-timeout', { callId: callRecordId, roomId });
          }
        } catch (timeoutError) {
          console.error('[Call Timeout] Error handling timeout:', timeoutError);
        }
      }, 45000);
      
      // ✅ Return success response
      return res.json({
        success: true,
        roomId: roomId,
        callId: callRecordId,
        message: 'Call initiated successfully',
        receiverName: receiverName
      });
      
    } catch (socketError) {
      console.error('[Call Initiation] Socket system error:', socketError);
      
      // Cleanup the call record if socket failed
      if (callRecordId) {
        await pool.execute('DELETE FROM active_calls WHERE id = ?', [callRecordId]);
      }
      
      return res.status(500).json({
        success: false,
        error: 'Video call system unavailable. Please try again.',
        details: socketError.message
      });
    }
    
  } catch (error) {
    console.error('[Call Initiation] Error:', error);
    
    // ✅ CRITICAL: Clean up call record if it was created
    if (callRecordId) {
      try {
        await pool.execute('DELETE FROM active_calls WHERE id = ?', [callRecordId]);
        console.log(`[Call Initiation] Cleaned up call record ${callRecordId} due to error`);
      } catch (cleanupError) {
        console.error('[Call Initiation] Error cleaning up call record:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to initiate call'
    });
  }
};

// ✅ NEW: Manual cleanup endpoint - call this from frontend when needed
export const forceCleanupUserCalls = async (req, res) => {
  try {
    const { userId } = req.body;
    const requestingUserId = req.user.id;
    
    // Only allow users to cleanup their own calls
    if (userId !== requestingUserId) {
      return res.status(403).json({
        success: false,
        error: 'Can only cleanup your own calls'
      });
    }
    
    console.log(`[Force Cleanup] Cleaning ALL calls for user ${userId}`);
    
    // Get all active/pending calls
    const [activeCalls] = await pool.execute(
      `SELECT id, room_id, status, caller_id, receiver_id 
       FROM active_calls 
       WHERE (caller_id = ? OR receiver_id = ?) 
       AND status IN ('pending', 'active')`,
      [userId, userId]
    );
    
    let cleanedCount = 0;
    
    for (const call of activeCalls) {
      const newStatus = call.status === 'pending' ? 'timeout' : 'ended';
      
      await pool.execute(
        'UPDATE active_calls SET status = ?, ended_at = NOW() WHERE id = ?',
        [newStatus, call.id]
      );
      
      // Create or update call history
      await pool.execute(
        `INSERT INTO call_history 
         (room_id, caller_id, receiver_id, call_status, start_time, end_time, duration)
         VALUES (?, ?, ?, ?, NOW(), NOW(), 0)
         ON DUPLICATE KEY UPDATE call_status = ?, end_time = NOW()`,
        [call.room_id, call.caller_id, call.receiver_id, newStatus, newStatus]
      );
      
      cleanedCount++;
    }
    
    console.log(`[Force Cleanup] Cleaned ${cleanedCount} calls for user ${userId}`);
    
    res.json({
      success: true,
      cleanedCount,
      message: `Cleaned ${cleanedCount} stale calls`
    });
    
  } catch (error) {
    console.error('[Force Cleanup] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// Respond to incoming call (accept/reject)
export const respondToCallAPI = async (req, res) => {
  try {
    const { callId, response } = req.body;
    const userId = req.user.id;
    
    if (!callId || !response) {
      return res.status(400).json({
        success: false,
        error: 'callId and response are required'
      });
    }
    
    console.log(`[Call Response] User ${userId} responding to call ${callId}: ${response}`);
    
    // Get call info
    const [callInfo] = await pool.execute(
      'SELECT * FROM active_calls WHERE id = ? AND receiver_id = ? AND status = "pending"',
      [callId, userId]
    );
    
    if (callInfo.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Call not found or already handled'
      });
    }
    
    const call = callInfo[0];
    
    if (response === 'accepted') {
      // Update call status to active
      await pool.execute(
        'UPDATE active_calls SET status = "active", accepted_at = NOW() WHERE id = ?',
        [callId]
      );
      
      // Create call history record
      await pool.execute(
        'INSERT INTO call_history (room_id, caller_id, receiver_id, call_status, start_time) VALUES (?, ?, ?, "active", NOW())',
        [call.room_id, call.caller_id, call.receiver_id]
      );
      
      console.log(`[Call Response] Call ${callId} accepted successfully`);
      
      res.json({
        success: true,
        message: 'Call accepted',
        roomId: call.room_id,
        callId: call.id
      });
    } else {
      // Update call status to rejected
      await pool.execute(
        'UPDATE active_calls SET status = "rejected", rejected_at = NOW() WHERE id = ?',
        [callId]
      );
      
      // Create call history record
      await pool.execute(
        'INSERT INTO call_history (room_id, caller_id, receiver_id, call_status, start_time, end_time) VALUES (?, ?, ?, "rejected", NOW(), NOW())',
        [call.room_id, call.caller_id, call.receiver_id]
      );
      
      console.log(`[Call Response] Call ${callId} rejected`);
      
      res.json({
        success: true,
        message: 'Call rejected'
      });
    }
    
  } catch (error) {
    console.error('Error responding to call:', error);
    res.status(500).json({ success: false, error: 'Failed to respond to call' });
  }
};

// End an active call
export const endCallAPI = async (req, res) => {
  try {
    const { roomId } = req.body;
    const userId = req.user.id;
    
    if (!roomId) {
      return res.status(400).json({
        success: false,
        error: 'roomId is required'
      });
    }
    
    console.log(`[Call End] User ${userId} ending call in room ${roomId}`);
    
    // Get active call
    const [callInfo] = await pool.execute(
      'SELECT * FROM active_calls WHERE room_id = ? AND (caller_id = ? OR receiver_id = ?) AND status = "active"',
      [roomId, userId, userId]
    );
    
    if (callInfo.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Active call not found'
      });
    }
    
    const call = callInfo[0];
    
    // Update active call status
    await pool.execute(
      'UPDATE active_calls SET status = "ended", ended_at = NOW() WHERE id = ?',
      [call.id]
    );
    
    // Update call history
    await pool.execute(
      'UPDATE call_history SET call_status = "ended", end_time = NOW(), duration = TIMESTAMPDIFF(SECOND, start_time, NOW()) WHERE room_id = ? AND call_status = "active"',
      [roomId]
    );
    
    console.log(`[Call End] Call ${call.id} ended successfully`);
    
    res.json({
      success: true,
      message: 'Call ended successfully'
    });
    
  } catch (error) {
    console.error('Error ending call:', error);
    res.status(500).json({ success: false, error: 'Failed to end call' });
  }
};

// Get call history for user
export const getCallHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT 
        ch.*,
        CASE 
          WHEN ch.caller_id = ? THEN 'outgoing' 
          ELSE 'incoming' 
        END as call_direction,
        CASE 
          WHEN ch.caller_id = ? THEN (
            SELECT COALESCE(d.name, u.Name) 
            FROM users u 
            LEFT JOIN docinfo d ON u.id = d.id 
            WHERE u.id = ch.receiver_id
          )
          ELSE (
            SELECT COALESCE(d.name, u.Name) 
            FROM users u 
            LEFT JOIN docinfo d ON u.id = d.id 
            WHERE u.id = ch.caller_id
          )
        END as other_party_name
      FROM call_history ch
      WHERE ch.caller_id = ? OR ch.receiver_id = ?
      ORDER BY ch.start_time DESC
      LIMIT ? OFFSET ?
    `;
    
    const [calls] = await pool.execute(query, [
      userId, userId, userId, userId, parseInt(limit), parseInt(offset)
    ]);
    
    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM call_history WHERE caller_id = ? OR receiver_id = ?',
      [userId, userId]
    );
    
    res.json({
      success: true,
      calls,
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
    
  } catch (error) {
    console.error('Error getting call history:', error);
    res.status(500).json({ success: false, error: 'Failed to get call history' });
  }
};

// Get current active call for user
export const getActiveCall = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [activeCall] = await pool.execute(
      `SELECT 
        ac.*,
        CASE 
          WHEN ac.caller_id = ? THEN (
            SELECT COALESCE(d.name, u.Name) 
            FROM users u 
            LEFT JOIN docinfo d ON u.id = d.id 
            WHERE u.id = ac.receiver_id
          )
          ELSE (
            SELECT COALESCE(d.name, u.Name) 
            FROM users u 
            LEFT JOIN docinfo d ON u.id = d.id 
            WHERE u.id = ac.caller_id
          )
        END as other_party_name,
        CASE 
          WHEN ac.caller_id = ? THEN 'outgoing' 
          ELSE 'incoming' 
        END as call_direction
       FROM active_calls ac
       WHERE (ac.caller_id = ? OR ac.receiver_id = ?) AND ac.status IN ('pending', 'active')
       ORDER BY ac.created_at DESC
       LIMIT 1`,
      [userId, userId, userId, userId]
    );
    
    res.json({
      success: true,
      activeCall: activeCall[0] || null
    });
    
  } catch (error) {
    console.error('Error getting active call:', error);
    res.status(500).json({ success: false, error: 'Failed to get active call' });
  }
};

// Get upcoming bookings for making calls (for doctors)
export const getMyUpcomingBookings = async (req, res) => {
  try {
    const doctorId = req.user.id;
    
    const query = `
      SELECT 
        b.id as booking_id,
        b.client_id,
        b.appointment_time,
        b.status,
        b.notes,
        u.Name as client_name,
        u.PhoneNumber as client_phone,
        u.Email as client_email,
        uc.status as client_online_status,
        uc.socket_id as client_socket_id,
        uc.last_seen
      FROM bookings b
      INNER JOIN users u ON b.client_id = u.id
      LEFT JOIN user_connections uc ON u.id = uc.user_id
      WHERE b.doctor_id = ? 
      AND b.status IN ('confirmed', 'scheduled')
      AND DATE(b.appointment_time) >= CURDATE()
      AND b.client_id IS NOT NULL
      ORDER BY b.appointment_time ASC
      LIMIT 20
    `;
    
    const [bookings] = await pool.execute(query, [doctorId]);
    
    res.json({
      success: true,
      bookings
    });
    
  } catch (error) {
    console.error('Error getting upcoming bookings:', error);
    res.status(500).json({ success: false, error: 'Failed to get upcoming bookings' });
  }
};

// Check if user can make a call (no active calls)
export const canUserMakeCall = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [activeCall] = await pool.execute(
      'SELECT id FROM active_calls WHERE (caller_id = ? OR receiver_id = ?) AND status IN ("pending", "active")',
      [userId, userId]
    );
    
    res.json({
      success: true,
      canMakeCall: activeCall.length === 0,
      hasActiveCall: activeCall.length > 0,
      activeCallId: activeCall.length > 0 ? activeCall[0].id : null
    });
    
  } catch (error) {
    console.error('Error checking call availability:', error);
    res.status(500).json({ success: false, error: 'Failed to check call availability' });
  }
};

// Get booked clients status with enhanced online detection
export const getBookedClientsStatus = async (req, res) => {
  try {
    const doctorId = req.user.id;
    const { date } = req.query;
    
    console.log(`[Booked Clients] Getting clients for doctor: ${doctorId}`);

    let dateFilter = '';
    let queryParams = [doctorId];
    
    if (date) {
      dateFilter = 'AND DATE(b.appointment_time) = ?';
      queryParams.push(date);
    } else {
      dateFilter = 'AND DATE(b.appointment_time) >= CURDATE()';
    }

    const query = `
      SELECT 
        b.id as booking_id,
        b.client_id,
        b.appointment_time,
        b.status as booking_status,
        b.notes,
        u.id as user_id,
        u.Name as client_name,
        u.Email as client_email,
        u.PhoneNumber as client_phone,
        uc.socket_id,
        uc.status as connection_status,
        uc.last_seen
      FROM bookings b
      INNER JOIN users u ON b.client_id = u.id
      LEFT JOIN user_connections uc ON u.id = uc.user_id
      WHERE b.doctor_id = ? 
      AND b.status IN ('confirmed', 'scheduled')
      AND b.client_id IS NOT NULL
      ${dateFilter}
      ORDER BY b.appointment_time ASC
    `;

    const [clients] = await pool.execute(query, queryParams);
    
    console.log(`[Booked Clients] Found ${clients.length} clients from database`);
    
    // ✅ CRITICAL FIX: Check real-time socket status for each client
    try {
      const { isUserOnline } = await import('../sockets/socketServer.js');
      
      const enhancedClients = clients.map(client => {
        const socketOnline = isUserOnline(parseInt(client.client_id));
        
        console.log(`[Booked Clients] Client ${client.client_id} (${client.client_name}):`, {
          socketOnline,
          dbStatus: client.connection_status,
          lastSeen: client.last_seen
        });
        
        // ✅ Trust socket status as primary source
        return {
          ...client,
          is_online: socketOnline,
          socket_online: socketOnline,
          online_status: socketOnline ? 'online' : 'offline'
        };
      });
      
      res.json({
        success: true,
        clients: enhancedClients,
        total: enhancedClients.length
      });
      
    } catch (socketError) {
      console.error('Socket check error:', socketError);
      // Fallback to database status if socket check fails
      res.json({
        success: true,
        clients: clients.map(c => ({
          ...c,
          is_online: false,
          online_status: 'unknown'
        })),
        total: clients.length
      });
    }

  } catch (error) {
    console.error('Error getting booked clients:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get booked clients' 
    });
  }
};

// Real-time status check
export const checkRealTimeStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const numericUserId = parseInt(userId);
    
    if (!numericUserId) {
      return res.status(400).json({
        success: false,
        error: 'Valid userId is required'
      });
    }
    
    // Check database status
    const [dbStatus] = await pool.execute(
      `SELECT status, last_seen, TIMESTAMPDIFF(SECOND, last_seen, NOW()) as seconds_ago 
       FROM user_connections WHERE user_id = ? ORDER BY last_seen DESC LIMIT 1`,
      [numericUserId]
    );
    
    // Check socket status
    let realTimeOnline = false;
    let socketInfo = null;
    
    try {
      const { isUserOnline, getOnlineUsers } = await import('../sockets/socketServer.js');
      realTimeOnline = isUserOnline(numericUserId);
      
      if (realTimeOnline) {
        const onlineUsers = getOnlineUsers();
        socketInfo = onlineUsers.find(u => u.id === numericUserId);
      }
    } catch (socketError) {
      console.warn('Socket check not available:', socketError.message);
    }
    
    const dbRecord = dbStatus[0];
    const dbOnline = dbRecord && dbRecord.status === 'online' && dbRecord.seconds_ago < 60;
    const isOnline = realTimeOnline || dbOnline;
    
    res.json({
      success: true,
      userId: numericUserId,
      isOnline,
      dbStatus: dbRecord,
      socketInfo: socketInfo ? { id: socketInfo.id, name: socketInfo.name, socketId: socketInfo.socketId } : null,
      realTimeOnline,
      dbOnline,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error checking real-time status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check user status' 
    });
  }
};

// Debug endpoint for troubleshooting
export const debugConnectionStatus = async (req, res) => {
  try {
    const { isUserOnline, getOnlineUsers } = await import('../sockets/socketServer.js');
    
    const onlineUsers = getOnlineUsers();
    const specificUserId = req.query.userId ? parseInt(req.query.userId) : null;
    
    let userStatus = null;
    if (specificUserId) {
      userStatus = {
        userId: specificUserId,
        isOnline: isUserOnline(specificUserId),
        userInfo: onlineUsers.find(u => u.id === specificUserId) || null
      };
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalOnlineUsers: onlineUsers.length,
      onlineUsers: onlineUsers.map(u => ({
        id: u.id,
        name: u.name,
        role: u.role,
        socketId: u.socketId,
        connectedAt: u.connectedAt,
        lastPing: new Date(u.lastPing).toISOString()
      })),
      specificUserStatus: userStatus
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// Test call emission for debugging
export const testCallEmission = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const callerId = req.user.id;
    
    if (!targetUserId) {
      return res.status(400).json({ 
        success: false,
        error: 'targetUserId is required' 
      });
    }
    
    const { emitToUser, isUserOnline } = await import('../sockets/socketServer.js');
    const numericTargetId = parseInt(targetUserId);
    
    const isOnline = isUserOnline(numericTargetId);
    
    if (!isOnline) {
      return res.json({
        success: false,
        message: `User ${targetUserId} is not online`,
        isOnline: false,
        targetUserId: numericTargetId
      });
    }
    
    const testCallData = {
      callId: Date.now(),
      roomId: `test-room-${Date.now()}`,
      caller: {
        id: callerId,
        name: req.user.name,
        role: req.user.role
      },
      callType: 'video',
      isTest: true,
      timestamp: new Date().toISOString()
    };
    
    const emitSuccess = emitToUser(numericTargetId, 'incoming-call', testCallData);
    
    res.json({
      success: emitSuccess,
      message: emitSuccess ? 'Test call emitted successfully' : 'Failed to emit test call',
      targetUserId: numericTargetId,
      isOnline,
      callData: testCallData
    });
    
  } catch (error) {
    console.error('Test call emission error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
// Add this cleanup endpoint
export const cleanupStaleCalls = async (req, res) => {
  try {
    const { userId } = req.body;
    
    console.log(`[Cleanup] Manual cleanup requested for user ${userId}`);
    
    // Clean up ALL active/pending calls for this user
    const [result] = await pool.execute(
      `UPDATE active_calls 
       SET status = 'ended', ended_at = NOW() 
       WHERE (caller_id = ? OR receiver_id = ?) 
       AND status IN ('pending', 'active')`,
      [userId, userId]
    );
    
    console.log(`[Cleanup] Cleaned ${result.affectedRows} stale calls for user ${userId}`);
    
    res.json({
      success: true,
      cleanedCount: result.affectedRows,
      message: `Cleaned ${result.affectedRows} stale calls`
    });
    
  } catch (error) {
    console.error('[Cleanup] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};