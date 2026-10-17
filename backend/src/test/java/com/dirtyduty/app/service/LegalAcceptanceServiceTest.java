package com.dirtyduty.app.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class LegalAcceptanceServiceTest {
  private final LegalAcceptanceService service =
      new LegalAcceptanceService(Mockito.mock(UserRepository.class));

  @Test
  void legacyAndOutdatedAcceptancesRequireRenewal() {
    User user = new User();
    assertThat(service.isAcceptanceRequired(user)).isTrue();

    user.setTermsAcceptedVersion(LegalDocumentVersions.TERMS);
    user.setPrivacyPolicyAcceptedVersion(LegalDocumentVersions.PRIVACY_POLICY);
    user.setLegalAcceptedAt(OffsetDateTime.now());
    assertThat(service.isAcceptanceRequired(user)).isFalse();

    user.setTermsAcceptedVersion("2025-01-01");
    assertThat(service.isAcceptanceRequired(user)).isTrue();
  }

  @Test
  void registrationAcceptanceStampsOnlyServerControlledCurrentVersions() {
    User user = new User();
    service.acceptForRegistration(user);

    assertThat(user.getTermsAcceptedVersion()).isEqualTo(LegalDocumentVersions.TERMS);
    assertThat(user.getPrivacyPolicyAcceptedVersion())
        .isEqualTo(LegalDocumentVersions.PRIVACY_POLICY);
    assertThat(user.getLegalAcceptedAt()).isNotNull();
    assertThat(user.getLegalAcceptedAt().getOffset()).isEqualTo(java.time.ZoneOffset.UTC);
  }
}
