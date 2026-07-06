import ExpoModulesCore
import CloudKit

/// Thin CRUD bridge over CKDatabase. All sync/offline semantics live in the
/// JS layer (lib/cloudkit.ts + the AsyncStorage queues); this module only
/// translates record operations, batching saves/deletes at CloudKit's
/// 400-records-per-operation limit.
public class CloudKitStorageModule: Module {
  private static let maxRecordsPerOperation = 400

  public func definition() -> ModuleDefinition {
    Name("CloudKitStorage")

    AsyncFunction("getAccountStatus") { (promise: Promise) in
      CKContainer.default().accountStatus { status, error in
        if let error = error {
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
          return
        }
        promise.resolve(Self.accountStatusString(status))
      }
    }

    AsyncFunction("getUserRecordName") { (promise: Promise) in
      CKContainer.default().fetchUserRecordID { recordID, error in
        if let error = error {
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
          return
        }
        guard let recordID = recordID else {
          promise.reject("NOT_AUTHENTICATED", "No iCloud user record available")
          return
        }
        promise.resolve(recordID.recordName)
      }
    }

    AsyncFunction("ensureZone") { (zoneName: String, promise: Promise) in
      Task {
        do {
          let zone = CKRecordZone(zoneID: Self.zoneID(zoneName))
          _ = try await CKContainer.default().privateCloudDatabase
            .modifyRecordZones(saving: [zone], deleting: [])
          promise.resolve(nil)
        } catch {
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
        }
      }
    }

    AsyncFunction("deleteZone") { (zoneName: String, promise: Promise) in
      Task {
        do {
          _ = try await CKContainer.default().privateCloudDatabase
            .modifyRecordZones(saving: [], deleting: [Self.zoneID(zoneName)])
          promise.resolve(nil)
        } catch {
          // Deleting a zone that never existed is success for our purposes
          if let ck = error as? CKError, ck.code == .zoneNotFound || ck.code == .userDeletedZone {
            promise.resolve(nil)
            return
          }
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
        }
      }
    }

    AsyncFunction("saveRecords") { (db: String, zoneName: String?, records: [[String: Any]], savePolicy: String, promise: Promise) in
      Task {
        do {
          let database = try Self.database(db)
          let policy: CKModifyRecordsOperation.RecordSavePolicy =
            savePolicy == "changedKeys" ? .changedKeys : .allKeys

          var ckRecords: [CKRecord] = []
          for input in records {
            guard let recordType = input["recordType"] as? String,
                  let recordName = input["recordName"] as? String,
                  let fields = input["fields"] as? [String: Any] else {
              throw CloudKitStorageError.invalidInput("Record must have recordType, recordName, fields")
            }
            let record = CKRecord(recordType: recordType, recordID: Self.recordID(recordName, zoneName))
            for (key, raw) in fields {
              // { type: 'null' } clears the field on the server
              if let dict = raw as? [String: Any], dict["type"] as? String == "null" {
                record[key] = nil
                continue
              }
              record[key] = try CKRecordCoder.decodeFieldValue(raw)
            }
            ckRecords.append(record)
          }

          var saved: [String] = []
          var failed: [[String: Any]] = []
          for chunk in Self.chunked(ckRecords, size: Self.maxRecordsPerOperation) {
            let (saveResults, _) = try await database.modifyRecords(
              saving: chunk, deleting: [], savePolicy: policy, atomically: false)
            for (recordID, result) in saveResults {
              switch result {
              case .success:
                saved.append(recordID.recordName)
              case .failure(let error):
                failed.append([
                  "recordName": recordID.recordName,
                  "code": CKErrorMapper.code(for: error),
                  "message": CKErrorMapper.message(for: error),
                ])
              }
            }
          }
          promise.resolve(["saved": saved, "failed": failed])
        } catch let error as CloudKitStorageError {
          promise.reject("INVALID_INPUT", error.message)
        } catch {
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
        }
      }
    }

    AsyncFunction("deleteRecords") { (db: String, zoneName: String?, recordNames: [String], promise: Promise) in
      Task {
        do {
          let database = try Self.database(db)
          let recordIDs = recordNames.map { Self.recordID($0, zoneName) }

          var deleted: [String] = []
          var failed: [[String: Any]] = []
          for chunk in Self.chunked(recordIDs, size: Self.maxRecordsPerOperation) {
            let (_, deleteResults) = try await database.modifyRecords(
              saving: [], deleting: chunk, savePolicy: .ifServerRecordUnchanged, atomically: false)
            for (recordID, result) in deleteResults {
              switch result {
              case .success:
                deleted.append(recordID.recordName)
              case .failure(let error):
                failed.append([
                  "recordName": recordID.recordName,
                  "code": CKErrorMapper.code(for: error),
                  "message": CKErrorMapper.message(for: error),
                ])
              }
            }
          }
          promise.resolve(["saved": deleted, "failed": failed])
        } catch {
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
        }
      }
    }

    AsyncFunction("fetchRecords") { (db: String, zoneName: String?, recordNames: [String], promise: Promise) in
      Task {
        do {
          let database = try Self.database(db)
          let recordIDs = recordNames.map { Self.recordID($0, zoneName) }
          let results = try await database.records(for: recordIDs)

          var found: [[String: Any]] = []
          var missing: [String] = []
          for (recordID, result) in results {
            switch result {
            case .success(let record):
              found.append(CKRecordCoder.encodeRecord(record))
            case .failure(let error):
              if let ck = error as? CKError, ck.code == .unknownItem {
                missing.append(recordID.recordName)
              } else {
                throw error
              }
            }
          }
          promise.resolve(["found": found, "missing": missing])
        } catch {
          // A missing zone means nothing has been written yet — report all as missing
          if let ck = error as? CKError, ck.code == .zoneNotFound || ck.code == .userDeletedZone {
            promise.resolve(["found": [], "missing": recordNames])
            return
          }
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
        }
      }
    }

    // Options bundle the query params (filters/sorts/limit/cursor/desiredKeys)
    // to stay within Expo's per-function argument limit.
    AsyncFunction("queryRecords") { (db: String, zoneName: String?, recordType: String, options: [String: Any], promise: Promise) in
      Task {
        do {
          let database = try Self.database(db)
          let filters = options["filters"] as? [[String: Any]] ?? []
          let sorts = options["sorts"] as? [[String: Any]] ?? []
          let limit = (options["limit"] as? NSNumber)?.intValue ?? 0
          let cursor = options["cursor"] as? String
          let desiredKeys = options["desiredKeys"] as? [String]
          let resultsLimit = limit > 0 ? limit : CKQueryOperation.maximumResults
          let keys = desiredKeys.map { $0.map { CKRecord.FieldKey($0) } }

          let matchResults: [(CKRecord.ID, Result<CKRecord, Error>)]
          let queryCursor: CKQueryOperation.Cursor?

          if let cursor = cursor {
            let decoded = try CKQueryBuilder.decodeCursor(cursor)
            (matchResults, queryCursor) = try await database.records(
              continuingMatchFrom: decoded, desiredKeys: keys, resultsLimit: resultsLimit)
          } else {
            let query = CKQuery(recordType: recordType, predicate: try CKQueryBuilder.predicate(from: filters))
            query.sortDescriptors = try CKQueryBuilder.sortDescriptors(from: sorts)
            let zoneID = zoneName.map { Self.zoneID($0) }
            (matchResults, queryCursor) = try await database.records(
              matching: query, inZoneWith: zoneID, desiredKeys: keys, resultsLimit: resultsLimit)
          }

          var records: [[String: Any]] = []
          for (_, result) in matchResults {
            if case .success(let record) = result {
              records.append(CKRecordCoder.encodeRecord(record))
            }
          }
          let encodedCursor = try queryCursor.map { try CKQueryBuilder.encodeCursor($0) }
          promise.resolve(["records": records, "cursor": encodedCursor as Any])
        } catch let error as CloudKitStorageError {
          promise.reject("INVALID_INPUT", error.message)
        } catch {
          // Querying a zone that doesn't exist yet = empty result set
          if let ck = error as? CKError, ck.code == .zoneNotFound || ck.code == .userDeletedZone {
            promise.resolve(["records": [], "cursor": NSNull()])
            return
          }
          promise.reject(CKErrorMapper.code(for: error), CKErrorMapper.message(for: error))
        }
      }
    }
  }

  // MARK: - Helpers

  private static func database(_ scope: String) throws -> CKDatabase {
    switch scope {
    case "private": return CKContainer.default().privateCloudDatabase
    case "public": return CKContainer.default().publicCloudDatabase
    default: throw CloudKitStorageError.invalidInput("Unknown database scope: \(scope)")
    }
  }

  private static func zoneID(_ zoneName: String) -> CKRecordZone.ID {
    return CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
  }

  private static func recordID(_ recordName: String, _ zoneName: String?) -> CKRecord.ID {
    if let zoneName = zoneName {
      return CKRecord.ID(recordName: recordName, zoneID: zoneID(zoneName))
    }
    return CKRecord.ID(recordName: recordName)
  }

  private static func accountStatusString(_ status: CKAccountStatus) -> String {
    switch status {
    case .available: return "available"
    case .noAccount: return "noAccount"
    case .restricted: return "restricted"
    case .temporarilyUnavailable: return "temporarilyUnavailable"
    default: return "couldNotDetermine"
    }
  }

  private static func chunked<T>(_ items: [T], size: Int) -> [[T]] {
    guard items.count > size else { return items.isEmpty ? [] : [items] }
    return stride(from: 0, to: items.count, by: size).map {
      Array(items[$0..<min($0 + size, items.count)])
    }
  }
}
