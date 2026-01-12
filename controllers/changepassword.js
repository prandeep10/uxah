import { pool } from '../databaseconfig.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const passwordChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many password change attempts. Please try again later.'
});

// Password reset via email token (BOTH users and doctors)
export const changepassword = async (req, res) => {
    try {
        const { token, newPassword, confirmPassword } = req.body;

        console.log('[Password Reset] Processing request');

        // Validate inputs
        if (!token || !newPassword || !confirmPassword) {
            return res.status(400).json({ 
                success: false,
                message: 'All fields are required.' 
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                success: false,
                message: 'Passwords do not match.' 
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ 
                success: false,
                message: 'Password must be at least 8 characters.' 
            });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.DB_JWT_SECRET || 'fallback-secret');
            console.log('[Password Reset] Token decoded:', decoded.email, '- Type:', decoded.userType);
        } catch (error) {
            console.error('[Password Reset] Token error:', error.name);
            if (error.name === 'TokenExpiredError') {
                return res.status(400).json({ 
                    success: false,
                    message: 'Reset link has expired. Please request a new one.' 
                });
            }
            return res.status(400).json({ 
                success: false,
                message: 'Invalid reset link.' 
            });
        }

        const email = decoded.email.toLowerCase().trim();
        const userType = decoded.userType || 'user'; // Default to user if not specified

        console.log('[Password Reset] Looking up:', userType, '-', email);

        // Query the correct table based on userType
        let tableName, passwordColumn, query;
        
        if (userType === 'doctor') {
            tableName = 'docinfo';
            passwordColumn = 'password';
            query = 'SELECT id, name, email, password FROM docinfo WHERE LOWER(email) = ?';
        } else {
            tableName = 'users';
            passwordColumn = 'Password';
            query = 'SELECT id, Name as name, Email as email, Password FROM users WHERE LOWER(Email) = ?';
        }

        const [results] = await pool.query(query, [email]);
        
        if (results.length === 0) {
            console.log('[Password Reset] User not found:', email);
            return res.status(404).json({ 
                success: false,
                message: 'User not found.' 
            });
        }

        const user = results[0];
        console.log('[Password Reset] User found - ID:', user.id, 'Email:', user.email);

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        console.log('[Password Reset] New password hashed');
        
        // Update password in the correct table
        const updateQuery = `UPDATE ${tableName} SET ${passwordColumn} = ? WHERE id = ?`;
        const [updateResult] = await pool.query(updateQuery, [hashedPassword, user.id]);

        console.log('[Password Reset] Update result:', updateResult.affectedRows, 'rows affected');
        console.log('[Password Reset] Password updated successfully for:', user.email);

        return res.status(200).json({ 
            success: true,
            message: 'Password updated successfully. You can now log in with your new password.' 
        });

    } catch (error) {
        console.error('[Password Reset] Server error:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Internal server error.',
            debug: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Change password when user is logged in (BOTH users and doctors)
export const changePasswordWithCurrent = async (req, res) => {
    passwordChangeLimiter(req, res, async () => {
        try {
            const { currentPassword, newPassword, confirmPassword } = req.body;
            const userEmail = req.user?.email;
            const userRole = req.user?.role; // 'client' or 'doctor'

            console.log('[Password Change] Processing request for:', userEmail, '- Role:', userRole);

            // Validate inputs
            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.status(400).json({ 
                    success: false,
                    message: 'All fields are required.' 
                });
            }

            if (newPassword !== confirmPassword) {
                return res.status(400).json({ 
                    success: false,
                    message: 'New passwords do not match.' 
                });
            }

            if (newPassword.length < 8) {
                return res.status(400).json({ 
                    success: false,
                    message: 'Password must be at least 8 characters.' 
                });
            }

            if (!userEmail || !userRole) {
                return res.status(401).json({ 
                    success: false,
                    message: 'Authentication required.' 
                });
            }

            const email = userEmail.toLowerCase().trim();

            // Query correct table based on role
            let tableName, passwordColumn, query;
            
            if (userRole === 'doctor') {
                tableName = 'docinfo';
                passwordColumn = 'password';
                query = 'SELECT id, name, email, password FROM docinfo WHERE LOWER(email) = ?';
            } else {
                tableName = 'users';
                passwordColumn = 'Password';
                query = 'SELECT id, Name as name, Email as email, Password FROM users WHERE LOWER(Email) = ?';
            }

            const [results] = await pool.query(query, [email]);
            
            if (results.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'User not found.' 
                });
            }

            const user = results[0];

            // Verify current password
            const currentPasswordHash = userRole === 'doctor' ? user.password : user.Password;
            const isValidPassword = await bcrypt.compare(currentPassword, currentPasswordHash);
            
            if (!isValidPassword) {
                return res.status(400).json({ 
                    success: false,
                    message: 'Current password is incorrect.' 
                });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            
            // Update password
            const updateQuery = `UPDATE ${tableName} SET ${passwordColumn} = ? WHERE id = ?`;
            await pool.query(updateQuery, [hashedPassword, user.id]);

            console.log('[Password Change] Password updated for:', user.email);

            return res.status(200).json({ 
                success: true,
                message: 'Password changed successfully.' 
            });

        } catch (error) {
            console.error('[Password Change] Server error:', error);
            return res.status(500).json({ 
                success: false,
                message: 'Internal server error.' 
            });
        }
    });
};