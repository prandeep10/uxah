// routes/routes.js - UPDATED WITH WHATSAPP ROUTES
import express from 'express';
import path, { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../databaseconfig.js';

import { login} from '../controllers/loginController.js';
import { checkLoginStatus } from '../controllers/loginController.js';
import { signup } from '../controllers/signupController.js';
import { logout } from '../controllers/logoutController.js';
import { DocLogin } from '../controllers/docLoginController.js';
import { verifyemail } from '../controllers/verifyemail.js';
import { getDoctors } from '../controllers/doctorsController.js';
import { changepassword, changePasswordWithCurrent } from '../controllers/changepassword.js';
import { verifyResetToken } from '../controllers/verifyToken.js';
import { upload, reportProblemHandler } from '../controllers/ReportProblemController.js';
import { updateProfile, getProfileHistory } from '../controllers/profileController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { getAvailableSlots, addAvailableSlots, deleteAvailableSlot, getBookedSlots } from '../controllers/dochomecontroller.js';
import { createBooking, getDocAvailableSlots, getClientBookings } from '../controllers/bookingController.js';
import {getNotifications, markNotificationAsRead, markAllNotificationsAsRead, updateNotificationPreferences} from '../controllers/notificationController.js';
import {getUserStatus, updateUserStatus, getCallHistory, getActiveCall, getMyUpcomingBookings, canUserMakeCall, endCallAPI, initiateCallAPI, respondToCallAPI, getBookedClientsStatus, checkRealTimeStatus, cleanupStaleCalls} from '../controllers/videoCallController.js';

// NEW: WhatsApp controllers
import { 
  sendWhatsAppMessage, 
  getWhatsAppTemplates, 
  createWhatsAppTemplate,
  sendTestMessage,
  getMessageStatus,
  handleWhatsAppWebhook 
} from '../controllers/whatsappController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Authentication Routes
router.post('/login', login);
router.post('/signup', signup);
router.post('/logout', logout);
router.post('/DocLogin', DocLogin);
router.get('/check-login', authMiddleware, checkLoginStatus);
router.post('/verifyemail', verifyemail);
router.post('/change-password', authMiddleware, changePasswordWithCurrent);
router.post('/verify-reset-token', verifyResetToken);
router.get('/reset-password', (req, res) => {
  const token = req.query.token;
  console.log('🔗 Email link clicked - Token:', token ? 'Present' : 'Missing');
  
  if (!token) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Invalid Link</title></head>
      <body style="font-family: Arial; padding: 20px;">
        <h2>Invalid Reset Link</h2>
        <p>The password reset link is missing the token.</p>
        <a href="http://localhost:3001/forgot-password" style="color: blue;">Get a new link</a>
      </body>
      </html>
    `);
  }
  
  res.redirect(`http://localhost:3001/reset-password?token=${token}`);
});

router.get('/reset-token', (req, res) => {
  const token = req.query.token;
  console.log('🔄 /reset-token route accessed');
  res.redirect(`http://localhost:3001/reset-password?token=${token || ''}`);
});

router.post('/reset-password', changepassword);

// Doctor Availability Routes
router.get('/doctor/available-slots', authMiddleware, getAvailableSlots);
router.post('/doctor/add-available-slots', authMiddleware, addAvailableSlots);
router.delete('/doctor/available-slots/:slot_id', authMiddleware, deleteAvailableSlot);
router.get('/doctor/booked-slots', authMiddleware, getBookedSlots);

// Doctor Routes
router.get('/doctors', getDoctors);

// Booking Routes
router.post('/bookings/create', authMiddleware, createBooking);
router.get('/bookings/my', authMiddleware, getClientBookings);
router.get('/doctors/:doctorId/available-slots', getDocAvailableSlots);

// Notification Routes
router.get('/notifications', authMiddleware, getNotifications);
router.patch('/notifications/:notificationId/read', authMiddleware, markNotificationAsRead);
router.patch('/notifications/read-all', authMiddleware, markAllNotificationsAsRead);
router.patch('/notifications/preferences', authMiddleware, updateNotificationPreferences);
router.put('/notifications/:notificationId/read', authMiddleware, markNotificationAsRead);
router.put('/notifications/read-all', authMiddleware, markAllNotificationsAsRead);

// Report Problem Route
router.post('/report-problem', upload.single('attachment'), reportProblemHandler);

// Profile Management
router.put('/profile', authMiddleware, updateProfile);
router.get('/profile/history/:userId', authMiddleware, getProfileHistory);

// =====================================
// VIDEO CALL ROUTES
// =====================================
console.log('[Routes] Setting up video call endpoints...');

router.get('/video-call/user-status/:userId', authMiddleware, getUserStatus);
router.post('/video-call/update-status', authMiddleware, updateUserStatus);
router.post('/video-call/initiate', authMiddleware, initiateCallAPI);
router.post('/video-call/respond', authMiddleware, respondToCallAPI);
router.post('/video-call/end', authMiddleware, endCallAPI);
router.get('/video-call/history', authMiddleware, getCallHistory);
router.get('/video-call/active', authMiddleware, getActiveCall);
router.get('/video-call/upcoming-bookings', authMiddleware, getMyUpcomingBookings);
router.get('/video-call/can-call/:targetUserId', authMiddleware, canUserMakeCall);
router.get('/video-call/booked-clients-status', authMiddleware, getBookedClientsStatus);
router.get('/video-call/real-time-status/:userId', authMiddleware, checkRealTimeStatus);
router.post('/video-call/cleanup-stale-calls', authMiddleware, cleanupStaleCalls);

// Debug endpoints
router.get('/video-call/debug/user-status/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[Debug] Checking status for user ${userId}`);
    
    const [dbResult] = await pool.execute(`
      SELECT 
        user_id,
        socket_id,
        role,
        status,
        last_seen,
        TIMESTAMPDIFF(SECOND, last_seen, NOW()) as seconds_ago,
        CASE 
          WHEN status = 'online' AND last_seen > DATE_SUB(NOW(), INTERVAL 30 SECOND) THEN 'online'
          WHEN last_seen > DATE_SUB(NOW(), INTERVAL 2 MINUTE) THEN 'away'
          ELSE 'offline'
        END as computed_status
      FROM user_connections 
      WHERE user_id = ?
    `, [userId]);
    
    let socketStatus = null;
    try {
      const { isUserOnline, getOnlineUsers } = await import('../sockets/socketServer.js');
      const isOnlineSocket = isUserOnline(parseInt(userId));
      const allOnlineUsers = getOnlineUsers();
      
      socketStatus = {
        isOnline: isOnlineSocket,
        userInSocketList: allOnlineUsers.find(u => u.id == userId) || null,
        totalOnlineUsers: allOnlineUsers.length,
        allOnlineUserIds: allOnlineUsers.map(u => u.id),
        rawSocketUsers: allOnlineUsers
      };
      
      console.log(`[Debug] Socket status for user ${userId}:`, {
        isOnlineSocket,
        foundInList: !!socketStatus.userInSocketList,
        totalOnline: socketStatus.totalOnlineUsers,
        allOnlineIds: socketStatus.allOnlineUserIds
      });
    } catch (e) {
      socketStatus = { error: e.message, available: false };
      console.error('[Debug] Socket check failed:', e.message);
    }
    
    const dbRecord = dbResult[0];
    const isOnline = socketStatus?.isOnline || (dbRecord?.computed_status === 'online');
    
    const finalStatus = {
      userId: parseInt(userId),
      database: dbRecord || null,
      socket: socketStatus,
      isOnline: isOnline,
      recommendation: null
    };
    
    if (!dbRecord && !socketStatus?.isOnline) {
      finalStatus.recommendation = 'User not found in database or socket. User may not be connected.';
    } else if (!dbRecord && socketStatus?.isOnline) {
      finalStatus.recommendation = 'Socket shows online but no database record. Check status update logic in socket connection.';
    } else if (dbRecord && !socketStatus?.isOnline && dbRecord.computed_status === 'online') {
      finalStatus.recommendation = 'DB shows online but socket is offline. User may have disconnected recently without proper cleanup.';
    } else if (dbRecord && socketStatus?.isOnline && dbRecord.computed_status !== 'online') {
      finalStatus.recommendation = 'Socket shows online but DB shows offline. Status update may be failing.';
    } else if (dbRecord && socketStatus?.isOnline && dbRecord.computed_status === 'online') {
      finalStatus.recommendation = 'User is properly online in both systems. Call should work.';
    }
    
    console.log(`[Debug] User ${userId} final status:`, isOnline ? 'ONLINE' : 'OFFLINE');
    
    res.json({
      success: true,
      ...finalStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Debug] Status check error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    });
  }
});

router.get('/video-call/debug/online-users', authMiddleware, async (req, res) => {
  try {
    const [dbUsers] = await pool.execute(`
      SELECT 
        uc.user_id,
        uc.socket_id,
        uc.status,
        uc.role,
        uc.last_seen,
        COALESCE(d.name, u.Name) as user_name,
        TIMESTAMPDIFF(SECOND, uc.last_seen, NOW()) as seconds_ago,
        CASE 
          WHEN uc.status = 'online' AND uc.last_seen > DATE_SUB(NOW(), INTERVAL 30 SECOND) THEN 'online'
          WHEN uc.last_seen > DATE_SUB(NOW(), INTERVAL 2 MINUTE) THEN 'away'
          ELSE 'offline'
        END as computed_status
      FROM user_connections uc
      LEFT JOIN users u ON uc.user_id = u.id
      LEFT JOIN docinfo d ON u.id = d.id
      ORDER BY uc.last_seen DESC
      LIMIT 50
    `);
    
    let socketUsers = [];
    let socketError = null;
    try {
      const { getOnlineUsers } = await import('../sockets/socketServer.js');
      socketUsers = getOnlineUsers();
    } catch (e) {
      socketError = e.message;
      console.log('Socket users not available:', e.message);
    }
    
    res.json({
      success: true,
      database: {
        users: dbUsers,
        onlineCount: dbUsers.filter(u => u.computed_status === 'online').length,
        totalCount: dbUsers.length
      },
      socket: {
        users: socketUsers,
        onlineCount: socketUsers.length,
        error: socketError
      },
      comparison: {
        socketOnlyUsers: socketUsers.filter(su => !dbUsers.find(du => du.user_id == su.id)),
        dbOnlyUsers: dbUsers.filter(du => du.computed_status === 'online' && !socketUsers.find(su => su.id == du.user_id))
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting online users:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.post('/video-call/force-status-update', authMiddleware, async (req, res) => {
  try {
    const { userId, status } = req.body;
    const targetUserId = userId || req.user.id;
    
    console.log(`[Force Update] Setting user ${targetUserId} to ${status}`);
    
    await pool.execute(
      `INSERT INTO user_connections (user_id, socket_id, role, last_seen, status)
       VALUES (?, 'manual-update', ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
       socket_id = 'manual-update',
       last_seen = NOW(),
       status = VALUES(status)`,
      [targetUserId, req.user.role || 'client', status]
    );
    
    res.json({ 
      success: true, 
      message: `Status updated to ${status} for user ${targetUserId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Force status update error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.post('/video-call/test-socket', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    let socketResult = null;
    try {
      const { emitToUser } = await import('../sockets/socketServer.js');
      const emitSuccess = emitToUser(userId, 'test-event', { message: 'Socket test from API' });
      socketResult = { emitSuccess, userId };
    } catch (e) {
      socketResult = { error: e.message };
    }
    
    res.json({
      success: true,
      userId,
      socketResult,
      message: 'Check browser console for test event if socket is working',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Socket test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// =====================================
// NEW: WHATSAPP MESSAGING ROUTES
// =====================================
console.log('[Routes] Setting up WhatsApp messaging endpoints...');

// WhatsApp message sending
router.post('/whatsapp/send-message', authMiddleware, sendWhatsAppMessage);

// Test WhatsApp message
router.post('/whatsapp/send-test', authMiddleware, sendTestMessage);

// WhatsApp template management
router.get('/whatsapp/templates', authMiddleware, getWhatsAppTemplates);
router.post('/whatsapp/templates', authMiddleware, createWhatsAppTemplate);

// Message status tracking
router.get('/whatsapp/message-status/:messageId', authMiddleware, getMessageStatus);

// Webhook handler (public endpoint, no auth needed)
router.post('/whatsapp/webhook', handleWhatsAppWebhook);

// WhatsApp service status
router.get('/whatsapp/service-status', authMiddleware, async (req, res) => {
  try {
    const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'meta';
    
    // Check if service is configured
    const isConfigured = whatsappProvider === 'meta' 
      ? !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
      : !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    
    // Get recent messages sent
    const [recentMessages] = await pool.execute(
      `SELECT COUNT(*) as total, 
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
       FROM whatsapp_messages 
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
    
    res.json({
      success: true,
      service: {
        provider: whatsappProvider,
        configured: isConfigured,
        status: isConfigured ? 'active' : 'inactive'
      },
      stats: {
        totalMessages: recentMessages[0]?.total || 0,
        successful: recentMessages[0]?.successful || 0,
        failed: recentMessages[0]?.failed || 0,
        successRate: recentMessages[0]?.total 
          ? ((recentMessages[0].successful / recentMessages[0].total) * 100).toFixed(2) + '%'
          : '0%'
      },
      endpoints: {
        sendMessage: '/api/whatsapp/send-message',
        sendTest: '/api/whatsapp/send-test',
        templates: '/api/whatsapp/templates',
        webhook: '/api/whatsapp/webhook'
      }
    });
  } catch (error) {
    console.error('Error getting WhatsApp service status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test endpoints
router.get('/test', authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: 'Backend is running',
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

router.get('/DocLogin-test', (req, res) => {
  console.log('DocLogin test route hit');
  res.json({
    message: 'DocLogin route is accessible',
    timestamp: new Date().toISOString(),
    method: 'GET',
    path: '/api/DocLogin-test'
  });
});

// Static files
router.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API health check
router.get('/health-check', (req, res) => {
  res.json({ 
    status: 'API OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      videoCall: 'active',
      notifications: 'active',
      booking: 'active',
      whatsapp: process.env.WHATSAPP_ACCESS_TOKEN ? 'active' : 'inactive'
    },
    videoCallRoutes: [
      'GET /api/video-call/user-status/:userId',
      'POST /api/video-call/update-status',
      'POST /api/video-call/initiate',
      'POST /api/video-call/respond',
      'POST /api/video-call/end',
      'GET /api/video-call/booked-clients-status',
      'GET /api/video-call/debug/user-status/:userId',
      'GET /api/video-call/debug/online-users'
    ],
    whatsappRoutes: [
      'POST /api/whatsapp/send-message',
      'POST /api/whatsapp/send-test',
      'GET /api/whatsapp/templates',
      'POST /api/whatsapp/templates',
      'GET /api/whatsapp/service-status',
      'POST /api/whatsapp/webhook'
    ]
  });
});

console.log('[Routes] All routes configured successfully - INCLUDING WHATSAPP');

// Real-time connection debug endpoint
router.get('/video-call/debug/real-time-connections', authMiddleware, async (req, res) => {
  try {
    const { getOnlineUsers } = await import('../sockets/socketServer.js');
    const socketUsers = getOnlineUsers();
    
    const [dbUsers] = await pool.execute(`
      SELECT uc.*, COALESCE(d.name, u.Name) as user_name 
      FROM user_connections uc
      LEFT JOIN users u ON uc.user_id = u.id
      LEFT JOIN docinfo d ON u.id = d.id
      WHERE uc.status = 'online' 
      AND uc.last_seen > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
      ORDER BY uc.last_seen DESC
    `);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      socketServer: {
        connectedUsersCount: socketUsers.length,
        connectedUsers: socketUsers
      },
      database: {
        onlineUsersCount: dbUsers.length,
        onlineUsers: dbUsers
      },
      analysis: {
        socketVsDatabaseMatch: socketUsers.length === dbUsers.length,
        issues: socketUsers.length === 0 ? 'Socket server user tracking may be broken' : 'OK'
      }
    });
  } catch (error) {
    console.error('[Debug] Real-time connections error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/video-call/debug/connection-health', authMiddleware, async (req, res) => {
  try {
    const { getOnlineUsers } = await import('../sockets/socketServer.js');
    const socketUsers = getOnlineUsers();
    
    const connectionReport = socketUsers.map(user => ({
      userId: user.id,
      userName: user.name,
      socketId: user.socketId,
      role: user.role,
      lastPing: user.lastPing ? Math.round((Date.now() - user.lastPing) / 1000) + 's ago' : 'unknown',
      healthy: user.lastPing ? (Date.now() - user.lastPing < 60000) : false
    }));
    
    res.json({
      success: true,
      totalConnections: socketUsers.length,
      healthyConnections: connectionReport.filter(c => c.healthy).length,
      connections: connectionReport,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Debug] Connection health error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;