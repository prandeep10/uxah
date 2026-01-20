import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { pool } from '../databaseconfig.js';

dotenv.config();

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    const trimmedEmail = email.trim().toLowerCase();
    console.log('🔍 Login attempt for:', trimmedEmail);

    const [results] = await pool.execute(
      'SELECT id, Name AS name, Email AS email, Password FROM users WHERE LOWER(Email) = ?',
      [trimmedEmail]
    );

    console.log('📊 Query results:', results.length > 0 ? 'User found' : 'No user found');

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = results[0];
    console.log('👤 User found:', user.email);
    console.log('🔐 Password hash from DB:', 
    user.Password.substring(0, 20) + '...');
    console.log('🔑 Password provided:', password);

    const isMatch = await bcrypt.compare(password, user.Password);
    console.log('✅ Password match:', isMatch);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'client'
    };

    const token = jwt.sign(tokenPayload, process.env.DB_JWT_SECRET, {
      expiresIn: '24h'
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'client'
      }
    });
  } catch (error) {
    console.error('Client login error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred during login'
    });
  }
};

export const checkLoginStatus = (req, res) => {
  try {
    if (req.user) {
      return res.status(200).json({
        success: true,
        loggedIn: true,
        user: req.user
      });
    } else {
      return res.status(401).json({
        success: false,
        loggedIn: false,
        error: 'Not authenticated'
      });
    }
  } catch (error) {
    console.error('Check login status error:', error);
    return res.status(500).json({
      success: false,
      loggedIn: false,
      error: 'Internal server error'
    });
  }
};

export default {
  login,
  checkLoginStatus
};
