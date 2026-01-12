import jwt from 'jsonwebtoken';

export const verifyResetToken = async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ 
                valid: false,
                message: 'Token is required' 
            });
        }

        try {
            const decoded = jwt.verify(token, process.env.DB_JWT_SECRET || 'your-secret-key');
            
            if (decoded.type !== 'password_reset') {
                return res.status(400).json({ 
                    valid: false,
                    message: 'Invalid token type' 
                });
            }

            return res.status(200).json({ 
                valid: true,
                email: decoded.email,
                expiresAt: decoded.exp
            });
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(400).json({ 
                    valid: false,
                    message: 'Token has expired' 
                });
            }
            return res.status(400).json({ 
                valid: false,
                message: 'Invalid token' 
            });
        }
    } catch (error) {
        console.error('Error verifying token:', error);
        return res.status(500).json({ 
            valid: false,
            message: 'Internal server error' 
        });
    }
};