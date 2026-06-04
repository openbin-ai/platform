package ai.openapk.core.notifications;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserEmailPrefsRepository extends JpaRepository<UserEmailPrefs, UUID> {
}
