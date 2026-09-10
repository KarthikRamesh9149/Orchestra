import type { JwtUser } from "../lib/auth/jwt.js";
import type { ActiveProjectAuthorization } from "../lib/auth/authorization.js";
import type { AppContext } from "../types/index.js";
import type { AuthenticatedProfile } from "../modules/auth/service.js";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    requestStartedAt?: bigint;
    rawBody?: string;
    authUser?: JwtUser;
    authProfile?: AuthenticatedProfile;
    projectAuthorization?: ActiveProjectAuthorization;
    appContext: AppContext;
  }
}
