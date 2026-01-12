import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import { pool } from '../databaseconfig.js';
import dotenv from 'dotenv';

dotenv.config();

export const verifyemail = async (req, res) => {
    try {
        const { email } = req.body;

        console.log('[Email Reset] Request for:', email);

        if (!email) {
            return res.status(400).json({ 
                success: false,
                message: 'Email field cannot be empty.' 
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid email format.' 
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check BOTH tables - users and docinfo
        const [users] = await pool.query(
            'SELECT id, Name as name, Email as email FROM users WHERE LOWER(Email) = ?', 
            [normalizedEmail]
        );
        const [doctors] = await pool.query(
            'SELECT id, name, email FROM docinfo WHERE LOWER(email) = ?', 
            [normalizedEmail]
        );

        if (users.length === 0 && doctors.length === 0) {
            return res.status(404).json({ 
                success: false,
                message: 'Email not found in our records.' 
            });
        }

        const user = users[0] || doctors[0];
        const userType = users[0] ? 'user' : 'doctor';
        
        console.log('[Email Reset] Found:', userType, '-', user.email);

        // Generate token with user type
        const resetToken = jwt.sign(
            { 
                email: normalizedEmail, 
                id: user.id,
                userType: userType, // Important: track which table
                timestamp: Date.now() 
            },
            process.env.DB_JWT_SECRET || 'fallback-secret',
            { expiresIn: '15m' }
        );

        // Email transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.DB_USERMAIL,
                pass: process.env.DB_PASSKEY,
            },
        });

        const resetLink = `http://localhost:3001/reset-password?token=${resetToken}`;

        const mailOptions = {
            from: process.env.DB_USERMAIL,
            to: email,
            subject: 'Password Reset Request - UXAAH',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                                 color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                        .button { display: inline-block; padding: 15px 30px; background: #4CAF50; 
                                 color: white; text-decoration: none; border-radius: 5px; 
                                 font-weight: bold; margin: 20px 0; }
                        .warning { background: #fff3cd; border-left: 4px solid #ffc107; 
                                  padding: 15px; margin: 20px 0; }
                        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>🔐 Password Reset Request</h1>
                        </div>
                        <div class="content">
                            <p>Hello${user.name ? ' ' + user.name : ''},</p>
                            <p>We received a request to reset your password for your UXAAH ${userType === 'doctor' ? 'therapist' : 'client'} account.</p>
                            <p>Click the button below to set a new password:</p>
                            
                            <center>
                                <a href="${resetLink}" class="button">Reset My Password</a>
                            </center>
                            
                            <div class="warning">
                                <strong>⚠️ Important:</strong>
                                <ul>
                                    <li>This link expires in <strong>15 minutes</strong></li>
                                    <li>If you didn't request this, please ignore this email</li>
                                    <li>Your password won't change until you create a new one</li>
                                </ul>
                            </div>
                            
                            <p style="font-size: 12px; color: #666; margin-top: 30px;">
                                If the button doesn't work, copy and paste this link into your browser:<br>
                                <code style="background: #e0e0e0; padding: 5px 10px; border-radius: 3px; 
                                      display: inline-block; margin-top: 10px; word-break: break-all;">
                                    ${resetLink}
                                </code>
                            </p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} UXAAH. All rights reserved.</p>
                            <p>This is an automated email. Please do not reply.</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
        };

        await transporter.sendMail(mailOptions);

        console.log('[Email Reset] Email sent successfully to:', normalizedEmail);

        return res.status(200).json({ 
            success: true,
            message: 'Password reset link sent successfully. Please check your email.' 
        });

    } catch (error) {
        console.error('[Email Reset] Error:', error);
        return res.status(500).json({ 
            success: false,
            message: 'An error occurred while sending the reset email. Please try again later.',
            debug: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
