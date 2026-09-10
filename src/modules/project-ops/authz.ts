import { AppError } from "../../app/errors.js";
import type { ProjectRole } from "@prisma/client";

export function assertProjectOpsReadable(projectRole: ProjectRole) {
  if (projectRole === "client") {
    throw new AppError(403, "Client access is not available for project ops", "project_ops_access_forbidden");
  }
}

