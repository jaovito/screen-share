import type { ProductMediaGrant, RoomSnapshot, RoomSummary } from '@screen-share/contracts';

export type RoomRecord = {
  id: string;
  name: string;
  ownerId: string;
  epoch: number;
  membershipRevision: number;
  state: RoomSummary['state'];
  createdAt: string;
};
export type Member = RoomSnapshot['members'][number];
export type SessionRecord = NonNullable<RoomSnapshot['session']> & { rtcRoom: string };
export type Invite = {
  id: string;
  roomId: string;
  tokenHash: string;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revoked: boolean;
};
export interface RoomTransaction {
  room: RoomRecord;
  members: Member[];
  session: SessionRecord | null;
  updateRoom(
    update: Partial<Pick<RoomRecord, 'epoch' | 'membershipRevision' | 'state'>>,
  ): Promise<void>;
  addMember(userId: string): Promise<void>;
  approveMember(userId: string): Promise<void>;
  removeMember(userId: string): Promise<void>;
  inviteByHash(hash: string): Promise<Invite | null>;
  insertInvite(invite: Invite): Promise<void>;
  useInvite(id: string): Promise<void>;
  revokeInvite(id: string): Promise<boolean>;
  listInvites(): Promise<Array<Omit<Invite, 'roomId' | 'tokenHash'>>>;
  setSession(session: SessionRecord): Promise<void>;
  updateSession(state: SessionRecord['state']): Promise<void>;
  enqueueCleanup(session: SessionRecord): Promise<void>;
  cleanupPending(): Promise<boolean>;
  audit(actorId: string, action: string): Promise<void>;
}
export interface RoomStore {
  create(id: string, name: string, ownerId: string): Promise<void>;
  list(actorId: string): Promise<RoomSummary[]>;
  inviteRoom(hash: string): Promise<string | null>;
  locked<T>(roomId: string, work: (tx: RoomTransaction) => Promise<T>): Promise<T>;
  consumeLimit(
    key: string,
    windowSeconds: number,
    maximum: number,
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
  processCleanup(remove: (rtcRoom: string) => Promise<void>): Promise<number>;
}
export interface RtcControl {
  remove(rtcRoom: string): Promise<void>;
  token(input: {
    rtcRoom: string;
    participantId: string;
    role: ProductMediaGrant['role'];
    expiresAt: number;
    includeAudio?: boolean;
  }): Promise<string>;
}
export type ProductDependencies = {
  store: RoomStore;
  rtc: RtcControl;
  now: () => number;
  id: () => string;
  secret: () => string;
  hash: (secret: string) => string;
  serverUrl: string;
};
