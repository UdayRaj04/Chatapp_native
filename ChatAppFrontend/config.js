// Global config - Switch between local dev and production based on build type
const API_BASE = __DEV__
  ? 'http://192.168.29.93:5000/api'  // Local backend (dev builds only)
  : 'https://seamless-api-kpk0.onrender.com/api';  // Deployed on Render.com (preview/production)

// Socket base URL (derived from API_BASE - strips /api)
const SOCKET_BASE = API_BASE.replace('/api', '');

// Export for use in screens/components
export { API_BASE, SOCKET_BASE };