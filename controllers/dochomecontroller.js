import { pool } from '../databaseconfig.js';

// ✅ Get available slots (excluding expired ones)
export const getAvailableSlots = async (req, res) => {
  const doctorId = req.user.id;
  const currentDate = new Date();

  try {
    const [availableSlots] = await pool.query(
      `SELECT 
          id,
          start_time,
          end_time,
          status,
          CASE 
            WHEN end_time < NOW() THEN 'expired' 
            ELSE status 
          END AS display_status
        FROM doctor_availability 
        WHERE doctor_id = ?
        AND status = 'available'
        ORDER BY start_time ASC`,
      [doctorId]
    );

    const currentAvailableSlots = availableSlots.map(slot => {
      const endTime = new Date(slot.end_time);
      if (endTime < currentDate) {
        return { ...slot, status: 'expired', display_status: 'expired' };
      }
      return slot;
    });

    res.status(200).json(currentAvailableSlots);
  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({ error: 'Failed to fetch available slots' });
  }
};

// ✅ Get booked slots for the logged-in doctor

export const getBookedSlots = async (req, res) => {
  console.log('=== getBookedSlots Debug ===');
  console.log('req.user:', req.user);

  const doctorId = req.user?.id;

  if (!doctorId) {
    console.error('Doctor ID is undefined');
    return res.status(400).json({ error: 'Doctor ID not found' });
  }

  try {
    // First, let's check if there are any bookings at all for this doctor
    console.log('Checking for any bookings for doctor ID:', doctorId);
    
    const [allBookings] = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE doctor_id = ?`,
      [doctorId]
    );
    console.log('Total bookings for this doctor:', allBookings[0].total);

    // Check bookings with different statuses
    const [statusCheck] = await pool.query(
      `SELECT status, COUNT(*) as count FROM bookings WHERE doctor_id = ? GROUP BY status`,
      [doctorId]
    );
    console.log('Bookings by status:', statusCheck);

    // ✅ FIXED: Added b.client_id to the SELECT statement
    const [rows] = await pool.query(
      `SELECT 
        b.id,
        b.client_id,  -- ✅ THIS WAS MISSING!
        b.appointment_time,
        b.status,
        b.created_at,
        u.Name AS client_name,
        u.Email AS client_email,
        u.PhoneNumber AS client_phone
      FROM bookings b
      JOIN users u ON b.client_id = u.id
      WHERE b.doctor_id = ?
        AND b.status IN ('scheduled', 'confirmed', 'pending')
      ORDER BY b.appointment_time ASC`,
      [doctorId]
    );

    console.log('Raw query result:', rows);
    console.log('Number of rows returned:', rows.length);

    // Log each row to see the data
    rows.forEach((row, index) => {
      console.log(`Row ${index}:`, {
        id: row.id,
        client_id: row.client_id, // ✅ Now this will be logged
        appointment_time: row.appointment_time,
        status: row.status,
        client_name: row.client_name
      });
    });

    // Transform the data to match what the frontend expects
    const transformedRows = rows.map(row => {
      const appointmentDate = new Date(row.appointment_time);
      console.log('Processing appointment_time:', row.appointment_time);
      console.log('Parsed date:', appointmentDate);
      
      const transformed = {
        id: row.id,
        client_id: row.client_id, // ✅ Include client_id in transformed data
        date: row.appointment_time ? appointmentDate.toISOString().split('T')[0] : '',
        time: row.appointment_time ? appointmentDate.toTimeString().split(' ')[0].substring(0, 5) : '',
        status: row.status,
        created_at: row.created_at,
        client_name: row.client_name,
        client_email: row.client_email,
        client_phone: row.client_phone || 'N/A'
      };
      
      console.log('Transformed row with client_id:', transformed);
      return transformed;
    });

    console.log('Final transformed data being sent to frontend:', transformedRows);
    res.status(200).json(transformedRows);
  } catch (error) {
    console.error('📅 Booked slots error:', error);
    res.status(500).json({ error: 'Failed to fetch booked slots' });
  }
};

// ✅ Add available slot for doctor
export const addAvailableSlots = async (req, res) => {
  const { date, start_time, end_time } = req.body;
  const doctorId = req.user.id;

  try {
    const startDateTime = `${date} ${start_time}:00`;
    const endDateTime = `${date} ${end_time}:00`;

    const startTime = new Date(startDateTime);
    const endTime = new Date(endDateTime);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({ error: 'Invalid date/time format' });
    }

    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    const [existingSlots] = await pool.query(
      `SELECT id FROM doctor_availability 
       WHERE doctor_id = ? 
       AND status = 'available'
       AND DATE(start_time) = DATE(?)
       AND (
         (start_time <= ? AND end_time > ?) OR
         (start_time < ? AND end_time >= ?) OR
         (start_time >= ? AND end_time <= ?)
       )`,
      [doctorId, startDateTime, endDateTime, startDateTime, endDateTime, startDateTime, startDateTime, endDateTime]
    );

    if (existingSlots.length > 0) {
      return res.status(400).json({ error: 'This time slot overlaps with an existing slot' });
    }

    const [result] = await pool.query(
      `INSERT INTO doctor_availability
       (doctor_id, start_time, end_time, status)
       VALUES (?, ?, ?, 'available')`,
      [doctorId, startDateTime, endDateTime]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      start_time: startDateTime,
      end_time: endDateTime,
      status: 'available'
    });
  } catch (error) {
    console.error('Error adding slot:', error);
    res.status(500).json({ error: 'Failed to add slot', details: error.message });
  }
};

// ✅ Update an available slot
export const updateAvailableSlot = async (req, res) => {
  const { slot_id } = req.params;
  const { start_time, end_time } = req.body;
  const doctorId = req.user.id;

  try {
    const startTime = new Date(start_time);
    const endTime = new Date(end_time);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({ error: 'Invalid date/time format' });
    }

    if (startTime >= endTime) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    const [existingSlots] = await pool.query(
      `SELECT id FROM doctor_availability 
       WHERE doctor_id = ? 
       AND status = 'available'
       AND id != ?
       AND (
         (start_time <= ? AND end_time > ?) OR
         (start_time < ? AND end_time >= ?) OR
         (start_time >= ? AND end_time <= ?)
       )`,
      [doctorId, slot_id, end_time, start_time, end_time, start_time, start_time, end_time]
    );

    if (existingSlots.length > 0) {
      return res.status(400).json({ error: 'This time slot overlaps with an existing slot' });
    }

    const [result] = await pool.query(
      `UPDATE doctor_availability 
       SET start_time = ?, end_time = ?
       WHERE id = ? AND doctor_id = ?`,
      [start_time, end_time, slot_id, doctorId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating slot:', error);
    res.status(500).json({ error: 'Failed to update slot' });
  }
};

// ✅ Delete an available slot
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
