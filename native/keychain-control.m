// Lifecycle control for one compile-time scoped, privately owned application keychain.
// Passwords use bounded stdin; no ACL, default-keychain or search-list setters.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <sys/stat.h>
#import <unistd.h>
#import <limits.h>
#ifndef LOOP_KEYCHAIN_PATH
#error LOOP_KEYCHAIN_PATH must name the dedicated application keychain
#endif
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static int reply(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout);
    return [value[@"ok"] boolValue] ? 0 : 1;
}
static NSString *keychainPath(SecKeychainRef keychain) {
    char path[PATH_MAX]; UInt32 length = sizeof(path);
    if (SecKeychainGetPath(keychain, &length, path) != errSecSuccess) return nil;
    return [[NSString alloc] initWithBytes:path length:strlen(path) encoding:NSUTF8StringEncoding];
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        (void)argv;
        struct stat input, output;
        if (argc != 1 || fstat(0,&input) || fstat(1,&output) ||
            !(S_ISFIFO(input.st_mode)||S_ISSOCK(input.st_mode)) ||
            !(S_ISFIFO(output.st_mode)||S_ISSOCK(output.st_mode))) return reply(@{@"ok":@NO,@"code":@"pipe_required"});
        NSMutableData *data = [NSMutableData data]; uint8_t buffer[1024]; size_t count;
        while ((count=fread(buffer,1,sizeof(buffer),stdin))>0) {
            if (data.length+count>8192) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
            [data appendBytes:buffer length:count];
        }
        id parsed=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if (![parsed isKindOfClass:NSDictionary.class]) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
        NSDictionary *request=parsed; NSString *operation=request[@"operation"];
        if (![@[@"snapshot",@"create",@"status",@"lock",@"unlock",@"delete"] containsObject:operation]) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
        BOOL needsPassword=[@[@"create",@"unlock"] containsObject:operation];
        NSSet *expected=[NSSet setWithArray:needsPassword?@[@"operation",@"password"]:@[@"operation"]];
        if (![[NSSet setWithArray:request.allKeys] isEqualToSet:expected]) return reply(@{@"ok":@NO,@"code":@"invalid_request"});
        if (SecKeychainSetUserInteractionAllowed(false)!=errSecSuccess) return reply(@{@"ok":@NO,@"code":@"interaction_guard_failed"});
        if ([operation isEqualToString:@"snapshot"]) {
            CFArrayRef rawList=NULL; SecKeychainRef defaultKeychain=NULL;
            OSStatus status=SecKeychainCopySearchList(&rawList);
            if (status!=errSecSuccess) return reply(@{@"ok":@NO,@"status":@(status)});
            NSArray *list=CFBridgingRelease(rawList); NSMutableArray *paths=[NSMutableArray array];
            for (id item in list) { NSString *path=keychainPath((__bridge SecKeychainRef)item); if(!path)return reply(@{@"ok":@NO,@"code":@"path_failed"}); [paths addObject:path]; }
            status=SecKeychainCopyDefault(&defaultKeychain);
            NSString *defaultPath=defaultKeychain?keychainPath(defaultKeychain):@"";
            if(defaultKeychain)CFRelease(defaultKeychain);
            return reply(@{@"ok":@YES,@"paths":paths,@"defaultPath":defaultPath?:@"",@"defaultStatus":@(status)});
        }
        const char *path=LOOP_KEYCHAIN_PATH; char parent[PATH_MAX], canonical[PATH_MAX];
        strlcpy(parent,path,sizeof(parent)); char *slash=strrchr(parent,'/'); if(!slash)return reply(@{@"ok":@NO,@"code":@"scope_failed"}); *slash=0;
        struct stat parentInfo;
        if(!realpath(parent,canonical)||strcmp(parent,canonical)||lstat(parent,&parentInfo)||!S_ISDIR(parentInfo.st_mode)||parentInfo.st_uid!=getuid()||(parentInfo.st_mode&0077))return reply(@{@"ok":@NO,@"code":@"scope_failed"});
        struct stat info; BOOL exists=lstat(path,&info)==0;
        if(exists&&(!S_ISREG(info.st_mode)||info.st_uid!=getuid()||info.st_nlink!=1||!realpath(path,canonical)||strcmp(path,canonical)))return reply(@{@"ok":@NO,@"code":@"scope_failed"});
        if([operation isEqualToString:@"create"]&&exists)return reply(@{@"ok":@NO,@"code":@"already_exists"});
        NSData *password=nil;
        if(needsPassword){id value=request[@"password"];if(![value isKindOfClass:NSString.class]||(password=[value dataUsingEncoding:NSUTF8StringEncoding]).length<32||password.length>1024)return reply(@{@"ok":@NO,@"code":@"invalid_password"});}
        SecKeychainRef keychain=NULL; OSStatus status;
        if([operation isEqualToString:@"create"]){
            status=SecKeychainCreate(path,(UInt32)password.length,password.bytes,false,NULL,&keychain);
        }else{
            if(!exists)return reply(@{@"ok":@NO,@"code":@"missing"});
            status=SecKeychainOpen(path,&keychain);
            if(status==errSecSuccess&&keychain){
                if([operation isEqualToString:@"lock"])status=SecKeychainLock(keychain);
                if([operation isEqualToString:@"unlock"])status=SecKeychainUnlock(keychain,(UInt32)password.length,password.bytes,true);
                if([operation isEqualToString:@"delete"])status=SecKeychainDelete(keychain);
            }
        }
        SecKeychainStatus flags=0;
        if(status==errSecSuccess&&keychain&&![operation isEqualToString:@"delete"])status=SecKeychainGetStatus(keychain,&flags);
        if(keychain)CFRelease(keychain);
        return reply(@{@"ok":status==errSecSuccess?@YES:@NO,@"status":@(status),@"unlocked":(flags&kSecUnlockStateStatus)!=0?@YES:@NO});
    }
}
