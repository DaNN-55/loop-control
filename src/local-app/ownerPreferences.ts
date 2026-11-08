import type {Pool} from 'pg';
import {defaultOwnerPreferences, parseOwnerPreferences} from '../preferences/preferences.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {ConfigurationError} from './configurationCommands.js';
export async function readOwnerPreferences(pool:Pool,ownerId:string){
  return ownerTransaction(pool,ownerId,true,async client=>{
    const row=(await client.query('SELECT preferences FROM local_identity.owner_preferences WHERE owner_id=$1',[ownerId])).rows[0];
    return row?parseOwnerPreferences(row.preferences):defaultOwnerPreferences;
  });
}
export async function saveOwnerPreferences(pool:Pool,session:OwnerSession,input:unknown){
  let preferences;try{preferences=parseOwnerPreferences(input);}catch(error){throw new ConfigurationError(400,(error as Error).message);}
  return sessionTransaction(pool,session,async client=>{
    await client.query('INSERT INTO local_identity.owner_preferences(owner_id,preferences) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET preferences=excluded.preferences,updated_at=clock_timestamp()',[session.id,JSON.stringify(preferences)]);
    return preferences;
  });
}
export async function readOwnerNotificationEvents(pool:Pool,ownerId:string){
  return ownerTransaction(pool,ownerId,true,async client=>(await client.query(`SELECT n.*, e.title AS episode_title FROM local_identity.owner_notification_events() n LEFT JOIN public.episodes e ON e.id=n.episode_id AND EXISTS (SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role='owner')`)).rows);
}
