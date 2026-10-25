export type OpenClawStateLeaseIdentity = { scope: string; key: string; owner: string };
export type OpenClawStateLeaseLossReason =
  | { kind: "expired"; expiredAgoMs: number; lastHeartbeatAgoMs: number }
  | { kind: "replaced" }
  | { kind: "missing" };
export type OpenClawStateLeaseAcquisition =
  | { kind: "acquired"; expiresAt: number }
  | { kind: "held"; holder: { owner: string; epoch: number; expiresAt: number | null } };
