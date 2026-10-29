import {
  STATUSES,
  type ApplicationFilters,
  type DashboardStatistics,
  type TaskGroups,
  type Analytics,
} from '../types/application';

export const initialFilters: ApplicationFilters = {
  search: '',
  status: '',
  workArrangement: '',
  employmentType: '',
  sortBy: 'updatedAt',
  sortDirection: 'desc',
};
export const emptyStats: DashboardStatistics = {
  total: 0,
  submittedThisWeek: 0,
  activeInterviews: 0,
  offers: 0,
  requiringFollowUp: 0,
  rejections: 0,
  statusBreakdown: Object.fromEntries(
    STATUSES.map((status) => [status, 0]),
  ) as DashboardStatistics['statusBreakdown'],
  responseRate: 0,
  interviewRate: 0,
  offerRate: 0,
  rejectionRate: 0,
  averageDaysToFirstResponse: null,
};
export const emptyTasks: TaskGroups = { overdue: [], dueToday: [], upcoming: [], completed: [] };
export const emptyAnalytics: Analytics = {
  bySource: [],
  byWorkArrangement: [],
  averageStageDays: {},
};
