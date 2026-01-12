// controllers/bookingController.js - COMPLETE UPDATED VERSION WITH WHATSAPP
import { pool } from '../databaseconfig.js';
import { createNotification } from './notificationController.js';
import { scheduler } from '../services/notificationScheduler.js';
import { whatsappMetaService } from '../services/whatsappMetaService.js';

// Fetch available slots for a specific doctor
export const getDocAvailableSlots = async (req, res) => {
  const { doctorId } = req.params;
  const currentDate = new Date();

  try {
    // Validate doctorId
    if (!doctorId) {
      return res.status(400).json({ 
        error: 'Doctor ID is required',
        message: 'No doctor ID provided in request'
      });
    }

    console.log('Received doctorId:', doctorId);

    // Fetch available slots with expired status calculation
    const [availableSlots] = await pool.query(
      `SELECT 
          id,
          doctor_id,
          start_time,
          end_time,
          CASE 
            WHEN end_time < NOW() THEN 'expired' 
            ELSE status 
          END AS status
        FROM doctor_availability 
        WHERE doctor_id = ?
        AND status = 'available'
        ORDER BY start_time ASC`,
      [doctorId]
    );

    // Fetch booked slots
    const [bookedSlots] = await pool.query(
      `SELECT 
          da.id,
          da.doctor_id,
          da.start_time,
          da.end_time,
          da.status,
          c.name AS client_name,
          c.email AS client_email
        FROM doctor_availability da
        LEFT JOIN bookings b ON da.id = b.slot_id
        LEFT JOIN clientinfo c ON b.client_id = c.id
        WHERE da.doctor_id = ?
        AND da.status = 'booked'
        ORDER BY da.start_time ASC`,
      [doctorId]
    );

    console.log('Available Slots Detailed:', JSON.stringify(availableSlots, null, 2));
    console.log('Booked Slots Detailed:', JSON.stringify(bookedSlots, null, 2));

    // Return slots
    res.status(200).json({
      available: availableSlots,
      booked: bookedSlots
    });

  } catch (error) {
    console.error('Comprehensive Error in getDocAvailableSlots:', {
      message: error.message,
      stack: error.stack,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      error: 'Failed to fetch available slots',
      details: error.message,
      stack: error.stack
    });
  }
};

// Get client bookings
export const getClientBookings = async (req, res) => {
  const clientId = req.user.id;

  try {
    // Validate clientId
    if (!clientId) {
      return res.status(400).json({ 
        success: false,
        error: 'Client ID is required'
      });
    }

    // Fetch bookings with doctor details and WhatsApp status
    const [bookings] = await pool.query(
      `SELECT 
        b.id,
        b.appointment_time,
        b.status,
        b.created_at,
        b.confirmation_sent,
        b.reminder_sent,
        b.whatsapp_confirmation_sent,
        b.whatsapp_reminder_sent,
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.image AS doctor_image,
        d.description AS doctor_specialization,
        d.price AS consultation_fee
      FROM bookings b
      JOIN docinfo d ON b.doctor_id = d.id
      WHERE b.client_id = ?
      ORDER BY b.appointment_time DESC`,
      [clientId]
    );

    // Format dates for better readability
    const formattedBookings = bookings.map(booking => ({
      ...booking,
      appointment_time: new Date(booking.appointment_time).toLocaleString(),
      created_at: new Date(booking.created_at).toLocaleString(),
      whatsapp_status: {
        confirmation_sent: booking.confirmation_sent,
        reminder_sent: booking.reminder_sent,
        last_confirmation: booking.whatsapp_confirmation_sent 
          ? new Date(booking.whatsapp_confirmation_sent).toLocaleString() 
          : null,
        last_reminder: booking.whatsapp_reminder_sent 
          ? new Date(booking.whatsapp_reminder_sent).toLocaleString() 
          : null
      }
    }));

    res.status(200).json({
      success: true,
      bookings: formattedBookings
    });

  } catch (error) {
    console.error('Error fetching client bookings:', {
      message: error.message,
      stack: error.stack,
      clientId
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bookings',
      message: error.message
    });
  }
};

// Fetch available slots for the doctor dashboard
export const getAvailableSlots = async (req, res) => {
  const doctorId = req.user.id;
  const currentDate = new Date();
    
  try {
    // Get available slots with expiration check
    const [availableSlots] = await pool.query(
      `SELECT 
          id,
          start_time,
          end_time,
          CASE 
            WHEN end_time < NOW() THEN 'expired' 
            ELSE status 
          END AS status
        FROM doctor_availability 
        WHERE doctor_id = ?
        AND status = 'available'
        ORDER BY start_time ASC`,
      [doctorId]
    );

    // Get booked slots with client info
    const [bookedSlots] = await pool.query(
      `SELECT 
          da.id,
          da.start_time,
          da.end_time,
          da.status,
          c.name AS client_name,
          c.email AS client_email
        FROM doctor_availability da
        LEFT JOIN bookings b ON da.id = b.slot_id
        LEFT JOIN clientinfo c ON b.client_id = c.id
        WHERE da.doctor_id = ?
        AND da.status = 'booked'
        ORDER BY da.start_time ASC`,
      [doctorId]
    );

    res.status(200).json({
      available: availableSlots,
      booked: bookedSlots
    });
  } catch (error) {
    console.error('Error fetching slots:', error);
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
};

// Add available slots
export const addAvailableSlots = async (req, res) => {
  const { slots } = req.body;
  const doctorId = req.user.id;

  try {
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'Slots must be an array' });
    }

    const results = [];
    
    // Add debug logging
    console.log('Received slots for adding:', JSON.stringify(slots));
    
    for (const slot of slots) {
      // Use ISO string format for consistency
      const startTime = new Date(slot.start_time);
      const endTime = new Date(slot.end_time);

      // More extensive validation
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
        console.error('Invalid date format:', { start: slot.start_time, end: slot.end_time });
        continue;
      }
      
      if (startTime >= endTime) {
        console.error('Invalid time range:', { start: startTime, end: endTime });
        continue;
      }

      // Check for overlapping slots
      const [existingSlots] = await pool.query(
        `SELECT id FROM doctor_availability 
         WHERE doctor_id = ? 
         AND status = 'available'
         AND (
           (start_time <= ? AND end_time > ?) OR
           (start_time < ? AND end_time >= ?) OR
           (start_time >= ? AND end_time <= ?)
         )`,
        [doctorId, endTime, startTime, endTime, startTime, startTime, endTime]
      );

      if (existingSlots.length > 0) {
        console.log('Overlapping slot found, skipping');
        continue;
      }
      
      console.log('Inserting slot:', { 
        doctorId, 
        startTime: startTime.toISOString(), 
        endTime: endTime.toISOString() 
      });

      const [result] = await pool.query(
        `INSERT INTO doctor_availability
         (doctor_id, start_time, end_time, status)
         VALUES (?, ?, ?, 'available')`,
        [doctorId, startTime, endTime]
      );

      results.push({
        id: result.insertId,
        start_time: startTime,
        end_time: endTime,
        status: 'available'
      });
    }

    console.log('Added slots:', results.length);
    
    res.status(201).json({
      success: true,
      added: results.length,
      slots: results
    });
  } catch (error) {
    console.error('Error adding slots:', error);
    res.status(500).json({ error: 'Failed to add slots', details: error.message });
  }
};

// Delete an available slot
export const deleteAvailableSlot = async (req, res) => {
  const { slot_id } = req.params;
  const doctorId = req.user.id;

  try {
    const [result] = await pool.query(
      `DELETE FROM doctor_availability
        WHERE id = ? AND doctor_id = ?`,
      [slot_id, doctorId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting slot:', error);
    res.status(500).json({ error: 'Failed to delete slot' });
  }
};

// Get booked slots for doctor
export const getBookedSlots = async (req, res) => {
  const doctorId = req.user.id;

  try {
    const [bookedSlots] = await pool.query(
      `SELECT 
          da.id,
          da.start_time,
          da.end_time,
          c.name AS client_name,
          c.email AS client_email,
          c.phone AS client_phone,
          b.id AS booking_id,
          b.status AS booking_status
        FROM doctor_availability da
        LEFT JOIN bookings b ON da.id = b.slot_id
        LEFT JOIN clientinfo c ON b.client_id = c.id
        WHERE da.doctor_id = ?
        AND da.status = 'booked'
        ORDER BY da.start_time ASC`,
      [doctorId]
    );

    res.status(200).json({
      success: true,
      bookedSlots: bookedSlots
    });
  } catch (error) {
    console.error('Error fetching booked slots:', error);
    res.status(500).json({ error: 'Failed to fetch booked slots' });
  }
};

// Create a new booking - UPDATED WITH WHATSAPP INTEGRATION
export const createBooking = async (req, res) => {
  const { slotId, doctorId, clientName, clientEmail, clientPhone } = req.body;
  const clientId = req.user.id;

  try {
    // Input validation
    if (!slotId || !doctorId || !clientName || !clientEmail) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: 'slotId, doctorId, clientName, and clientEmail are required'
      });
    }

    // Convert to integers to ensure proper data types
    const slotIdInt = parseInt(slotId);
    const doctorIdInt = parseInt(doctorId);

    if (isNaN(slotIdInt) || isNaN(doctorIdInt)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data types',
        details: 'slotId and doctorId must be valid numbers'
      });
    }

    console.log('Processing booking with validated data:', {
      slotId: slotIdInt,
      doctorId: doctorIdInt,
      clientId,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      clientPhone: clientPhone || null
    });

    // First, verify the doctor exists and get doctor info
    const [doctorCheck] = await pool.query(
      `SELECT id, name, PhoneNumber as doctor_phone FROM docinfo WHERE id = ?`,
      [doctorIdInt]
    );

    if (doctorCheck.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Doctor not found',
        details: `No doctor found with ID ${doctorIdInt}`
      });
    }

    const doctorInfo = doctorCheck[0];

    // Check if the slot is available and not expired
    const [slot] = await pool.query(
      `SELECT * FROM doctor_availability 
       WHERE id = ? AND doctor_id = ? AND status = 'available' AND end_time > NOW()`,
      [slotIdInt, doctorIdInt]
    );

    if (slot.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Slot not available',
        details: 'Slot not found, already booked, or expired'
      });
    }

    // Start a transaction
    await pool.query('START TRANSACTION');

    console.log('Booking with client info:', {
      clientId,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      clientPhone: clientPhone || 'No phone provided'
    });

    // Insert or update client info with phone number
    await pool.query(
      `INSERT INTO clientinfo (id, name, email, phone, created_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), phone = VALUES(phone)`,
      [clientId, clientName.trim(), clientEmail.trim(), clientPhone || null]
    );

    // Insert the booking with validated integer values
    const [bookingResult] = await pool.query(
      `INSERT INTO bookings
       (client_id, doctor_id, slot_id, appointment_time, status)
       VALUES (?, ?, ?, ?, 'scheduled')`,
      [clientId, doctorIdInt, slotIdInt, slot[0].start_time]
    );

    const bookingId = bookingResult.insertId;

    // Update the slot status to 'booked'
    await pool.query(
      `UPDATE doctor_availability
       SET status = 'booked'
       WHERE id = ?`,
      [slotIdInt]
    );

    // Create notification for the therapist (doctor) about new booking
    try {
      console.log('Creating notification for therapist:', doctorIdInt);
      await createNotification(
        doctorIdInt, 
        'new_booking', 
        bookingId,
        {
          clientName: clientName.trim(),
          date: new Date(slot[0].start_time).toLocaleDateString(),
          time: new Date(slot[0].start_time).toLocaleTimeString()
        }
      );
      console.log('Therapist notification created successfully');
    } catch (notificationError) {
      console.error('Failed to create therapist notification:', notificationError);
      // Don't fail the booking if notification fails
    }

    // Create confirmation notification for the client
    try {
      console.log('Creating notification for client:', clientId);
      await createNotification(
        clientId,
        'booking_confirmation',
        bookingId,
        {
          doctorName: doctorInfo.name,
          date: new Date(slot[0].start_time).toLocaleDateString(),
          time: new Date(slot[0].start_time).toLocaleTimeString()
        }
      );
      console.log('Client notification created successfully');
    } catch (notificationError) {
      console.error('Failed to create client notification:', notificationError);
      // Don't fail the booking if notification fails
    }

    // Commit the transaction
    await pool.query('COMMIT');

    console.log(`✅ Booking ${bookingId} created successfully`);
    
    // WHATSAPP INTEGRATION: Schedule WhatsApp notifications
    try {
      const scheduleResult = await scheduler.scheduleBookingConfirmation(bookingId);
      console.log(`✅ WhatsApp notifications scheduled for booking ${bookingId}:`, scheduleResult);
      
      // If immediate WhatsApp sending is enabled, send confirmation now
      if (process.env.SEND_IMMEDIATE_WHATSAPP === 'true') {
        try {
          const whatsappResult = await whatsappMetaService.sendBookingConfirmation(bookingId);
          console.log(`✅ Immediate WhatsApp confirmation sent for booking ${bookingId}:`, whatsappResult.success);
          
          // Update booking with WhatsApp confirmation timestamp
          if (whatsappResult.success) {
            await pool.query(
              `UPDATE bookings SET whatsapp_confirmation_sent = NOW() WHERE id = ?`,
              [bookingId]
            );
          }
        } catch (whatsappError) {
          console.error(`❌ Immediate WhatsApp failed for booking ${bookingId}:`, whatsappError.message);
          // Log the error but don't fail the booking
          await pool.query(
            `INSERT INTO whatsapp_messages (booking_id, message, success, error_message, created_at)
             VALUES (?, 'Booking confirmation', 0, ?, NOW())`,
            [bookingId, whatsappError.message]
          );
        }
      }
    } catch (schedulerError) {
      console.error('❌ Failed to schedule WhatsApp notifications:', schedulerError);
      // Don't fail the booking if scheduler fails
    }

    // Send success response
    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      bookingId: bookingId,
      appointmentTime: slot[0].start_time,
      doctorName: doctorInfo.name,
      notifications: {
        inApp: true,
        whatsapp: {
          scheduled: true,
          immediateSent: process.env.SEND_IMMEDIATE_WHATSAPP === 'true',
          reminderScheduled: true
        }
      }
    });

  } catch (error) {
    // Rollback the transaction in case of error
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }
    
    console.error('Error creating booking:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create booking';
    let errorDetails = error.message;

    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      errorMessage = 'Doctor or slot reference error';
      errorDetails = 'The specified doctor or slot does not exist in the database';
    } else if (error.code === 'ER_DUP_ENTRY') {
      errorMessage = 'Duplicate booking attempt';
      errorDetails = 'This booking already exists';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      message: errorDetails,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// NEW: Get booking WhatsApp status
export const getBookingWhatsAppStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    
    // Verify user has access to this booking
    const [booking] = await pool.query(
      `SELECT b.*, c.name as client_name, d.name as doctor_name,
              c.phone as client_phone, d.PhoneNumber as doctor_phone
       FROM bookings b
       JOIN clientinfo c ON b.client_id = c.id
       JOIN docinfo d ON b.doctor_id = d.id
       WHERE b.id = ? AND (b.client_id = ? OR b.doctor_id = ?)`,
      [bookingId, userId, userId]
    );
    
    if (booking.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found or access denied'
      });
    }
    
    const bookingData = booking[0];
    
    // Get WhatsApp message history for this booking
    const [whatsappMessages] = await pool.query(
      `SELECT * FROM whatsapp_messages 
       WHERE booking_id = ? 
       ORDER BY created_at DESC`,
      [bookingId]
    );
    
    // Get scheduled notifications for this booking
    const [scheduledNotifications] = await pool.query(
      `SELECT * FROM notification_jobs 
       WHERE booking_id = ? 
       ORDER BY scheduled_for ASC`,
      [bookingId]
    );
    
    // Calculate time until appointment
    const appointmentTime = new Date(bookingData.appointment_time);
    const now = new Date();
    const minutesUntil = Math.floor((appointmentTime - now) / (1000 * 60));
    const hoursUntil = Math.floor(minutesUntil / 60);
    
    // Determine WhatsApp status
    const whatsappStatus = {
      confirmation: {
        sent: bookingData.confirmation_sent === 1,
        timestamp: bookingData.whatsapp_confirmation_sent,
        success: whatsappMessages.some(msg => 
          msg.template_name === 'booking_confirmation' && msg.success === 1
        )
      },
      reminder: {
        sent: bookingData.reminder_sent === 1,
        timestamp: bookingData.whatsapp_reminder_sent,
        scheduled: scheduledNotifications.some(notif => notif.job_type === 'reminder'),
        timeUntilAppointment: `${hoursUntil > 0 ? `${hoursUntil} hours and ` : ''}${minutesUntil % 60} minutes`
      },
      messages: whatsappMessages,
      scheduled: scheduledNotifications
    };
    
    res.json({
      success: true,
      booking: {
        id: bookingData.id,
        appointmentTime: bookingData.appointment_time,
        clientName: bookingData.client_name,
        doctorName: bookingData.doctor_name,
        clientPhone: bookingData.client_phone,
        doctorPhone: bookingData.doctor_phone,
        status: bookingData.status
      },
      whatsapp: whatsappStatus,
      appointmentInfo: {
        timeUntil: minutesUntil,
        formattedTime: `${hoursUntil > 0 ? `${hoursUntil}h ` : ''}${minutesUntil % 60}m`,
        shouldHaveReminder: minutesUntil > 5 && minutesUntil <= 65
      }
    });
    
  } catch (error) {
    console.error('Error getting booking WhatsApp status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// NEW: Resend WhatsApp notification
export const resendWhatsAppNotification = async (req, res) => {
  try {
    const { bookingId, notificationType } = req.body;
    const userId = req.user.id;
    
    // Verify user has access to this booking
    const [booking] = await pool.query(
      `SELECT b.*, c.phone as client_phone, d.PhoneNumber as doctor_phone,
              c.name as client_name, d.name as doctor_name
       FROM bookings b
       JOIN clientinfo c ON b.client_id = c.id
       JOIN docinfo d ON b.doctor_id = d.id
       WHERE b.id = ? AND (b.client_id = ? OR b.doctor_id = ?)`,
      [bookingId, userId, userId]
    );
    
    if (booking.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied or booking not found'
      });
    }
    
    const bookingData = booking[0];
    let result;
    let updateField = '';
    
    if (notificationType === 'confirmation') {
      result = await whatsappMetaService.sendBookingConfirmation(bookingId);
      updateField = 'whatsapp_confirmation_sent';
    } else if (notificationType === 'reminder') {
      result = await whatsappMetaService.sendSessionReminder(bookingId);
      updateField = 'whatsapp_reminder_sent';
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid notification type. Use "confirmation" or "reminder"'
      });
    }
    
    if (result.success) {
      // Update the timestamp in bookings table
      if (updateField) {
        await pool.query(
          `UPDATE bookings SET ${updateField} = NOW() WHERE id = ?`,
          [bookingId]
        );
      }
      
      res.json({
        success: true,
        message: `${notificationType} notification resent successfully`,
        result: {
          messageId: result.messageId,
          timestamp: result.timestamp
        },
        booking: {
          id: bookingId,
          clientName: bookingData.client_name,
          doctorName: bookingData.doctor_name
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        details: `Failed to resend ${notificationType} notification`
      });
    }
    
  } catch (error) {
    console.error('Error resending WhatsApp notification:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// NEW: Cancel booking and WhatsApp notifications
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const { cancellationReason } = req.body;
    
    // Verify user has access to this booking
    const [booking] = await pool.query(
      `SELECT b.*, c.phone as client_phone, d.PhoneNumber as doctor_phone,
              c.name as client_name, d.name as doctor_name, b.slot_id
       FROM bookings b
       JOIN clientinfo c ON b.client_id = c.id
       JOIN docinfo d ON b.doctor_id = d.id
       WHERE b.id = ? AND (b.client_id = ? OR b.doctor_id = ?)`,
      [bookingId, userId, userId]
    );
    
    if (booking.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found or access denied'
      });
    }
    
    const bookingData = booking[0];
    
    // Start transaction
    await pool.query('START TRANSACTION');
    
    // Update booking status
    await pool.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), 
       cancellation_reason = ? WHERE id = ?`,
      [cancellationReason || 'User cancelled', bookingId]
    );
    
    // Free up the slot
    await pool.query(
      `UPDATE doctor_availability SET status = 'available' WHERE id = ?`,
      [bookingData.slot_id]
    );
    
    // Create cancellation notifications
    await createNotification(
      bookingData.client_id,
      'booking_cancelled',
      bookingId,
      {
        doctorName: bookingData.doctor_name,
        date: new Date(bookingData.appointment_time).toLocaleDateString(),
        time: new Date(bookingData.appointment_time).toLocaleTimeString()
      }
    );
    
    await createNotification(
      bookingData.doctor_id,
      'booking_cancelled',
      bookingId,
      {
        clientName: bookingData.client_name,
        date: new Date(bookingData.appointment_time).toLocaleDateString(),
        time: new Date(bookingData.appointment_time).toLocaleTimeString()
      }
    );
    
    // Cancel scheduled WhatsApp notifications
    const cancelResult = await scheduler.cancelBookingNotifications(bookingId);
    console.log(`Cancelled ${cancelResult.cancelled || 0} notifications for booking ${bookingId}`);
    
    // Send cancellation WhatsApp messages
    try {
      const appointmentDate = new Date(bookingData.appointment_time);
      const formattedDate = appointmentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      const formattedTime = appointmentDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Send to client
      if (bookingData.client_phone) {
        const clientMessage = `❌ Appointment Cancelled\n\nDear ${bookingData.client_name},\n\nYour appointment with Dr. ${bookingData.doctor_name} on ${formattedDate} at ${formattedTime} has been cancelled.\n\nReason: ${cancellationReason || 'Not specified'}\n\nPlease book another appointment at https://uxaah.com`;
        
        await whatsappMetaService.sendMessage(bookingData.client_phone, clientMessage);
      }
      
      // Send to doctor
      if (bookingData.doctor_phone) {
        const doctorMessage = `❌ Appointment Cancelled\n\nDr. ${bookingData.doctor_name},\n\nYour appointment with ${bookingData.client_name} on ${formattedDate} at ${formattedTime} has been cancelled.\n\nReason: ${cancellationReason || 'Not specified'}`;
        
        await whatsappMetaService.sendMessage(bookingData.doctor_phone, doctorMessage);
      }
    } catch (whatsappError) {
      console.error('Failed to send cancellation WhatsApp:', whatsappError);
      // Don't fail the cancellation if WhatsApp fails
    }
    
    // Commit transaction
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      bookingId: bookingId,
      notifications: {
        whatsappCancelled: cancelResult.cancelled || 0,
        cancellationMessagesSent: true
      }
    });
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// NEW: Test WhatsApp for a booking
export const testBookingWhatsApp = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    
    // Verify user has access (admin or booking owner)
    const [booking] = await pool.query(
      `SELECT b.*, c.phone as client_phone, d.PhoneNumber as doctor_phone,
              c.name as client_name, d.name as doctor_name
       FROM bookings b
       JOIN clientinfo c ON b.client_id = c.id
       JOIN docinfo d ON b.doctor_id = d.id
       WHERE b.id = ? AND (b.client_id = ? OR b.doctor_id = ? OR ? IN (SELECT id FROM users WHERE role = 'admin'))`,
      [bookingId, userId, userId, userId]
    );
    
    if (booking.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    const bookingData = booking[0];
    
    // Test confirmation message
    const testMessage = `🔧 Test Message - Booking #${bookingId}\n\nThis is a test WhatsApp message for booking:\n\nClient: ${bookingData.client_name}\nDoctor: Dr. ${bookingData.doctor_name}\nTime: ${new Date(bookingData.appointment_time).toLocaleString()}\n\nIf you receive this, WhatsApp integration is working!`;
    
    let testResults = {};
    
    // Test sending to client
    if (bookingData.client_phone) {
      testResults.client = await whatsappMetaService.sendMessage(
        bookingData.client_phone,
        testMessage
      );
    }
    
    // Test sending to doctor
    if (bookingData.doctor_phone) {
      testResults.doctor = await whatsappMetaService.sendMessage(
        bookingData.doctor_phone,
        testMessage
      );
    }
    
    res.json({
      success: true,
      message: 'WhatsApp test completed',
      bookingId: bookingId,
      testResults: testResults,
      timestamps: {
        testPerformed: new Date().toISOString(),
        bookingTime: bookingData.appointment_time
      }
    });
    
  } catch (error) {
    console.error('Error testing booking WhatsApp:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// NEW: Get WhatsApp analytics for bookings
export const getBookingWhatsAppAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;
    
    // Build date filter
    let dateFilter = '';
    let queryParams = [userId, userId];
    
    if (startDate && endDate) {
      dateFilter = ' AND b.created_at BETWEEN ? AND ?';
      queryParams.push(startDate, endDate);
    } else {
      // Default to last 30 days
      dateFilter = ' AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }
    
    // Get booking statistics with WhatsApp info
    const [analytics] = await pool.query(
      `SELECT 
        DATE(b.created_at) as date,
        COUNT(*) as total_bookings,
        SUM(CASE WHEN b.confirmation_sent = 1 THEN 1 ELSE 0 END) as confirmations_sent,
        SUM(CASE WHEN b.reminder_sent = 1 THEN 1 ELSE 0 END) as reminders_sent,
        SUM(CASE WHEN b.whatsapp_confirmation_sent IS NOT NULL THEN 1 ELSE 0 END) as whatsapp_confirmations,
        SUM(CASE WHEN b.whatsapp_reminder_sent IS NOT NULL THEN 1 ELSE 0 END) as whatsapp_reminders,
        AVG(CASE WHEN b.whatsapp_confirmation_sent IS NOT NULL THEN 1 ELSE 0 END) * 100 as whatsapp_coverage
       FROM bookings b
       WHERE (b.client_id = ? OR b.doctor_id = ?) 
       ${dateFilter}
       GROUP BY DATE(b.created_at)
       ORDER BY date DESC
       LIMIT 30`,
      queryParams
    );
    
    // Get recent WhatsApp messages for user's bookings
    const [recentMessages] = await pool.query(
      `SELECT wm.*, b.appointment_time, c.name as client_name, d.name as doctor_name
       FROM whatsapp_messages wm
       LEFT JOIN bookings b ON wm.booking_id = b.id
       LEFT JOIN clientinfo c ON b.client_id = c.id
       LEFT JOIN docinfo d ON b.doctor_id = d.id
       WHERE (b.client_id = ? OR b.doctor_id = ? OR wm.user_id = ?)
       ORDER BY wm.created_at DESC
       LIMIT 20`,
      [userId, userId, userId]
    );
    
    // Calculate totals
    const totals = {
      totalBookings: analytics.reduce((sum, day) => sum + day.total_bookings, 0),
      whatsappConfirmations: analytics.reduce((sum, day) => sum + day.whatsapp_confirmations, 0),
      whatsappReminders: analytics.reduce((sum, day) => sum + day.whatsapp_reminders, 0),
      whatsappCoverage: analytics.length > 0 
        ? analytics.reduce((sum, day) => sum + day.whatsapp_coverage, 0) / analytics.length
        : 0
    };
    
    res.json({
      success: true,
      analytics: {
        daily: analytics,
        totals: totals,
        recentMessages: recentMessages
      },
      dateRange: {
        startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: endDate || new Date().toISOString().split('T')[0]
      }
    });
    
  } catch (error) {
    console.error('Error getting booking WhatsApp analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// NEW: Update booking (reschedule) with WhatsApp notifications
export const updateBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { newSlotId, cancellationReason } = req.body;
    const userId = req.user.id;
    
    if (!newSlotId) {
      return res.status(400).json({
        success: false,
        error: 'New slot ID is required for rescheduling'
      });
    }
    
    // Verify user has access and get current booking details
    const [currentBooking] = await pool.query(
      `SELECT b.*, c.phone as client_phone, d.PhoneNumber as doctor_phone,
              c.name as client_name, d.name as doctor_name, b.slot_id as old_slot_id
       FROM bookings b
       JOIN clientinfo c ON b.client_id = c.id
       JOIN docinfo d ON b.doctor_id = d.id
       WHERE b.id = ? AND (b.client_id = ? OR b.doctor_id = ?)`,
      [bookingId, userId, userId]
    );
    
    if (currentBooking.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found or access denied'
      });
    }
    
    const bookingData = currentBooking[0];
    
    // Check if new slot is available
    const [newSlot] = await pool.query(
      `SELECT * FROM doctor_availability 
       WHERE id = ? AND status = 'available' AND end_time > NOW()`,
      [newSlotId]
    );
    
    if (newSlot.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'New slot is not available'
      });
    }
    
    // Start transaction
    await pool.query('START TRANSACTION');
    
    // Free old slot
    await pool.query(
      `UPDATE doctor_availability SET status = 'available' WHERE id = ?`,
      [bookingData.old_slot_id]
    );
    
    // Update booking with new slot
    await pool.query(
      `UPDATE bookings 
       SET slot_id = ?, appointment_time = ?, 
           updated_at = NOW(), status = 'rescheduled'
       WHERE id = ?`,
      [newSlotId, newSlot[0].start_time, bookingId]
    );
    
    // Book new slot
    await pool.query(
      `UPDATE doctor_availability SET status = 'booked' WHERE id = ?`,
      [newSlotId]
    );
    
    // Create reschedule notifications
    await createNotification(
      bookingData.client_id,
      'booking_rescheduled',
      bookingId,
      {
        doctorName: bookingData.doctor_name,
        oldDate: new Date(bookingData.appointment_time).toLocaleString(),
        newDate: new Date(newSlot[0].start_time).toLocaleString()
      }
    );
    
    await createNotification(
      bookingData.doctor_id,
      'booking_rescheduled',
      bookingId,
      {
        clientName: bookingData.client_name,
        oldDate: new Date(bookingData.appointment_time).toLocaleString(),
        newDate: new Date(newSlot[0].start_time).toLocaleString()
      }
    );
    
    // Cancel old WhatsApp notifications
    await scheduler.cancelBookingNotifications(bookingId);
    
    // Schedule new WhatsApp notifications
    await scheduler.scheduleBookingConfirmation(bookingId);
    
    // Send reschedule WhatsApp messages
    try {
      const oldTime = new Date(bookingData.appointment_time);
      const newTime = new Date(newSlot[0].start_time);
      
      const formattedOldTime = oldTime.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const formattedNewTime = newTime.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Send to client
      if (bookingData.client_phone) {
        const clientMessage = `🔄 Appointment Rescheduled\n\nDear ${bookingData.client_name},\n\nYour appointment with Dr. ${bookingData.doctor_name} has been rescheduled.\n\nFrom: ${formattedOldTime}\nTo: ${formattedNewTime}\n\nReason: ${cancellationReason || 'Rescheduled by user'}\n\nYou'll receive a new confirmation message shortly.`;
        
        await whatsappMetaService.sendMessage(bookingData.client_phone, clientMessage);
      }
      
      // Send to doctor
      if (bookingData.doctor_phone) {
        const doctorMessage = `🔄 Appointment Rescheduled\n\nDr. ${bookingData.doctor_name},\n\nYour appointment with ${bookingData.client_name} has been rescheduled.\n\nFrom: ${formattedOldTime}\nTo: ${formattedNewTime}\n\nReason: ${cancellationReason || 'Rescheduled by user'}`;
        
        await whatsappMetaService.sendMessage(bookingData.doctor_phone, doctorMessage);
      }
    } catch (whatsappError) {
      console.error('Failed to send reschedule WhatsApp:', whatsappError);
    }
    
    // Commit transaction
    await pool.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Booking rescheduled successfully',
      bookingId: bookingId,
      oldAppointment: bookingData.appointment_time,
      newAppointment: newSlot[0].start_time,
      notifications: {
        inApp: true,
        whatsapp: {
          rescheduleSent: true,
          newNotificationsScheduled: true
        }
      }
    });
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error updating booking:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};