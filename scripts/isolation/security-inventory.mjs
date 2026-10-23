// Normalize ACL entries by identity rather than OID or array insertion order.
export function securityInventorySql(snapshot) {
  return `begin isolation level repeatable read read only; ${snapshot ? `set transaction snapshot '${snapshot}';` : ''}
with objects as (
 select 'function' kind,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) identity,p.proowner owner,p.proacl acl,'f'::\"char\" aclkind
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 union all
 select case when c.relkind='S' then 'sequence' else 'relation' end,format('%I.%I',n.nspname,c.relname),c.relowner,c.relacl,case when c.relkind='S' then 's' else 'r' end::\"char\"
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')
 union all select 'schema',nspname,nspowner,nspacl,'n'::\"char\" from pg_namespace where nspname='public'
 union all select 'default',format('%s:%s',pg_get_userbyid(defaclrole),defaclobjtype),defaclrole,defaclacl,defaclobjtype from pg_default_acl where defaclnamespace='public'::regnamespace
), normalized as (
 select kind,identity,pg_get_userbyid(owner) owner,coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by pg_get_userbyid(a.grantor),a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable) from aclexplode(coalesce(acl,acldefault(aclkind,owner))) a),'[]'::jsonb) grants from objects
)
select jsonb_build_object('count',count(*),'md5',md5(coalesce(jsonb_agg(to_jsonb(normalized) order by kind,identity),'[]'::jsonb)::text)) from normalized;commit;`;
}
// Clear only per-schema defaults on the brand-new target. pg_restore's DEFAULT ACL
// entries recreate source defaults after objects/explicit ACLs have been restored.
export const clearRestoreDefaultsSql=`do $$ declare d record; begin
for d in select distinct pg_get_userbyid(defaclrole) owner,defaclobjtype kind,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end grantee
 from pg_default_acl cross join lateral aclexplode(defaclacl) a where defaclnamespace='public'::regnamespace
loop
 execute format('alter default privileges for role %I in schema public revoke all on %s from %s',d.owner,case d.kind when 'f' then 'functions' when 'r' then 'tables' when 'S' then 'sequences' when 'T' then 'types' else 'schemas' end,d.grantee);
end loop;end $$;`;
