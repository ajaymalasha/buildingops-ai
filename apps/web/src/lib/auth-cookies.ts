/**
 * Auth.js names its session cookie differently over HTTPS. The proxy, the Auth.js config
 * and the token reader all have to agree, so the decision is made once, here.
 */
export const USE_SECURE_COOKIES = (process.env.AUTH_URL ?? "").startsWith("https://");

export const SESSION_COOKIE = `${USE_SECURE_COOKIES ? "__Secure-" : ""}authjs.session-token`;
