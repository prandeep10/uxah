import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool } from '../databaseconfig.js';

dotenv.config();

export const signup = async (req, res) => {
  console.log('Inside signup controller');
  
  const { Name, Password, confirmPassword, Age, Email, PhoneNumber } = req.body;
  
  try {
    // Validation
    if (!Name || !Password || !confirmPassword || !Age || !Email || !PhoneNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(Email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    if (!/^\+?[0-9]{10,15}$/.test(PhoneNumber)) {
      return res.status(400).json({ error: 'Please enter a valid phone number (10-15 digits)' });
    }
    
    if (Password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    
    // Check password strength
    console.log('Validating password strength:', Password);
    if (!isStrongPassword(Password)) {
      console.log('Password validation failed:', Password);
      return res.status(400).json({
        error: 'Password must be at least 8 characters long and include at least one lowercase letter, one uppercase letter, one digit, and one special character.'
      });
    }
    
    // Check if user already exists
    const existingUserQuery = 'SELECT * FROM users WHERE Email = ?';
    const [existingUser] = await pool.query(existingUserQuery, [Email]);
    
    if (existingUser.length > 0) {
      console.log('Email already exists');
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Password hashing
    const hashedPassword = await bcrypt.hash(Password, 10);
    
    // Insert user into the database (now with PhoneNumber)
    const insertUserQuery = 'INSERT INTO users (Name, Password, Age, Email, PhoneNumber) VALUES (?, ?, ?, ?, ?)';
    const [result] = await pool.query(insertUserQuery, [Name, hashedPassword, Age, Email, PhoneNumber]);
    
    if (result.affectedRows > 0) {
      // Successful registration
      return res.status(200).json({ message: 'Registration successful' });
    } else {
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ error: 'Internal server error. Please try again later.' });
  }
};

// Function to validate password strength
const isStrongPassword = (Password) => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(Password);
};