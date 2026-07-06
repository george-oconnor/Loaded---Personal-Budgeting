import { requireNativeModule } from 'expo-modules-core';

export type CKAccountStatus =
  | 'available'
  | 'noAccount'
  | 'restricted'
  | 'couldNotDetermine'
  | 'temporarilyUnavailable';

export type DatabaseScope = 'private' | 'public';

export type CKFieldType = 'string' | 'double' | 'int' | 'bool' | 'date' | 'null';

export interface FieldValue {
  type: CKFieldType;
  /** Ignored for type 'null', which clears the field on the server. */
  value?: string | number | boolean;
}

export interface RecordInput {
  recordType: string;
  recordName: string;
  fields: Record<string, FieldValue>;
}

export interface RecordOutput {
  recordName: string;
  recordType: string;
  fields: Record<string, FieldValue>;
  createdAt: string;
  modifiedAt: string;
  creatorUserRecordName: string | null;
}

/**
 * CloudKit supports only ==, >, >=, <, <=, IN, BEGINSWITH and AND compounds.
 * There is no !=, no OR, no "is not null" — filter those client-side.
 */
export type FilterOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'beginsWith';

export interface Filter {
  field: string;
  op: FilterOp;
  value: FieldValue | FieldValue[];
}

export interface Sort {
  field: string;
  ascending: boolean;
}

export type CKErrorCode =
  | 'NETWORK'
  | 'NOT_AUTHENTICATED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'ZONE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CK_ERROR';

export interface RecordFailure {
  recordName: string;
  code: CKErrorCode;
  message: string;
}

export interface SaveResult {
  saved: string[];
  failed: RecordFailure[];
}

export type SavePolicy = 'allKeys' | 'changedKeys';

interface CloudKitStorageType {
  getAccountStatus(): Promise<CKAccountStatus>;
  getUserRecordName(): Promise<string>;
  ensureZone(zoneName: string): Promise<void>;
  /** Deletes the zone and ALL records in it. Used for account deletion. */
  deleteZone(zoneName: string): Promise<void>;
  /** Chunks at CloudKit's 400-records-per-operation limit internally. */
  saveRecords(
    db: DatabaseScope,
    zoneName: string | null,
    records: RecordInput[],
    savePolicy: SavePolicy
  ): Promise<SaveResult>;
  deleteRecords(db: DatabaseScope, zoneName: string | null, recordNames: string[]): Promise<SaveResult>;
  fetchRecords(
    db: DatabaseScope,
    zoneName: string | null,
    recordNames: string[]
  ): Promise<{ found: RecordOutput[]; missing: string[] }>;
  queryRecords(
    db: DatabaseScope,
    zoneName: string | null,
    recordType: string,
    options: QueryOptions
  ): Promise<{ records: RecordOutput[]; cursor: string | null }>;
}

export interface QueryOptions {
  filters?: Filter[];
  sorts?: Sort[];
  limit?: number;
  cursor?: string | null;
  desiredKeys?: string[] | null;
}

let CloudKitStorage: CloudKitStorageType | null = null;
try {
  CloudKitStorage = requireNativeModule<CloudKitStorageType>('CloudKitStorage');
} catch (e) {
  console.warn(
    'CloudKitStorage native module not available. CloudKit storage requires a development build (not Expo Go).'
  );
}

/** Parses the retryAfter hint appended to RATE_LIMITED error messages: "(retryAfter=12)" */
export function getRetryAfterSeconds(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\(retryAfter=(\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

export default CloudKitStorage;
