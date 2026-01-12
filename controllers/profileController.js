import { pool } from '../databaseconfig.js';
import bcrypt from 'bcryptjs';

export const updateProfile = async (req, res) => {
  const { userId, name, currentPassword, newPassword } = req.body;

  try {
    // Start a transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update name if provided
      if (name) {
        await connection.query('UPDATE users SET Name = ? WHERE id = ?', [name, userId]);
      }

      // Update password if provided
      if (currentPassword && newPassword) {
        // Verify current password
        const [user] = await connection.query('SELECT Password FROM users WHERE id = ?', [userId]);
        const isMatch = await bcrypt.compare(currentPassword, user[0].Password);

        if (!isMatch) {
          await connection.rollback();
          return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await connection.query('UPDATE users SET Password = ? WHERE id = ?', [hashedPassword, userId]);
      }

      await connection.commit();
      res.status(200).json({ message: 'Profile updated successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getProfileHistory = async (req, res) => {
  const { userId } = req.params;

  try {
    // This is a placeholder query. You'll need to adjust it based on your actual database structure
    const [history] = await pool.query('SELECT * FROM user_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10', [userId]);
    res.status(200).json(history);
  } catch (error) {
    console.error('Error fetching profile history:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};