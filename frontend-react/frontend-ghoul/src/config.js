// Backend base URL. Override with REACT_APP_API_URL in .env for local development.
export const SERVER_URL = (process.env.REACT_APP_API_URL || 'https://ghoul-system.onrender.com').replace(/\/+$/, '');
