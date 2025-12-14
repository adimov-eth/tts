import { Context, NextFunction } from 'grammy';
import { isAuthorized, isAdmin } from '../redis/users';

// Middleware to check authorization
// Note: /start command should be registered BEFORE this middleware to handle invite codes
export function authMiddleware() {
  return async (ctx: Context, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (await isAuthorized(chatId)) {
      return next();
    }

    await ctx.reply('You need an invite code to use this bot. Send /start <code>');
  };
}

// Middleware to check admin status (use after authMiddleware)
export function adminOnly() {
  return async (ctx: Context, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (await isAdmin(chatId)) {
      return next();
    }

    await ctx.reply('This command is for admins only.');
  };
}
