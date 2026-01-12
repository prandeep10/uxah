// services/notificationScheduler.js - SIMPLIFIED (NO BULL/REDIS)
import { pool } from '../databaseconfig.js';
import { whatsappMetaService } from './whatsappMetaService.js';

export class NotificationScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    console.log('✅ Simple Notification Scheduler initialized');
  }

  async scheduleBookingConfirmation(bookingId) {
    try {
      console.log(`📅 Scheduling notifications for booking ${bookingId}`);
      
      // Send confirmation immediately (with 5 second delay)
      setTimeout(async () => {
        try {
          console.log(`Sending confirmation for booking ${bookingId}...`);
          const result = await whatsappMetaService.sendBookingConfirmation(bookingId);
          console.log(`✅ Confirmation sent for booking ${bookingId}:`, result.success);
        } catch (error) {
          console.error(`❌ Failed to send confirmation for ${bookingId}:`, error.message);
        }
      }, 5000);

      // Schedule reminder for 1 hour before appointment
      const [booking] = await pool.query(
        `SELECT appointment_time FROM bookings WHERE id = ?`,
        [bookingId]
      );

      if (booking && booking[0]) {
        const appointmentTime = new Date(booking[0].appointment_time);
        const reminderTime = new Date(appointmentTime.getTime() - (60 * 60000)); // 1 hour before
        
        if (reminderTime > new Date()) {
          const delay = reminderTime.getTime() - Date.now();
          
          console.log(`⏰ Scheduled reminder for booking ${bookingId} in ${Math.round(delay/1000/60)} minutes`);
          
          const timerId = setTimeout(async () => {
            try {
              console.log(`Sending reminder for booking ${bookingId}...`);
              const result = await whatsappMetaService.sendSessionReminder(bookingId);
              console.log(`✅ Reminder sent for booking ${bookingId}:`, result.success);
              
              // Remove from scheduled jobs
              this.scheduledJobs.delete(`reminder-${bookingId}`);
            } catch (error) {
              console.error(`❌ Failed to send reminder for ${bookingId}:`, error.message);
            }
          }, delay);
          
          // Store the timer so we can cancel it if needed
          this.scheduledJobs.set(`reminder-${bookingId}`, timerId);
        }
      }
      
      return { success: true, bookingId };
    } catch (error) {
      console.error('Error scheduling notifications:', error);
      return { success: false, error: error.message };
    }
  }

  async checkPendingReminders() {
    try {
      // Find bookings that need reminders in the next 5 minutes
      const [bookings] = await pool.query(
        `SELECT b.id, b.appointment_time, 
                TIMESTAMPDIFF(MINUTE, NOW(), b.appointment_time) as minutes_until
         FROM bookings b
         WHERE b.status = 'scheduled'
         AND b.reminder_sent = 0
         AND b.appointment_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 65 MINUTE)
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_messages wm
           WHERE wm.booking_id = b.id
           AND wm.template_name = 'session_reminder'
           AND wm.success = 1
         )`
      );

      console.log(`🔍 Found ${bookings.length} bookings needing reminders`);

      for (const booking of bookings) {
        if (booking.minutes_until <= 60 && booking.minutes_until > 0) {
          // Send reminder now
          try {
            const result = await whatsappMetaService.sendSessionReminder(booking.id);
            console.log(`✅ Sent immediate reminder for booking ${booking.id}:`, result.success);
          } catch (error) {
            console.error(`❌ Failed to send immediate reminder for ${booking.id}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('Error checking pending reminders:', error);
    }
  }

  async checkPendingConfirmations() {
    try {
      // Find bookings that need confirmation
      const [bookings] = await pool.query(
        `SELECT b.id FROM bookings b
         WHERE b.status = 'scheduled'
         AND b.confirmation_sent = 0
         AND b.created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_messages wm
           WHERE wm.booking_id = b.id
           AND wm.template_name = 'booking_confirmation'
           AND wm.success = 1
         )`
      );

      console.log(`📨 Found ${bookings.length} bookings needing confirmation`);

      for (const booking of bookings) {
        try {
          const result = await whatsappMetaService.sendBookingConfirmation(booking.id);
          console.log(`✅ Sent confirmation for booking ${booking.id}:`, result.success);
        } catch (error) {
          console.error(`❌ Failed to send confirmation for ${booking.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error checking pending confirmations:', error);
    }
  }

  cancelBookingNotifications(bookingId) {
    // Cancel scheduled reminder
    const timerKey = `reminder-${bookingId}`;
    if (this.scheduledJobs.has(timerKey)) {
      clearTimeout(this.scheduledJobs.get(timerKey));
      this.scheduledJobs.delete(timerKey);
      console.log(`❌ Cancelled reminder for booking ${bookingId}`);
    }
    
    return { success: true, cancelled: true };
  }

  async start() {
    console.log('🚀 Starting Notification Scheduler...');
    
    // Check for pending confirmations and reminders immediately
    await this.checkPendingConfirmations();
    await this.checkPendingReminders();
    
    // Set up periodic checks
    // Check every 5 minutes for pending confirmations
    setInterval(() => {
      this.checkPendingConfirmations();
    }, 5 * 60 * 1000); // 5 minutes
    
    // Check every minute for pending reminders (more frequent for accuracy)
    setInterval(() => {
      this.checkPendingReminders();
    }, 60 * 1000); // 1 minute
    
    console.log('✅ Notification Scheduler started successfully');
    console.log('   • Confirmation checks: every 5 minutes');
    console.log('   • Reminder checks: every minute');
    
    return { success: true };
  }

  stop() {
    console.log('🛑 Stopping Notification Scheduler...');
    
    // Clear all scheduled timeouts
    for (const [key, timerId] of this.scheduledJobs) {
      clearTimeout(timerId);
    }
    this.scheduledJobs.clear();
    
    console.log('✅ Notification Scheduler stopped');
    return { success: true };
  }
}

export const scheduler = new NotificationScheduler();