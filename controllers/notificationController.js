import { pool } from '../databaseconfig.js';

// Get all notifications for authenticated user
export const getNotifications = async (req, res) => {
  const userId = req.user.id;
  try {
    const [notifications] = await pool.query(`
      SELECT DISTINCT n.id, n.message, n.type, n.related_id, n.created_at, n.\`read\`,
             COALESCE(nt.title, 'Notification') as title
        FROM notifications n
        LEFT JOIN notification_templates nt ON n.type = nt.type
        WHERE n.user_id = ?
        ORDER BY n.created_at DESC
        LIMIT 30
    `, [userId]);
    
    const out = notifications.map(n => ({ ...n, read: n.read ? 1 : 0 }));
    res.json(out);
  } catch (error) {
    console.error('[getNotifications]', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};


// Mark a notification as read
export const markNotificationAsRead = async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.params;
  try {
    const [result] = await pool.query(
      `UPDATE notifications SET \`read\` = 1 WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Notification not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('[markNotificationAsRead]', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
  const userId = req.user.id;
  try {
    const [result] = await pool.query(
      `UPDATE notifications SET \`read\` = 1 WHERE user_id = ? AND \`read\` = 0`, 
      [userId]
    );
    res.json({ success: true, updated: result.affectedRows });
  } catch (error) {
    console.error('[markAllNotificationsAsRead]', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

// Create a notification
export const createNotification = async (userId, type, relatedId = null, customData = {}) => {
  try {
    let userRole = 'client';
    const [clientCheck] = await pool.query(`SELECT id FROM clientinfo WHERE id = ?`, [userId]);
    const [doctorCheck] = await pool.query(`SELECT id FROM docinfo WHERE id = ?`, [userId]);
    if (doctorCheck.length > 0) userRole = 'therapist';

    const [templates] = await pool.query(
      `SELECT * FROM notification_templates WHERE type = ? AND (role = ? OR role = 'both') LIMIT 1`,
      [type, userRole]
    );
    if (templates.length === 0) return;

    let message = templates[0].message;
    let title = templates[0].title;
    Object.keys(customData).forEach(key => {
      message = message.replace(new RegExp(`{${key}}`, 'g'), customData[key]);
      title = title.replace(new RegExp(`{${key}}`, 'g'), customData[key]);
    });
    await pool.query(
      `INSERT INTO notifications (user_id, message, type, related_id, \`read\`, created_at)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [userId, message, type, relatedId]
    );
  } catch (error) {
    console.error('[createNotification]', error);
  }
};

export const initializeNotificationTemplates = async () => {
  try {
    const [templates] = await pool.query(`SELECT COUNT(*) as count FROM notification_templates`);
    if (templates[0].count > 0) return;
    const defaultTemplates = [
      {
        type: 'new_booking',
        title: 'New Booking',
        message: 'You have a new session booked with {clientName}',
        role: 'therapist'
      },
      {
        type: 'booking_confirmation',
        title: 'Session Confirmed',
        message: 'Your session with Dr. {doctorName} is confirmed for {date}',
        role: 'client'
      }
    ];
    for (const t of defaultTemplates) {
      await pool.query(
        `INSERT INTO notification_templates (type, title, message, role, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [t.type, t.title, t.message, t.role]
      );
    }
    console.log('Notification templates initialized.');
  } catch (error) {
    console.error('[initializeNotificationTemplates]', error);
  }
};

export const updateNotificationPreferences = async (req, res) => {
  const userId = req.user.id;
  const { emailNotifications, pushNotifications } = req.body;
  try {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, email_notifications, push_notifications)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           email_notifications = ?,
           push_notifications = ?`,
      [
        userId,
        emailNotifications ? 1 : 0,
        pushNotifications ? 1 : 0,
        emailNotifications ? 1 : 0,
        pushNotifications ? 1 : 0,
      ]
    );
    res.status(200).json({
      success: true,
      message: 'Notification preferences updated',
      preferences: {
        emailNotifications,
        pushNotifications,
      },
    });
  } catch (error) {
    console.error('[updateNotificationPreferences]', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
};
