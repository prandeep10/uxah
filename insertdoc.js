import bcrypt from 'bcryptjs';
import { pool } from './databaseconfig.js';

async function hashPassword(password) {
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  return hashedPassword;
}

async function insertUser(name, email, password, description, price, image, PhoneNumber) {
  let connection;
  try {
    connection = await pool.getConnection();
    const hashedPassword = await hashPassword(password);
    
    const [rows] = await connection.execute(
      'INSERT INTO docinfo (name, email, password, description, price, image, PhoneNumber) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, email.toLowerCase(), hashedPassword, description, price, image, PhoneNumber]
    );
    
    console.log('User inserted with ID:', rows.insertId);
    return rows.insertId;
  } catch (error) {
    console.error('Detailed Insertion Error:', {
      errorCode: error.code,
      errorMessage: error.message,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

// Usage example
insertUser(
  'Test Doctor 7',  'meghneilkashyap95@gmail.com', 'Nigga@1234', 'Conduct scientific studies of brain function...', '500', 'img/home-section-3.png', '9085647257').catch(console.error);

export { insertUser };