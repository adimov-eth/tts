import { Context, NextFunction } from 'grammy';
import { isAuthorized, isAdmin, createUser } from '../redis/users';
import { redeemInvite, getInvite } from '../redis/invites';

// Middleware to check authorization
export function authMiddleware() {
  return async (ctx: Context, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Check if authorized
    if (await isAuthorized(chatId)) {
      return next();
    }

    // Not authorized - check if this is /start with invite code
    const text = ctx.message?.text;
    if (text?.startsWith('/start ')) {
      const code = text.slice(7).trim();
      if (code) {
        const invite = await getInvite(code);
        if (invite && await redeemInvite(code, chatId)) {
          await createUser(chatId, invite.role, invite.createdBy);
          await ctx.reply(`Welcome! You've been registered as ${invite.role}.`);
          return next();
        }
      }
    }

    // Unauthorized
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
