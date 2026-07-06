import CloudKit

enum CloudKitStorageError: Error {
  case invalidInput(String)

  var message: String {
    switch self {
    case .invalidInput(let m): return m
    }
  }
}

/// Maps CKError codes to the stable string codes the JS layer switches on.
enum CKErrorMapper {
  static func code(for error: Error) -> String {
    guard let ck = error as? CKError else { return "CK_ERROR" }
    switch ck.code {
    case .networkUnavailable, .networkFailure, .serviceUnavailable:
      return "NETWORK"
    case .notAuthenticated:
      return "NOT_AUTHENTICATED"
    case .quotaExceeded:
      return "QUOTA_EXCEEDED"
    case .requestRateLimited, .zoneBusy:
      return "RATE_LIMITED"
    case .serverRecordChanged:
      return "CONFLICT"
    case .unknownItem:
      return "NOT_FOUND"
    case .zoneNotFound, .userDeletedZone:
      return "ZONE_NOT_FOUND"
    default:
      return "CK_ERROR"
    }
  }

  /// Message with retryAfter appended so the JS layer can parse it: "... (retryAfter=12)"
  static func message(for error: Error) -> String {
    var msg = error.localizedDescription
    if let ck = error as? CKError, let retryAfter = ck.retryAfterSeconds {
      msg += " (retryAfter=\(Int(retryAfter.rounded())))"
    }
    return msg
  }
}

/// JSON dict <-> CKRecord field coding.
/// JS sends tagged fields: { type: 'string'|'double'|'int'|'bool'|'date', value }.
/// Bools are stored as Int64 0/1 (CloudKit has no Bool); the JS layer decodes them
/// back to booleans using its record schemas.
enum CKRecordCoder {
  private static let isoWithFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  private static let isoPlain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()

  static func parseDate(_ s: String) -> Date? {
    return isoWithFraction.date(from: s) ?? isoPlain.date(from: s)
  }

  static func formatDate(_ d: Date) -> String {
    return isoWithFraction.string(from: d)
  }

  /// Decode one tagged { type, value } dict into a CKRecord-storable value.
  static func decodeFieldValue(_ raw: Any?) throws -> __CKRecordObjCValue {
    guard let dict = raw as? [String: Any],
          let type = dict["type"] as? String else {
      throw CloudKitStorageError.invalidInput("Field value must be a { type, value } object")
    }
    let value = dict["value"]
    switch type {
    case "string":
      guard let s = value as? String else { throw CloudKitStorageError.invalidInput("Expected string value") }
      return s as NSString
    case "double":
      guard let n = value as? NSNumber else { throw CloudKitStorageError.invalidInput("Expected number value") }
      return NSNumber(value: n.doubleValue)
    case "int":
      guard let n = value as? NSNumber else { throw CloudKitStorageError.invalidInput("Expected number value") }
      return NSNumber(value: n.int64Value)
    case "bool":
      let truthy: Bool
      if let b = value as? Bool { truthy = b } else if let n = value as? NSNumber { truthy = n.boolValue } else {
        throw CloudKitStorageError.invalidInput("Expected boolean value")
      }
      return NSNumber(value: Int64(truthy ? 1 : 0))
    case "date":
      guard let s = value as? String, let d = parseDate(s) else {
        throw CloudKitStorageError.invalidInput("Expected ISO-8601 date string")
      }
      return d as NSDate
    default:
      throw CloudKitStorageError.invalidInput("Unsupported field type: \(type)")
    }
  }

  /// Encode a CKRecord field value back into a tagged dict for JS.
  /// Int-backed bools come back as { type: 'int' }; the JS schema layer coerces.
  static func encodeFieldValue(_ value: __CKRecordObjCValue) -> [String: Any]? {
    if let s = value as? String {
      return ["type": "string", "value": s]
    }
    if let d = value as? Date {
      return ["type": "date", "value": formatDate(d)]
    }
    if let n = value as? NSNumber {
      if CFNumberIsFloatType(n) {
        return ["type": "double", "value": n.doubleValue]
      }
      return ["type": "int", "value": n.int64Value]
    }
    return nil // unsupported CK types (assets, references, lists) are not used by this app
  }

  static func encodeRecord(_ record: CKRecord) -> [String: Any] {
    var fields: [String: Any] = [:]
    for key in record.allKeys() {
      if let value = record[key], let encoded = encodeFieldValue(value) {
        fields[key] = encoded
      }
    }
    return [
      "recordName": record.recordID.recordName,
      "recordType": record.recordType,
      "fields": fields,
      "createdAt": record.creationDate.map(formatDate) ?? "",
      "modifiedAt": record.modificationDate.map(formatDate) ?? "",
      "creatorUserRecordName": record.creatorUserRecordID?.recordName as Any,
    ]
  }
}

/// Builds NSPredicates from the JS filter DSL.
/// CloudKit supports only a subset of NSPredicate: ==, >, >=, <, <=, IN,
/// BEGINSWITH, and AND compounds. No OR, no !=, no "!= nil".
enum CKQueryBuilder {
  static func predicate(from filters: [[String: Any]]) throws -> NSPredicate {
    if filters.isEmpty { return NSPredicate(value: true) }

    var predicates: [NSPredicate] = []
    for filter in filters {
      guard let field = filter["field"] as? String,
            let op = filter["op"] as? String else {
        throw CloudKitStorageError.invalidInput("Filter must have field and op")
      }

      if op == "in" {
        guard let rawValues = filter["value"] as? [Any] else {
          throw CloudKitStorageError.invalidInput("'in' filter requires an array value")
        }
        let values = try rawValues.map { try CKRecordCoder.decodeFieldValue($0) }
        predicates.append(NSPredicate(format: "%K IN %@", field, values))
        continue
      }

      let value = try CKRecordCoder.decodeFieldValue(filter["value"])
      let format: String
      switch op {
      case "eq": format = "%K == %@"
      case "gt": format = "%K > %@"
      case "gte": format = "%K >= %@"
      case "lt": format = "%K < %@"
      case "lte": format = "%K <= %@"
      case "beginsWith": format = "%K BEGINSWITH %@"
      default:
        throw CloudKitStorageError.invalidInput("Unsupported filter op: \(op) (CloudKit has no !=/OR support)")
      }
      predicates.append(NSPredicate(format: format, field, value))
    }

    return predicates.count == 1
      ? predicates[0]
      : NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
  }

  static func sortDescriptors(from sorts: [[String: Any]]) throws -> [NSSortDescriptor] {
    return try sorts.map { sort in
      guard let field = sort["field"] as? String,
            let ascending = sort["ascending"] as? Bool else {
        throw CloudKitStorageError.invalidInput("Sort must have field and ascending")
      }
      return NSSortDescriptor(key: field, ascending: ascending)
    }
  }

  static func encodeCursor(_ cursor: CKQueryOperation.Cursor) throws -> String {
    let data = try NSKeyedArchiver.archivedData(withRootObject: cursor, requiringSecureCoding: true)
    return data.base64EncodedString()
  }

  static func decodeCursor(_ encoded: String) throws -> CKQueryOperation.Cursor {
    guard let data = Data(base64Encoded: encoded),
          let cursor = try NSKeyedUnarchiver.unarchivedObject(ofClass: CKQueryOperation.Cursor.self, from: data) else {
      throw CloudKitStorageError.invalidInput("Invalid or expired query cursor")
    }
    return cursor
  }
}
