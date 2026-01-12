import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { pool } from '../databaseconfig.js';

dotenv.config();

export const DocLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }
    
    const trimmedEmail = email.trim().toLowerCase();
    
    const [doctors] = await pool.query(
      'SELECT * FROM docinfo WHERE LOWER(email) = LOWER(?)',
      [trimmedEmail]
    );
    
    if (!doctors.length) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    const doctor = doctors[0];
    
    if (!doctor.password) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    const isMatch = await bcrypt.compare(password, doctor.password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    const tokenPayload = {
      id: doctor.id,
      name: doctor.name,
      email: doctor.email,
      role: 'doctor'
    };
    
    if (!process.env.DB_JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }
    
    const token = jwt.sign(tokenPayload, process.env.DB_JWT_SECRET, {
      expiresIn: '24h'
    });
    
    const responseData = {
      success: true,
      token,
      user: {
        id: doctor.id,
        name: doctor.name,
        email: doctor.email,
        role: 'doctor',
        image: doctor.image || null
      }
    };
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Doctor login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

export default {
  DocLogin
};
