// One-time, read-only project Keychain migration; secret I/O stays in pipes.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <sys/stat.h>
#import <unistd.h>
#ifndef LOOP_HISTORY_ROOT
#error LOOP_HISTORY_ROOT must identify the project runtime directory
#endif
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static int reply(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout);
    return [value[@"ok"] boolValue] ? 0 : 1;
}
int main(int argc, const char *argv[]) { @autoreleasepool {
    (void)argv;
    struct stat input, output;
    if (argc != 1 || fstat(0,&input) || fstat(1,&output) ||
        !(S_ISFIFO(input.st_mode)||S_ISSOCK(input.st_mode)) ||
        !(S_ISFIFO(output.st_mode)||S_ISSOCK(output.st_mode)))
        return reply(@{@"ok":@NO,@"code":@"pipe_required"});
    NSMutableData *data=[NSMutableData data]; uint8_t buffer[4096]; size_t n;
    while ((n=fread(buffer,1,sizeof(buffer),stdin))) {
        if (data.length+n>65536) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
        [data appendBytes:buffer length:n];
    }
    id request=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if (![request isKindOfClass:NSDictionary.class]) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
    NSString *path=request[@"path"], *selected=request[@"account"]; char canonical[PATH_MAX]; struct stat info;
    if (![path isKindOfClass:NSString.class] || ![path hasPrefix:@LOOP_HISTORY_ROOT] ||
        ![path hasSuffix:@".keychain-db"] || !realpath(path.fileSystemRepresentation,canonical) ||
        strcmp(path.fileSystemRepresentation,canonical) || lstat(canonical,&info) ||
        !S_ISREG(info.st_mode) || info.st_uid!=getuid()) return reply(@{@"ok":@NO,@"code":@"scope_failed"});
    if (selected && (![selected isKindOfClass:NSString.class] || ![[NSUUID alloc]initWithUUIDString:selected]))
        return reply(@{@"ok":@NO,@"code":@"invalid_request"});
    NSArray *passwords=request[@"passwords"];
    if (![passwords isKindOfClass:NSArray.class] || passwords.count>128) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
    SecKeychainSetUserInteractionAllowed([request[@"allowInteraction"] isEqual:@YES]);
    SecKeychainRef keychain=NULL; OSStatus status=SecKeychainOpen(canonical,&keychain);
    if (status!=errSecSuccess || !keychain) return reply(@{@"ok":@NO,@"status":@(status)});
    SecKeychainStatus flags=0; status=SecKeychainGetStatus(keychain,&flags);
    if (status!=errSecSuccess) { CFRelease(keychain); return reply(@{@"ok":@NO,@"status":@(status)}); }
    if (!(flags&kSecUnlockStateStatus)) {
        status=errSecAuthFailed;
        for (id password in passwords) {
            if (![password isKindOfClass:NSString.class]) continue;
            NSData *bytes=[password dataUsingEncoding:NSUTF8StringEncoding]; if (bytes.length>1024) continue;
            status=SecKeychainUnlock(keychain,(UInt32)bytes.length,bytes.bytes,true);
            if (status==errSecSuccess) break;
        }
        if (status!=errSecSuccess) { CFRelease(keychain); return reply(@{@"ok":@NO,@"code":@"unlock_required",@"status":@(status)}); }
    }
    SecKeychainSearchRef search=NULL;
    status=SecKeychainSearchCreateFromAttributes(keychain,kSecGenericPasswordItemClass,NULL,&search);
    if (status!=errSecSuccess) { CFRelease(keychain); return reply(@{@"ok":@NO,@"status":@(status),@"code":@"search_failed"}); }
    NSMutableArray *items=[NSMutableArray array]; SecKeychainItemRef item=NULL;
    while ((status=SecKeychainSearchCopyNext(search,&item))==errSecSuccess) {
        UInt32 tags[]={kSecServiceItemAttr,kSecAccountItemAttr};
        UInt32 formats[]={CSSM_DB_ATTRIBUTE_FORMAT_STRING,CSSM_DB_ATTRIBUTE_FORMAT_STRING};
        SecKeychainAttributeInfo attributeInfo={2,tags,formats}; SecKeychainAttributeList *attrs=NULL;
        OSStatus read=SecKeychainItemCopyAttributesAndData(item,&attributeInfo,NULL,&attrs,NULL,NULL);
        if (read!=errSecSuccess) { CFRelease(item); CFRelease(search); CFRelease(keychain); return reply(@{@"ok":@NO,@"status":@(read),@"code":@"attributes_failed"}); }
        NSString *service=@"", *account=@"";
        for (UInt32 i=0;attrs&&i<attrs->count;i++) {
            SecKeychainAttribute attr=attrs->attr[i];
            NSString *value=[[NSString alloc]initWithBytes:attr.data length:attr.length encoding:NSUTF8StringEncoding]?:@"";
            if (attr.tag==kSecServiceItemAttr) service=value;
            if (attr.tag==kSecAccountItemAttr) account=value;
        }
        SecKeychainItemFreeAttributesAndData(attrs,NULL);
        if (selected && ![account isEqualToString:selected]) { CFRelease(item); continue; }
        UInt32 length=0; void *bytes=NULL;
        if (![request[@"metadataOnly"] isEqual:@YES]) {
            read=SecKeychainItemCopyAttributesAndData(item,NULL,NULL,NULL,&length,&bytes);
            if (read!=errSecSuccess) { CFRelease(item); CFRelease(search); CFRelease(keychain); return reply(@{@"ok":@NO,@"status":@(read),@"code":@"item_access_required"}); }
        }
        NSData *secretBytes=[NSData dataWithBytes:bytes length:length];
        NSString *secret=[[NSString alloc]initWithData:secretBytes encoding:NSUTF8StringEncoding];
        [items addObject:@{@"service":service,@"account":account,@"secret":secret?:[secretBytes base64EncodedStringWithOptions:0],@"encoding":secret?@"utf8":@"base64"}];
        SecKeychainItemFreeAttributesAndData(NULL,bytes); CFRelease(item);
    }
    CFRelease(search); CFRelease(keychain);
    if (status!=errSecItemNotFound) return reply(@{@"ok":@NO,@"code":@"enumeration_failed",@"status":@(status)});
    return reply(@{@"ok":@YES,@"items":items});
}}
