// @vitest-environment node
import {it,expect} from 'vitest';
import {canonicalFingerprint,jsonFingerprint,validateConfigurationPolicy} from './configurationCommands';
it('blocks unavailable connections and secret fields in nonsecret blueprint configuration',()=>{
 expect(()=>validateConfigurationPolicy({narration:{execution_path:'external'}})).toThrow();
 expect(()=>validateConfigurationPolicy({narration:{credential_ref:'synthetic-version'}})).toThrow();
 expect(()=>validateConfigurationPolicy({api_key:'synthetic'})).toThrow();
 expect(()=>validateConfigurationPolicy({positioning:'local',approval_gates:[]})).not.toThrow();
});

it.each([
 {
  "label": "ordered command body",
  "input": {
   "idempotencyKey": "aaaa",
   "data": {
    "z": 2,
    "a": 1
   },
   "command": "rename"
  },
  "expected": "e8146c726f66d508c58209b3fb4e42a6cff6a22f39532b8bb18bee0e599bbe40"
 },
 {
  "label": "nested Unicode and arrays",
  "input": {
   "z": [
    {
     "b": "界",
     "a": null
    },
    3
   ],
   "A": {
    "b": false,
    "a": 0
   }
  },
  "expected": "9c953bcc0080454a449943a28ced7adf6881cd9c6516e4188402829dd76c2afe"
 },
 {
  "label": "case-sensitive and numeric keys",
  "input": {
   "2": 2,
   "10": 10,
   "z": 0,
   "a": 1,
   "A": 2
  },
  "expected": "29f83d5ef3e709688738ff6ba08a1aa61d4bd78c0f66ca1ce54caba3022e205f"
 },
 {
  "label": "null payload",
  "input": null,
  "expected": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
 },
 {
  "label": "empty array",
  "input": [],
  "expected": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
 }
])('preserves the existing frozen fingerprint bytes: $label',({input,expected})=>{expect(canonicalFingerprint(input)).toBe(expected);});

it.each([
 {"label":"raw insertion order b,a","input":{"b":2,"a":1},"expected":"3fb75453225c732a76b7899ea2096dda1455189c89817239732182f73fe5a09f"},
 {"label":"raw insertion order a,b","input":{"a":1,"b":2},"expected":"43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"},
 {"label":"nested array and Unicode","input":["镜头",{"z":2,"a":1},null,true],"expected":"fc3b308d15d72ead2a7c648823aa3f18dfd72fa34689cb95469b27cfda15b025"},
 {"label":"null payload","input":null,"expected":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"},
 {"label":"empty array","input":[],"expected":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}
])('preserves raw JSON fingerprint bytes without sorting: $label',({input,expected})=>{expect(jsonFingerprint(input)).toBe(expected);});

it('retains raw JSON serialization failures instead of normalizing unsupported inputs',()=>{
 expect(()=>jsonFingerprint(undefined)).toThrow(TypeError);
 expect(()=>jsonFingerprint(1n)).toThrow(TypeError);
});
