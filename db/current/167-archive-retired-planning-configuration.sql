-- ADR-0048 / item 2: preserve every historical field and identifier; cease active defaults.
ALTER TABLE local_identity.storyboard_planning_defaults RENAME TO historical_planning_defaults;
ALTER TABLE local_identity.storyboard_planning_harnesses RENAME TO historical_planning_harnesses;
DROP POLICY storyboard_defaults_owner ON local_identity.historical_planning_defaults;
DROP POLICY storyboard_harness_owner ON local_identity.historical_planning_harnesses;
CREATE POLICY historical_planning_defaults_owner ON local_identity.historical_planning_defaults FOR SELECT TO loop_app USING(owner_id=local_identity.owner_id());
CREATE POLICY historical_planning_harnesses_owner ON local_identity.historical_planning_harnesses FOR SELECT TO loop_app USING(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.historical_planning_defaults,local_identity.historical_planning_harnesses FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT ON local_identity.historical_planning_defaults,local_identity.historical_planning_harnesses TO loop_app;
