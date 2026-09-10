import { Prisma } from "@prisma/client";

export type ProjectOpsMeetingListItem = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  eventType: string;
  projectId: string;
  projectName: string;
  isAllDay: boolean;
  timezone: string | null;
  source: string;
  linkedRefType: string | null;
  linkedRefId: string | null;
};

export type ProjectOpsDeadlineItem = {
  id: string;
  title: string;
  description: string | null;
  projectId: string;
  projectName: string;
  dueAt: string;
  status: string;
  linkedRefType: string | null;
  linkedRefId: string | null;
  completedAt: string | null;
  daysLeft: number | null;
};

export type ProjectOpsFinancialSummary = {
  projectId: string;
  currency: string;
  budgetAmount: number | null;
  spentAmount: number;
  remainingAmount: number | null;
  notes: string | null;
  updatedAt: string | null;
};

export type ProjectOpsSubscriptionItem = {
  id: string;
  name: string;
  category: string;
  cost: number;
  billingType: string;
  status: string;
  provider: string | null;
  externalRef: string | null;
  renewsAt: string | null;
};

export type ProjectOpsCalendarDay = {
  date: string;
  meetings: ProjectOpsMeetingListItem[];
  deadlines: ProjectOpsDeadlineItem[];
};

export function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) {
    return null;
  }
  return value instanceof Prisma.Decimal ? value.toNumber() : value;
}

export function calculateDaysLeft(dueAt: Date, now = new Date()) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((dueAt.getTime() - now.getTime()) / msPerDay);
}
