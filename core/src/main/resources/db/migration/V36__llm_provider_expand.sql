-- Expand the allowed LLM providers. V1 pinned llm_credentials.provider to
-- ('anthropic','openai','bedrock'); add the OpenAI-compatible providers
-- (gemini, deepseek, qwen, kimi) plus the generic 'openai_compat' escape hatch
-- so a new compatible provider needs no further migration.
--
-- The inline CHECK from V1 is auto-named <table>_<column>_check by Postgres.
ALTER TABLE llm_credentials DROP CONSTRAINT IF EXISTS llm_credentials_provider_check;

ALTER TABLE llm_credentials ADD CONSTRAINT llm_credentials_provider_check
    CHECK (provider IN (
        'anthropic', 'openai', 'bedrock',
        'gemini', 'deepseek', 'qwen', 'kimi', 'openai_compat'
    ));
