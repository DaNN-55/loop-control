// Dedicated-keychain bootstrap only. No command-line/environment secrets.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <sys/stat.h>
#import <unistd.h>
#ifndef LOOP_BOOTSTRAP_ACCOUNT
#error LOOP_BOOTSTRAP_ACCOUNT must identify this local project
#endif
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
static int reply(BOOL ok, NSString *code, NSString *secret) {
    NSMutableDictionary *value=[@{@"ok":@(ok),@"code":code} mutableCopy];
    if(secret)value[@"secret"]=secret;
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    fwrite(data.bytes,1,data.length,stdout); fputc('\n',stdout); return ok?0:1;
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        (void)argv; struct stat a,b;
        if(argc!=1||fstat(0,&a)||fstat(1,&b)||!(S_ISFIFO(a.st_mode)||S_ISSOCK(a.st_mode))||!(S_ISFIFO(b.st_mode)||S_ISSOCK(b.st_mode)))return reply(NO,@"pipe_required",nil);
        NSMutableData *data=[NSMutableData data];uint8_t buffer[1024];size_t n;
        while((n=fread(buffer,1,sizeof(buffer),stdin))>0){if(data.length+n>8192)return reply(NO,@"invalid_request",nil);[data appendBytes:buffer length:n];}
        id parsed=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if(![parsed isKindOfClass:NSDictionary.class])return reply(NO,@"invalid_request",nil);
        NSDictionary *request=parsed;BOOL put=[request[@"operation"] isEqual:@"put"],get=[request[@"operation"] isEqual:@"get"];
        NSSet *expected=[NSSet setWithArray:put?@[@"operation",@"secret"]:@[@"operation"]];
        if((!put&&!get)||![[NSSet setWithArray:request.allKeys] isEqual:expected])return reply(NO,@"invalid_request",nil);
        if(put&&(![request[@"secret"] isKindOfClass:NSString.class]||[request[@"secret"] lengthOfBytesUsingEncoding:NSUTF8StringEncoding]<32||[request[@"secret"] lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>1024))return reply(NO,@"invalid_request",nil);
        if(SecKeychainSetUserInteractionAllowed(false)!=errSecSuccess)return reply(NO,@"unavailable",nil);
        NSString *path=[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Keychains/login.keychain-db"];
        SecKeychainRef raw=NULL;OSStatus status=SecKeychainOpen(path.fileSystemRepresentation,&raw);
        if(status!=errSecSuccess||!raw)return reply(NO,@"unavailable",nil);
        id login=CFBridgingRelease(raw);
        NSMutableDictionary *query=[@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"com.loop-control.local.bootstrap.v1",(__bridge id)kSecAttrAccount:@LOOP_BOOTSTRAP_ACCOUNT,(__bridge id)kSecAttrSynchronizable:@NO,(__bridge id)kSecUseAuthenticationUI:(__bridge id)kSecUseAuthenticationUIFail} mutableCopy];
        CFTypeRef result=NULL;
        if(put){query[(__bridge id)kSecUseKeychain]=login;query[(__bridge id)kSecValueData]=[request[@"secret"] dataUsingEncoding:NSUTF8StringEncoding];status=SecItemAdd((__bridge CFDictionaryRef)query,NULL);}
        else{query[(__bridge id)kSecMatchSearchList]=@[login];query[(__bridge id)kSecReturnData]=@YES;query[(__bridge id)kSecMatchLimit]=(__bridge id)kSecMatchLimitOne;status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);}
        NSData *value=CFBridgingRelease(result);
        if(status!=errSecSuccess)return reply(NO,status==errSecDuplicateItem?@"already_exists":status==errSecItemNotFound?@"missing":@"locked_or_denied",nil);
        NSString *secret=get?[[NSString alloc] initWithData:value encoding:NSUTF8StringEncoding]:nil;
        if(get&&(!secret||secret.length<32||secret.length>1024))return reply(NO,@"unavailable",nil);
        return reply(YES,get?@"resolved":@"stored",secret);
    }
}
