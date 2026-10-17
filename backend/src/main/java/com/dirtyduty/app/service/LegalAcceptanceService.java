package com.dirtyduty.app.service;

import com.dirtyduty.app.dto.auth.LegalAcceptanceResponse;
import com.dirtyduty.app.entity.User;
import com.dirtyduty.app.repository.UserRepository;
import jakarta.transaction.Transactional;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.springframework.stereotype.Service;

@Service
public class LegalAcceptanceService {
  private final UserRepository userRepository;

  public LegalAcceptanceService(UserRepository userRepository) {
    this.userRepository = userRepository;
  }

  public boolean isAcceptanceRequired(User user) {
    return user.getLegalAcceptedAt() == null
        || !LegalDocumentVersions.TERMS.equals(user.getTermsAcceptedVersion())
        || !LegalDocumentVersions.PRIVACY_POLICY.equals(user.getPrivacyPolicyAcceptedVersion());
  }

  public boolean isAcceptanceRequiredForEmail(String email) {
    return userRepository.findByEmailIgnoreCase(email).map(this::isAcceptanceRequired).orElse(true);
  }

  public void acceptForRegistration(User user) {
    stampCurrentVersions(user);
  }

  @Transactional
  public LegalAcceptanceResponse acceptCurrentVersions(String email) {
    User user =
        userRepository
            .findByEmailIgnoreCaseForUpdate(email)
            .orElseThrow(() -> new IllegalStateException("Authenticated user is unavailable"));
    stampCurrentVersions(user);
    User savedUser = userRepository.saveAndFlush(user);
    return new LegalAcceptanceResponse(
        savedUser.getTermsAcceptedVersion(),
        savedUser.getPrivacyPolicyAcceptedVersion(),
        savedUser.getLegalAcceptedAt());
  }

  private void stampCurrentVersions(User user) {
    user.setTermsAcceptedVersion(LegalDocumentVersions.TERMS);
    user.setPrivacyPolicyAcceptedVersion(LegalDocumentVersions.PRIVACY_POLICY);
    user.setLegalAcceptedAt(OffsetDateTime.now(ZoneOffset.UTC));
  }
}
