import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables

// users database
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});



// Testing the database connection
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Users database connection successful!');
    connection.release();
  } catch (error) {
    console.error('Users database connection error:', error);
  }

})();

export { pool};
