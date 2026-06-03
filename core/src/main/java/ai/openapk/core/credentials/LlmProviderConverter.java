package ai.openapk.core.credentials;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = false)
public class LlmProviderConverter implements AttributeConverter<LlmProvider, String> {

    @Override
    public String convertToDatabaseColumn(LlmProvider provider) {
        return provider == null ? null : provider.dbValue();
    }

    @Override
    public LlmProvider convertToEntityAttribute(String dbValue) {
        return dbValue == null ? null : LlmProvider.fromDb(dbValue);
    }
}
