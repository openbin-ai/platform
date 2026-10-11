-- Free-text project description, shown on the project overview page and in
-- the projects list. Separate from `name` (a short label) and from the
-- report (the deliverable): this is the analyst's one-paragraph "what is
-- this and why am I looking at it".
ALTER TABLE projects ADD COLUMN description TEXT;
