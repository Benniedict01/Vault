import crypto from 'crypto';export function randomToken(){return crypto.randomBytes(32).toString('hex')}export function hashToken(t){return crypto.createHash('sha256').update(t).digest('hex')}
