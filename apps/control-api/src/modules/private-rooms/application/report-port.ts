import type { PeerReport, ReceiverReport } from '@screen-share/contracts';

export interface ReportCache {
  put(roomId: string, actor: string, report: ReceiverReport): boolean;
  list(roomId: string, sessionId: string, epoch: number): PeerReport[];
}
