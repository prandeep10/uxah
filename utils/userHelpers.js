// utils/userHelpers.js - COMPLETE FIXED VERSION
import { pool } from '../databaseconfig.js';

export const getUserRole = async (userId) => {
  try {
    if (!userId) {
      console.warn('getUserRole called with null/undefined userId');
      return null;
    }

    // Check if user is a doctor first
    const [doctorRows] = await pool.execute(
      'SELECT id, name, email FROM docinfo WHERE id = ?',
      [userId]
    );
    
    if (doctorRows.length > 0) {
      return {
        role: 'doctor',
        userData: doctorRows[0]
      };
    }
    
    // Check clients in users table
    const [userRows] = await pool.execute(
      'SELECT id, Name as name, Email as email FROM users WHERE id = ?',
      [userId]
    );
    
    if (userRows.length > 0) {
      return {
        role: 'client',
        userData: userRows[0]
      };
    }
    
    console.warn(`No user found with ID: ${userId}`);
    return null;
  } catch (error) {
    console.error('Error getting user role:', error);
    return null;
  }
};

export const getUserById = async (userId) => {
  try {
    if (!userId) {
      console.warn('getUserById called with null/undefined userId');
      return null;
    }
    
    const roleInfo = await getUserRole(userId);
    
    if (!roleInfo) {
      return null;
    }
    
    // Get additional info for clients
    let additionalInfo = {};
    if (roleInfo.role === 'client') {
      const [userRows] = await pool.execute(
        'SELECT PhoneNumber, Age FROM users WHERE id = ?',
        [userId]
      );
      additionalInfo = userRows.length > 0 ? userRows[0] : {};
    }
    
    return {
      id: parseInt(userId),
      name: roleInfo.userData.name,
      email: roleInfo.userData.email,
      phone: additionalInfo.PhoneNumber || null,
      role: roleInfo.role,
      age: additionalInfo.Age || null
    };
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
};

export const canInitiateCall = async (callerId, receiverId) => {
  try {
    if (!callerId || !receiverId) {
      console.warn('canInitiateCall called with missing parameters');
      return false;
    }
    
    const caller = await getUserById(callerId);
    const receiver = await getUserById(receiverId);
    
    if (!caller || !receiver) {
      console.warn(`User not found - caller: ${!!caller}, receiver: ${!!receiver}`);
      return false;
    }
    
    // Only allow doctor-client calls
    if (caller.role === receiver.role) {
      console.warn(`Same role call not allowed: ${caller.role} -> ${receiver.role}`);
      return false;
    }
    
    // Check for booking within reasonable time frame
    const [bookingRows] = await pool.execute(
      `SELECT id FROM bookings 
       WHERE ((client_id = ? AND doctor_id = ?) OR (client_id = ? AND doctor_id = ?))
       AND status IN ('scheduled', 'confirmed')
       AND appointment_time BETWEEN DATE_SUB(NOW(), INTERVAL 1 HOUR) AND DATE_ADD(NOW(), INTERVAL 1 HOUR)`,
      [callerId, receiverId, receiverId, callerId]
    );
    
    const hasBooking = bookingRows.length > 0;
    const allowUnrestricted = process.env.ALLOW_UNRESTRICTED_CALLS === 'true';
    
    console.log(`Call permission check - hasBooking: ${hasBooking}, allowUnrestricted: ${allowUnrestricted}`);
    
    return hasBooking || allowUnrestricted;
  } catch (error) {
    console.error('Error checking call permission:', error);
    return false;
  }
};

export const getUsersInBooking = async (bookingId) => {
  try {
    const [rows] = await pool.execute(
      `SELECT 
        b.client_id,
        b.doctor_id,
        u.Name as client_name,
        u.Email as client_email,
        d.name as doctor_name,
        d.email as doctor_email
       FROM bookings b
       JOIN users u ON b.client_id = u.id
       JOIN docinfo d ON b.doctor_id = d.id
       WHERE b.id = ?`,
      [bookingId]
    );
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('Error getting users in booking:', error);
    return null;
  }
};

export const getAllDoctors = async () => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, description, price FROM docinfo ORDER BY name'
    );
    return rows;
  } catch (error) {
    console.error('Error getting all doctors:', error);
    return [];
  }
};

export const getAllClients = async () => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, Name as name, Email as email FROM users WHERE id NOT IN (SELECT id FROM docinfo) ORDER BY Name'
    );
    return rows;
  } catch (error) {
    console.error('Error getting all clients:', error);
    return [];
  }
};

export const isUserOnline = async (userId) => {
  try {
    if (!userId) return false;
    
    const [rows] = await pool.execute(
      `SELECT status, last_seen, TIMESTAMPDIFF(SECOND, last_seen, NOW()) as seconds_ago 
       FROM user_connections 
       WHERE user_id = ? 
       ORDER BY last_seen DESC 
       LIMIT 1`,
      [userId]
    );
    
    if (rows.length === 0) return false;
    
    const connection = rows[0];
    return connection.status === 'online' && connection.seconds_ago < 120; // 2 minutes tolerance
  } catch (error) {
    console.error('Error checking if user is online:', error);
    return false;
  }
};

export const updateUserLastSeen = async (userId) => {
  try {
    if (!userId) return;
    
    const [result] = await pool.execute(
      'UPDATE user_connections SET last_seen = NOW() WHERE user_id = ?',
      [userId]
    );
    
    if (result.affectedRows === 0) {
      // User connection doesn't exist, create it
      const user = await getUserById(userId);
      if (user) {
        await pool.execute(
          'INSERT INTO user_connections (user_id, role, status, last_seen) VALUES (?, ?, ?, NOW())',
          [userId, user.role, 'online']
        );
      }
    }
  } catch (error) {
    console.error('Error updating user last seen:', error);
  }
};

export const setUserStatus = async (userId, status) => {
  try {
    if (!userId || !status) return;
    
    const [result] = await pool.execute(
      'UPDATE user_connections SET status = ?, last_seen = NOW() WHERE user_id = ?',
      [status, userId]
    );
    
    if (result.affectedRows === 0) {
      // User connection doesn't exist, create it
      const user = await getUserById(userId);
      if (user) {
        await pool.execute(
          'INSERT INTO user_connections (user_id, role, status, last_seen) VALUES (?, ?, ?, NOW())',
          [userId, user.role, status]
        );
      }
    }
  } catch (error) {
    console.error('Error setting user status:', error);
  }
};

export const ensureUserConnection = async (userId) => {
  try {
    if (!userId) return false;
    
    const [existing] = await pool.execute(
      'SELECT id FROM user_connections WHERE user_id = ?',
      [userId]
    );
    
    if (existing.length === 0) {
      const user = await getUserById(userId);
      if (user) {
        await pool.execute(
          'INSERT INTO user_connections (user_id, role, status, last_seen) VALUES (?, ?, ?, NOW())',
          [userId, user.role, 'online']
        );
        return true;
      }
    }
    
    return existing.length > 0;
  } catch (error) {
    console.error('Error ensuring user connection:', error);
    return false;
  }
};

export const cleanupDisconnectedUsers = async () => {
  try {
    console.log('[Cleanup] Starting user connection cleanup...');
    
    // Mark users as offline if they haven't been seen for more than 5 minutes
    const [result] = await pool.execute(
      `UPDATE user_connections 
       SET status = 'offline' 
       WHERE last_seen < DATE_SUB(NOW(), INTERVAL 5 MINUTE) 
       AND status != 'offline'`
    );
    
    console.log(`[Cleanup] Marked ${result.affectedRows} users as offline`);
    
    // Clean up old connections (older than 24 hours)
    const [deleteResult] = await pool.execute(
      'DELETE FROM user_connections WHERE last_seen < DATE_SUB(NOW(), INTERVAL 24 HOUR)'
    );
    
    console.log(`[Cleanup] Removed ${deleteResult.affectedRows} old connections`);
    
    // Clean up old call history (older than 30 days)
    const [callCleanup] = await pool.execute(
      'DELETE FROM call_history WHERE start_time < DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );
    
    console.log(`[Cleanup] Removed ${callCleanup.affectedRows} old call history records`);
    
    // Clean up timed out active calls
    const [callTimeout] = await pool.execute(
      'DELETE FROM active_calls WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR) AND status = "pending"'
    );
    
    console.log(`[Cleanup] Removed ${callTimeout.affectedRows} timed out calls`);
    
  } catch (error) {
    console.error('Error during user cleanup:', error);
  }
};

// Run cleanup every 5 minutes
setInterval(cleanupDisconnectedUsers, 5 * 60 * 1000);