import { accountsDeps, type AccountsPagesContext } from '../../../server/accounts/deps'
import { handleGetPlan, handlePutPlan } from '../../../server/accounts/syncHandlers'

export const onRequestGet = (ctx: AccountsPagesContext): Promise<Response> => handleGetPlan(ctx.request, accountsDeps(ctx.env))
export const onRequestPut = (ctx: AccountsPagesContext): Promise<Response> => handlePutPlan(ctx.request, accountsDeps(ctx.env))
