import { createNotification, initializeNotificationTemplates } from './notificationController.js';
import schedule from 'node-schedule';
import { pool } from '../databaseconfig.js';

export const scheduleSessionReminders = async () => {
  try {
    Object.keys(schedule.scheduledJobs).forEach(jobName => {
      if (jobName.startsWith('reminder-')) schedule.cancelJob(jobName);
    });
    const [bookings] = await pool.query(
      `SELECT b.id, b.client_id, b.doctor_id, b.appointment_time
         FROM bookings b
         WHERE b.status = 'scheduled'
           AND b.appointment_time > NOW()
           AND b.appointment_time < DATE_ADD(NOW(), INTERVAL 24 HOUR)`
    );
    for (const booking of bookings) {
      const reminderTime = new Date(booking.appointment_time);
      reminderTime.setHours(reminderTime.getHours() - 1);
      if (reminderTime > new Date()) {
        schedule.scheduleJob(`reminder-${booking.id}`, reminderTime, async () => {
          await createNotification(booking.client_id, 'session_reminder', booking.id);
          await createNotification(booking.doctor_id, 'session_reminder', booking.id);
        });
      }
    }
  } catch (error) {
    console.error('Error scheduling session reminders:', error);
  }
};
export const startNotificationService = async () => {
  try {
    await initializeNotificationTemplates();
    await scheduleSessionReminders();
    schedule.scheduleJob('0 * * * *', async () => {
      await scheduleSessionReminders();
    });
    console.log('Notification service started successfully');
  } catch (error) {
    console.error('Error starting notification service:', error);
  }
};
