import { pool } from '../databaseconfig.js';

export const getDoctors = async (req, res) => {
  let connection;
  try {
    // Get a connection from the pool
    connection = await pool.getConnection();
    
    // Add console logs to debug
    console.log('Executing database query...');
    
    // Execute the query
    const [doctors] = await connection.query('SELECT * FROM docinfo');
    res.setHeader('Content-Type', 'application/json');

    // Log the raw result
    console.log('Raw database result:', doctors);
    
    // Make sure we have an array
    if (!doctors) {
      console.log('No results from database');
      return res.status(200).json([]);
    }
    
    // Log what we're sending back
    console.log('Sending to frontend:', doctors);
    
    // Send the response
    return res.status(200).json(doctors);
    
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ 
      message: 'Failed to fetch doctors',
      error: error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};