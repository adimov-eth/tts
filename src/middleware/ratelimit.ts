import { Context, NextFunction } from 'grammy';
import { 
  checkRateLimit, 
  incrementUsage, 
  markNotified,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  RATE_LIMIT_CHARS_PER_DAY 
} from '../redis/ratelimit';

// Middleware to check rate limits
// Apply this to TTS-processing handlers, not simple commands like /help
export function rateLimitMiddleware() {
  return async (ctx: Context, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();
    
    // Estimate character count from message
    const text = ctx.message?.text || '';
    const charCount = text.length;
    
    const result = await checkRateLimit(chatId, charCount);
    
    if (!result.allowed) {
      if (result.reason === 'minute_limit') {
        await ctx.reply('Rate limit exceeded. Maximum ' + RATE_LIMIT_REQUESTS_PER_MINUTE + ' requests per minute. Please wait.');
        return;
      }
    }
    
    // Soft limit notification (still allow the request)
    if (result.shouldNotify) {
      await ctx.reply('Notice: You have used over ' + RATE_LIMIT_CHARS_PER_DAY.toLocaleString() + ' characters today. Usage continues but consider pacing yourself.');
      await markNotified(chatId);
    }
    
    // Increment usage after allowing
    await incrementUsage(chatId, charCount);
    
    return next();
  };
}
