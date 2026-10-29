// @vitest-environment node
import {expect,it} from 'vitest';
import {join} from 'node:path';
it.skipIf(process.env.LOOP_NOTIFICATION_STATUS_ACCEPTANCE!=='1')('real PG excludes imported unknown deliveries while retaining live unknown and reservation fences',async()=>{
 const {runtimeContext}=await import(join(process.cwd(),'scripts/runtime/environment.mjs')),c=runtimeContext();
 const expected=c.sql("SELECT count(*) FROM public.notification_delivery_events d WHERE outcome IN('reserved','uncertain') AND NOT EXISTS(SELECT 1 FROM local_identity.historical_audit_events h WHERE h.event_id=d.event_id)");
 const actual=c.sql('SET SESSION AUTHORIZATION loop_app;SELECT local_identity.unresolved_native_notifications();RESET SESSION AUTHORIZATION;');
 expect(actual).toBe(expected);
 const reserved=c.sql("SELECT d.event_id FROM public.notification_delivery_events d JOIN local_identity.historical_audit_events h USING(event_id) WHERE outcome IN('reserved','uncertain') ORDER BY event_id LIMIT 1");
 expect(reserved).toMatch(/^[0-9a-f-]{36}$/);
 // The marker changes are visible only inside this rolled-back transaction.
 const probe=c.sql(`BEGIN;DELETE FROM local_identity.historical_audit_events WHERE event_id='${reserved}';SET SESSION AUTHORIZATION loop_app;SELECT local_identity.unresolved_native_notifications();RESET SESSION AUTHORIZATION;INSERT INTO local_identity.historical_audit_events VALUES('${reserved}');SET SESSION AUTHORIZATION loop_app;SELECT local_identity.unresolved_native_notifications();RESET SESSION AUTHORIZATION;ROLLBACK;`);
 expect(probe).toBe(`${Number(expected)+1}\n${expected}`);
 const pending=c.sql("SELECT d.event_id FROM public.notification_delivery_events d JOIN local_identity.historical_audit_events h USING(event_id) WHERE outcome='pending' ORDER BY event_id LIMIT 1");
 expect(pending).toMatch(/^[0-9a-f-]{36}$/);
 expect(c.sql("SELECT count(*) FROM public.notification_delivery_events d WHERE outcome='pending' AND NOT EXISTS(SELECT 1 FROM local_identity.historical_audit_events h WHERE h.event_id=d.event_id)")).toBe('0');
 const fences=c.sql(`BEGIN;SET SESSION AUTHORIZATION loop_app;SELECT count(*) FROM local_identity.claim_native_notification();RESET SESSION AUTHORIZATION;DELETE FROM local_identity.historical_audit_events WHERE event_id='${pending}';SET SESSION AUTHORIZATION loop_app;SELECT count(*) FROM local_identity.claim_native_notification();SELECT count(*) FROM local_identity.claim_native_notification();RESET SESSION AUTHORIZATION;ROLLBACK;`);
 expect(fences).toBe('0\n1\n0');
});
