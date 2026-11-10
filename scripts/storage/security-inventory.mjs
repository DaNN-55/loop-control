// Normalize ACL entries by identity rather than OID or array insertion order.
export function securityInventorySql(snapshot) {
  return `begin isolation level repeatable read read only; ${snapshot ? `set transaction snapshot '${snapshot}';` : ''}
with objects as (
 select 'function' kind,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) identity,p.proowner owner,p.proacl acl,'f'::\"char\" aclkind
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','loop_internal')
 union all
 select case when c.relkind='S' then 'sequence' else 'relation' end,format('%I.%I',n.nspname,c.relname),c.relowner,c.relacl,case when c.relkind='S' then 's' else 'r' end::\"char\"
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','loop_internal') and c.relkind in ('r','p','v','m','S','f')
 union all select 'schema',nspname,nspowner,nspacl,'n'::\"char\" from pg_namespace where nspname in ('public','loop_internal')
 union all select 'default',case when defaclnamespace='public'::regnamespace then format('%s:%s',pg_get_userbyid(defaclrole),defaclobjtype) else format('%s:%s:%s',(select nspname from pg_namespace where oid=defaclnamespace),pg_get_userbyid(defaclrole),defaclobjtype) end,defaclrole,defaclacl,defaclobjtype from pg_default_acl where defaclnamespace in (select oid from pg_namespace where nspname in ('public','loop_internal'))
), normalized as (
 select kind,identity,pg_get_userbyid(owner) owner,coalesce((select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by pg_get_userbyid(a.grantor),a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable) from aclexplode(coalesce(acl,acldefault(aclkind,owner))) a),'[]'::jsonb) grants from objects
)
select jsonb_build_object('count',count(*),'md5',md5(coalesce(jsonb_agg(to_jsonb(normalized) order by kind,identity),'[]'::jsonb)::text)) from normalized;commit;`;
}
