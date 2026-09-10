import { createPrismaClient } from "../src/db/prisma.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { toSlug } from "../src/lib/utils/slug.js";

const prisma = createPrismaClient();

async function upsertUser(input: {
  orgId: string;
  email: string;
  displayName: string;
  workspaceRoleDefault: "manager" | "dev" | "client";
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: {
      normalizedEmail: input.email.trim().toLowerCase()
    },
    update: {
      displayName: input.displayName,
      workspaceRoleDefault: input.workspaceRoleDefault,
      isActive: true
    },
    create: {
      orgId: input.orgId,
      email: input.email.trim().toLowerCase(),
      normalizedEmail: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      globalRole: input.workspaceRoleDefault === "manager" ? "owner" : "member",
      workspaceRoleDefault: input.workspaceRoleDefault
    }
  });
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: toSlug("Orchestra Demo") },
    update: {
      name: "Orchestra Demo"
    },
    create: {
      name: "Orchestra Demo",
      slug: toSlug("Orchestra Demo")
    }
  });

  const passwordHash = await hashPassword("Password123!", 12);

  const [manager, dev, client] = await Promise.all([
    upsertUser({
      orgId: organization.id,
      email: "manager@orchestra.local",
      passwordHash,
      displayName: "Demo Manager",
      workspaceRoleDefault: "manager"
    }),
    upsertUser({
      orgId: organization.id,
      email: "dev@orchestra.local",
      passwordHash,
      displayName: "Demo Developer",
      workspaceRoleDefault: "dev"
    }),
    upsertUser({
      orgId: organization.id,
      email: "client@orchestra.local",
      passwordHash,
      displayName: "Demo Client",
      workspaceRoleDefault: "client"
    })
  ]);

  const project = await prisma.project.upsert({
    where: {
      orgId_slug: {
        orgId: organization.id,
        slug: toSlug("Sample Product")
      }
    },
    update: {
      status: "active"
    },
    create: {
      orgId: organization.id,
      name: "Sample Product",
      slug: toSlug("Sample Product"),
      status: "active",
      createdBy: manager.id
    }
  });

  await Promise.all([
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: manager.id } },
      update: { projectRole: "manager", isActive: true },
      create: { projectId: project.id, userId: manager.id, projectRole: "manager" }
    }),
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: dev.id } },
      update: { projectRole: "dev", isActive: true, roleInProject: "Developer" },
      create: {
        projectId: project.id,
        userId: dev.id,
        projectRole: "dev",
        roleInProject: "Developer",
        allocationPercent: 50,
        weeklyCapacityHours: 20
      }
    }),
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: client.id } },
      update: { projectRole: "client", isActive: true, roleInProject: "Client reviewer" },
      create: {
        projectId: project.id,
        userId: client.id,
        projectRole: "client",
        roleInProject: "Client reviewer"
      }
    })
  ]);

  console.log(
    JSON.stringify(
      {
        organization: organization.slug,
        users: [manager.email, dev.email, client.email],
        project: project.slug
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
