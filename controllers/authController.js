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
  DocLogin,
  checkLoginStatus
};