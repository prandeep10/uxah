// generateToken.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create a sample user payload (replace with actual user data as needed)
const user = {
  id: 4,
  role: 'doctor'
};

// Generate a JWT using your actual DB_JWT_SECRET
const token = jwt.sign(
  user,
  process.env.DB_JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('Generated JWT token:');
console.log(token);