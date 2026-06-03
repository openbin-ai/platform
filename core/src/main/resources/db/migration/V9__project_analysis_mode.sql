-- Per-project primary analysis mode. Drives the default Report section
-- template (MAR vs VRR) and sticks the AnalysisTab mode dropdown so users
-- don't have to re-pick MALWARE / VULN_RESEARCH every time they analyze.
--
-- Existing projects default to MALWARE — that matches the historical Report
-- shape so no existing report is disturbed.
ALTER TABLE projects
    ADD COLUMN analysis_mode VARCHAR(32) NOT NULL DEFAULT 'MALWARE';
