export const ROLES = ["owner", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];
