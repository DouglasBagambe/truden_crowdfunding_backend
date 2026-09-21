export enum ProjectStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  FUNDING = 'FUNDING',
  FUNDED = 'FUNDED',
  FUNDING_FAILED = 'FUNDING_FAILED',
  CLOSED = 'CLOSED',
}

export const CONTRIBUTION_ELIGIBLE_PROJECT_STATUSES = [
  ProjectStatus.APPROVED,
] as const;

export function isContributionEligibleProjectStatus(
  status: unknown,
): status is (typeof CONTRIBUTION_ELIGIBLE_PROJECT_STATUSES)[number] {
  return CONTRIBUTION_ELIGIBLE_PROJECT_STATUSES.includes(
    status as (typeof CONTRIBUTION_ELIGIBLE_PROJECT_STATUSES)[number],
  );
}
