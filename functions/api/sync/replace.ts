import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleReplacePlan } from '../../../server/accounts/syncHandlers'

export const onRequestPut = (ctx: AccountsPagesContext): Promise<Response> => handleReplacePlan(ctx.request, accountsDeps(ctx.env))
