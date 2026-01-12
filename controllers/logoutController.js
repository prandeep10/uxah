export const logout = async (req, res) => {
  try {
    res.clearCookie('connect.sid');
    res.status(200).json({ message: 'Logged out successfully' });
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
    });
  } catch (error) {
    console.error('Error in logout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};