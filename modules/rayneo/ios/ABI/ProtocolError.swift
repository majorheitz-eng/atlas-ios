import Foundation

/// Protocol-level errors shared across TLV parsing and authentication.
public enum ProtocolError: Error, Equatable {
    case invalidLength, invalidHex, missingAccount, truncatedTLV, duplicateTag
}
