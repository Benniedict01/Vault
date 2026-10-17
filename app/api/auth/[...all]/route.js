// All authentication endpoints (sign-up, sign-in, sign-out, sessions, email
// verification, password reset) are served by Better Auth from here.
//
// Do not add hand-written files under app/api/auth/*; the catch-all owns every
// path in that segment. The specific routes it replaced were deleted with this
// change (see ENGINEERING.md section 9).
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
