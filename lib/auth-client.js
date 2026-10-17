'use client';

// Browser-side auth client. Same origin, so no base URL is needed: the server
// exposes Better Auth at /api/auth/*.
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
