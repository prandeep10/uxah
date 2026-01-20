// middleware/authMiddleware.js - CORRECTED VERSION
import jwt from 'jsonwebtoken';
import { pool } from '../databaseconfig.js';

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    console.log('Auth header received:', authHeader ? 'Present' : 'Missing');
     
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header is missing.'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header must start with "Bearer ".'
      });
    }
     
    const token = authHeader.split(' ')[1];
    
    if (!token || token === 'null' || token === 'undefined') {
      return res.status(401).json({
        success: false,
        error: 'Token is missing or invalid.'
      });
    }

    console.log('Token received:', token.substring(0, 20) + '...');
     
    try {
      if (!process.env.DB_JWT_SECRET) {
        console.error('JWT_SECRET is not configured');
        return res.status(500).json({
          success: false,
          error: 'Server configuration error'
        });
      }

      const decoded = jwt.verify(token, process.env.DB_JWT_SECRET);
      console.log('Token decoded successfully:', { id: decoded.id, role: decoded.role });
       
      const currentTime = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < currentTime) {
        return res.status(401).json({
          success: false,
          error: 'Token expired'
        });
      }
       
      req.user = await fetchUserDetails(decoded);
      console.log('Authenticated User:', { id: req.user.id, name: req.user.name, role: req.user.role });
       
      return next();
    } catch (error) {
      console.error('Token verification error:', error);
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token format or signature'
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token has expired'
        });
      }

      if (error.name === 'NotBeforeError') {
        return res.status(401).json({
          success: false,
          error: 'Token not active yet'
        });
      }
      
      return res.status(401).json({
        success: false,
        error: 'Token validation failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  } catch (error) {
    console.error('Authentication Middleware Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed due to an unexpected error.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const fetchUserDetails = async (decodedToken) => {
  const { id, role } = decodedToken;
  
  console.log('Fetching user details for:', { id, role });
   
  try {
    if (role === 'doctor') {
      const [doctors] = await pool.query(
        'SELECT id, name, email FROM docinfo WHERE id = ?',
        [id]
      );
      if (doctors.length === 0) {
        throw new Error('Doctor not found in database');
      }
      const doctor = doctors[0];
      return {
        id: doctor.id,
        name: doctor.name,
        email: doctor.email,
        role: 'doctor'
      };
    } else {
      const [users] = await pool.query(
        'SELECT id, Name AS name, Email AS email FROM users WHERE id = ?',
        [id]
      );
      if (users.length === 0) {
        throw new Error('User not found in database');
      }
      const user = users[0];
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'client'
      };
    }
  } catch (error) {
    console.error('Error fetching user details:', error);
    throw error;
  }
};

// Role-based middleware
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated' 
      });
    }
    
    const rolesArray = Array.isArray(roles) ? roles : [roles];
    
    if (!rolesArray.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. Required role: ${rolesArray.join(' or ')}`,
        userRole: req.user.role
      });
    }
    
    next();
  };
};

export const requireDoctor = requireRole(['doctor']);
export const requireClient = requireRole(['client']);

export default authMiddleware;