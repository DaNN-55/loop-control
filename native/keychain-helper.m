// Candidate for the isolated D deployment. Not integrated or accepted until
// Owner authorizes actual Keychain tests. No argument or environment secrets.
#import <Foundation/Foundation.h>
#import <sys/stat.h>
#import <sys/socket.h>
#import <unistd.h>
#import <limits.h>
#ifndef LOOP_KEYCHAIN_PATH
#define LOOP_KEYCHAIN_PATH ""
#endif
#ifndef LOOP_KEYCHAIN_PROTOCOL_ONLY
#import <Security/Security.h>
#endif

static int respond(BOOL ok, NSString *code, NSString *secret) {
    NSMutableDictionary *response = [@{@"ok": @(ok), @"code": code} mutableCopy];
    if (secret) response[@"secret"] = secret; // Worker pipe only; never HTTP/logs.
    NSData *output = [NSJSONSerialization dataWithJSONObject:response options:0 error:NULL];
    fwrite(output.bytes, 1, output.length, stdout);
    fputc('\n', stdout);
    return ok ? 0 : 1;
}

static NSDictionary *readRequest(void) {
    // Read a bounded pipe instead of readDataToEndOfFile's unbounded allocation.
    NSMutableData *input = [NSMutableData data];
    uint8_t buffer[4096]; size_t length;
    while ((length = fread(buffer, 1, sizeof(buffer), stdin)) > 0) {
        if (input.length + length > 65536) return nil;
        [input appendBytes:buffer length:length];
    }
    if (ferror(stdin)) return nil;
    id value = [NSJSONSerialization JSONObjectWithData:input options:0 error:NULL];
    if (![value isKindOfClass:[NSDictionary class]]) return nil;
    NSDictionary *request = value;
    NSString *operation = request[@"operation"], *reference = request[@"reference"];
    if (![operation isKindOfClass:[NSString class]] || ![@[@"put", @"get", @"remove"] containsObject:operation]) return nil;
    if (![reference isKindOfClass:[NSString class]]) return nil;
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:reference];
    if (!uuid || ![reference isEqualToString:uuid.UUIDString.lowercaseString]) return nil;
    NSSet *keys = [NSSet setWithArray:request.allKeys];
    NSSet *expected = [NSSet setWithArray:[operation isEqualToString:@"put"] ? @[@"operation", @"reference", @"secret"] : @[@"operation", @"reference"]];
    if (![keys isEqualToSet:expected]) return nil;
    if ([operation isEqualToString:@"put"]) {
        id secret = request[@"secret"];
        if (![secret isKindOfClass:[NSString class]]) return nil;
        NSUInteger size = [secret lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
        if (size == 0 || size > 16384) return nil;
    }
    return request;
}

static BOOL isControlledIPC(int fd) {
    struct stat info;
    if (fstat(fd, &info) != 0) return NO;
    if (S_ISFIFO(info.st_mode)) return YES;
    // libuv uses connected Unix socketpairs for Node stdio:'pipe'. Require
    // both ends to be local-domain streams; never accept a network socket.
    if (!S_ISSOCK(info.st_mode)) return NO;
    struct sockaddr_storage local, peer;
    socklen_t localSize = sizeof(local), peerSize = sizeof(peer), typeSize = sizeof(int);
    int type = 0;
    return getsockname(fd, (struct sockaddr *)&local, &localSize) == 0 &&
        getpeername(fd, (struct sockaddr *)&peer, &peerSize) == 0 &&
        getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &typeSize) == 0 &&
        local.ss_family == AF_UNIX && peer.ss_family == AF_UNIX && type == SOCK_STREAM;
}

#ifndef LOOP_KEYCHAIN_PROTOCOL_ONLY
static int performKeychainRequest(NSDictionary *request, const char *path) {
    // The file-based macOS keychain can otherwise display ACL UI even with a
    // query authentication hint. This process never allows optional UI.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    OSStatus interaction = SecKeychainSetUserInteractionAllowed(false);
    if (interaction != errSecSuccess) return respond(NO, @"unavailable", nil);
    SecKeychainRef keychain = NULL;
    OSStatus opened = SecKeychainOpen(path, &keychain);
    if (opened != errSecSuccess || !keychain) return respond(NO, @"unavailable", nil);
    id scopedKeychain = CFBridgingRelease(keychain);
    NSMutableDictionary *query = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: @"com.loop-control.stage-d.connections.v1",
        (__bridge id)kSecAttrAccount: request[@"reference"],
        (__bridge id)kSecAttrSynchronizable: @NO,
        (__bridge id)kSecUseAuthenticationUI: (__bridge id)kSecUseAuthenticationUIFail
    } mutableCopy];
#pragma clang diagnostic pop
    NSString *operation = request[@"operation"];
    OSStatus status; CFTypeRef result = NULL;
    if ([operation isEqualToString:@"put"]) {
        query[(__bridge id)kSecUseKeychain] = scopedKeychain;
        query[(__bridge id)kSecValueData] = [request[@"secret"] dataUsingEncoding:NSUTF8StringEncoding];
        // Immutable reference: duplicates fail; never silently update/rotate.
        status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    } else if ([operation isEqualToString:@"get"]) {
        query[(__bridge id)kSecMatchSearchList] = @[scopedKeychain];
        query[(__bridge id)kSecReturnData] = @YES;
        query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    } else {
        query[(__bridge id)kSecMatchSearchList] = @[scopedKeychain];
        status = SecItemDelete((__bridge CFDictionaryRef)query);
    }
    NSData *data = CFBridgingRelease(result);
    if (status == errSecItemNotFound) return respond(NO, @"missing", nil);
    if (status == errSecDuplicateItem) return respond(NO, @"already_exists", nil);
    if (status == errSecInteractionNotAllowed || status == errSecAuthFailed) return respond(NO, @"locked_or_denied", nil);
    if (status != errSecSuccess) return respond(NO, @"unavailable", nil);
    if ([operation isEqualToString:@"get"]) {
        if (![data isKindOfClass:[NSData class]] || data.length == 0 || data.length > 16384) return respond(NO, @"unavailable", nil);
        NSString *secret = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (!secret) return respond(NO, @"unavailable", nil);
        return respond(YES, @"resolved", secret);
    }
    return respond(YES, [operation isEqualToString:@"remove"] ? @"removed" : @"stored", nil);
}
#endif

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        BOOL validate = argc == 2 && strcmp(argv[1], "--validate-only") == 0;
#ifndef LOOP_KEYCHAIN_PROTOCOL_ONLY
        BOOL execute = argc == 3 && strcmp(argv[1], "--keychain") == 0;
        if (!validate && !execute) return respond(NO, @"disabled", nil);
        if (execute) {
            char canonical[PATH_MAX];
            if (strlen(LOOP_KEYCHAIN_PATH) == 0 || strcmp(argv[2], LOOP_KEYCHAIN_PATH) != 0 ||
                !realpath(argv[2], canonical) || strcmp(canonical, LOOP_KEYCHAIN_PATH) != 0) return respond(NO, @"keychain_scope_required", nil);
        }
#else
        if (!validate) return respond(NO, @"disabled", nil);
#endif
        if (!isControlledIPC(STDIN_FILENO) || !isControlledIPC(STDOUT_FILENO)) return respond(NO, @"pipe_required", nil);
        NSDictionary *request = readRequest();
        if (!request) return respond(NO, @"invalid_request", nil);
        if (validate) return respond(YES, @"validated", nil);
#ifndef LOOP_KEYCHAIN_PROTOCOL_ONLY
        return performKeychainRequest(request, argv[2]);
#else
        return respond(NO, @"disabled", nil);
#endif
    }
}
