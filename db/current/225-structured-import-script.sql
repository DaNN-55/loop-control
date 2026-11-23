-- A structured import can have a filming plan and genuinely no original prose.
ALTER TABLE local_identity.script_studio_confirmations
 DROP CONSTRAINT script_studio_confirmations_source_text_check,
 ADD CONSTRAINT script_studio_confirmations_source_text_check CHECK(char_length(source_text) <= 20000);
