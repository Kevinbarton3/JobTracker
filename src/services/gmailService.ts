import { invoke } from '@tauri-apps/api/core';
export type GmailAction =
  | 'status'
  | 'messages'
  | 'import'
  | 'connect'
  | 'cancel'
  | 'disconnect'
  | 'sync'
  | 'clear'
  | 'autostart'
  | 'link'
  | 'ignore'
  | 'apply'
  | 'dismiss';
export interface GmailStatus {
  configured: boolean;
  accounts: { address: string; lastSync: string | null; reconnect: boolean }[];
  busy: boolean;
  progress?: string | null;
  error: string | null;
  autostart: boolean;
}
export interface GmailMessage {
  id: number;
  account: string;
  sender: string;
  subject: string;
  receivedAt: string;
  preview: string;
  applicationId: number | null;
  disposition: 'review' | 'linked' | 'ignored';
  suggestedStatus: string | null;
  excerpt: string | null;
  suggestionState: string;
  gmailId: string;
}
export const gmail = <T>(
  action: GmailAction,
  args: { id?: number; applicationId?: number; enabled?: boolean } = {},
) => invoke<T>('gmail_action', { action, ...args });
