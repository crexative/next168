import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleStart } from '../../../server/accounts/authHandlers'

export const onRequestPost = (ctx: AccountsPagesContext): Promise<Response> => handleStart(ctx.request, accountsDeps(ctx.env))
