import { createCookieSessionStorage } from 'react-router';
import { createThemeSessionResolver } from 'remix-themes';

// You can default to 'development' if import.meta.env.MODE is not set
const isProduction = import.meta.env.MODE === 'production';

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: 'theme',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secrets: ['s3cr3t'], // In a real app, use environment variable
    // Set domain and secure only if in production
    ...(isProduction
      ? { domain: 'your-production-domain.com', secure: true }
      : {}),
  },
});

export const themeSessionResolver = createThemeSessionResolver(sessionStorage);
